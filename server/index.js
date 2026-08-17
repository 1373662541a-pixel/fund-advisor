import express from 'express';
import path from 'node:path';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { PORT, PUBLIC_DIR, ROOT } from './config.js';
import { store } from './storage.js';
import { generateAdvice, isGenerating, getLastRun } from './service.js';
import { startScheduler } from './scheduler.js';
import { getFundQuote, getIndexQuotes, clearFundCache } from './market.js';
import { recognizeImage, parseFunds } from './ocr.js';
import { recognizeWithAI } from './vision.js';
import { settlePendingOps } from './ops.js';
import { isTradingDay, nextTradingDay } from './trading.js';
import { shNow, shDateStr, shTimeStr, isWithinTradingHours } from './time.js';

const app = express();
app.use(express.json({ limit: '4mb' }));
app.use(express.static(PUBLIC_DIR));

// 供前端在浏览器里解析 CSV/XLSX 的 SheetJS
app.get('/vendor/xlsx.full.min.js', (req, res) => {
  const f = path.join(ROOT, 'node_modules/xlsx/dist/xlsx.full.min.js');
  if (fs.existsSync(f)) res.sendFile(f);
  else res.status(404).send('not found');
});

// ---------- 状态 ----------
app.get('/api/status', (req, res) => {
  const now = shNow();
  const date = shDateStr(now);
  const settings = store.getSettings();
  const todayAdvice = store.getAdvice(date);
  const adviceDates = store.listAdviceDates();
  res.json({
    now: { date, time: shTimeStr(now), tradingDay: isTradingDay(date), withinTradingHours: isWithinTradingHours(now) },
    generating: isGenerating(),
    lastRun: getLastRun(),
    todayAdviceGenerated: !!todayAdvice,
    lastAdviceDate: adviceDates[0] || null,
    schedule: settings.schedule,
    nextAdviceDate: settings.schedule.enabled ? nextTradingDay(date) : null,
    aiEnabled: settings.ai.enabled && !!settings.ai.apiKey,
    visionEnabled: settings.vision.enabled && !!settings.vision.apiKey,
    engineVersion: settings.engine.version,
    holdingsCount: store.getHoldings().length,
  });
});

// ---------- 持仓 CRUD ----------
app.get('/api/holdings', (req, res) => {
  res.json(store.getHoldings());
});

function normalizeHolding(body, id) {
  const code = String(body.code || '').trim().replace(/\D/g, '');
  const shares = Number(body.shares);
  const costNav = Number(body.costNav);
  if (!/^\d{6}$/.test(code)) throw new Error('基金代码必须是 6 位数字');
  if (!Number.isFinite(shares) || shares <= 0) throw new Error('持有份额必须是大于 0 的数字');
  if (!Number.isFinite(costNav) || costNav <= 0) throw new Error('成本净值必须是大于 0 的数字');
  return {
    id: id || crypto.randomUUID(),
    code,
    name: String(body.name || '').trim() || code,
    shares: Math.round(shares * 10000) / 10000,
    costNav: Math.round(costNav * 100000) / 100000,
    note: String(body.note || '').trim(),
    updatedAt: new Date().toISOString(),
  };
}

app.post('/api/holdings', (req, res) => {
  try {
    const h = normalizeHolding(req.body || {});
    const list = store.getHoldings();
    list.push(h);
    store.saveHoldings(list);
    clearFundCache(h.code);
    res.json({ ok: true, holdings: list });
  } catch (e) {
    res.status(400).json({ ok: false, error: e.message });
  }
});

app.put('/api/holdings/:id', (req, res) => {
  try {
    const list = store.getHoldings();
    const idx = list.findIndex((x) => x.id === req.params.id);
    if (idx < 0) return res.status(404).json({ ok: false, error: '持仓不存在' });
    const merged = { ...list[idx], ...req.body, id: list[idx].id };
    const h = normalizeHolding(merged, list[idx].id);
    list[idx] = h;
    store.saveHoldings(list);
    clearFundCache(h.code);
    res.json({ ok: true, holdings: list });
  } catch (e) {
    res.status(400).json({ ok: false, error: e.message });
  }
});

app.delete('/api/holdings/:id', (req, res) => {
  const list = store.getHoldings().filter((x) => x.id !== req.params.id);
  store.saveHoldings(list);
  res.json({ ok: true, holdings: list });
});

// ---------- 加仓/减仓操作（下一个交易日自动生效） ----------
app.post('/api/holdings/ops', (req, res) => {
  try {
    const code = String(req.body?.code || '').replace(/\D/g, '');
    const type = String(req.body?.type || '');
    const amount = Number(req.body?.amount);
    if (!/^\d{6}$/.test(code)) throw new Error('基金代码必须是 6 位数字');
    if (type !== 'add' && type !== 'reduce') throw new Error('操作类型必须是 add（加仓）或 reduce（减仓）');
    if (!Number.isFinite(amount) || amount <= 0) throw new Error('操作金额必须是大于 0 的数字');
    const holdings = store.getHoldings();
    const h = holdings.find((x) => x.code === code);
    if (type === 'reduce' && !h) throw new Error('减仓操作需要该基金已在持仓中');
    const today = shDateStr(shNow());
    const effDate = nextTradingDay(today);
    if (!effDate) throw new Error('无法计算下一个交易日');
    const ops = store.getPendingOps();
    const op = {
      id: crypto.randomUUID(),
      code,
      name: h ? h.name : String(req.body?.name || '').trim(),
      type,
      amount: Math.round(amount * 100) / 100,
      opDate: today,
      effDate,
      status: 'pending',
      createdAt: new Date().toISOString(),
    };
    ops.push(op);
    store.savePendingOps(ops);
    res.json({ ok: true, op, pendingCount: ops.filter((o) => o.status === 'pending').length });
  } catch (e) {
    res.status(400).json({ ok: false, error: e.message });
  }
});

app.get('/api/holdings/ops', (req, res) => {
  res.json({ ok: true, ops: store.getPendingOps() });
});

// 批量导入：rows = [{code, name, shares, costNav, note}]；同代码合并（更新份额/成本），新代码追加
app.post('/api/holdings/import', (req, res) => {
  try {
    const rows = req.body?.rows;
    if (!Array.isArray(rows) || !rows.length) throw new Error('没有可导入的数据');
    const list = store.getHoldings();
    const byCode = new Map(list.map((x) => [x.code, x]));
    const added = [];
    for (const r of rows) {
      const code = String(r.code || '').trim().replace(/\D/g, '');
      if (!/^\d{6}$/.test(code)) continue;
      const shares = Number(r.shares);
      const costNav = Number(r.costNav);
      if (!Number.isFinite(shares) || shares <= 0 || !Number.isFinite(costNav) || costNav <= 0) continue;
      const existing = byCode.get(code);
      if (existing) {
        existing.shares = Math.round(shares * 10000) / 10000;
        existing.costNav = Math.round(costNav * 100000) / 100000;
        if (r.name) existing.name = String(r.name).trim();
        if (r.note) existing.note = String(r.note).trim();
        existing.updatedAt = new Date().toISOString();
      } else {
        const h = {
          id: crypto.randomUUID(),
          code,
          name: String(r.name || '').trim() || code,
          shares: Math.round(shares * 10000) / 10000,
          costNav: Math.round(costNav * 100000) / 100000,
          note: String(r.note || '').trim(),
          updatedAt: new Date().toISOString(),
        };
        byCode.set(code, h);
        added.push(h);
      }
    }
    const updated = [...byCode.values()];
    store.saveHoldings(updated);
    for (const h of updated) clearFundCache(h.code);
    res.json({ ok: true, holdings: updated, addedCount: added.length });
  } catch (e) {
    res.status(400).json({ ok: false, error: e.message });
  }
});

// 截图识别持仓：?mode=auto（默认，配置了 AI 就用 AI，否则本地 OCR）| ai | ocr
app.post('/api/holdings/import-image', express.raw({ type: ['image/*'], limit: '20mb' }), async (req, res) => {
  const buf = req.body;
  if (!buf || !buf.length) return res.status(400).json({ ok: false, error: '未收到图片数据' });
  const mode = String(req.query.mode || 'auto');
  const settings = store.getSettings();
  const visionReady = settings.vision && settings.vision.enabled && !!settings.vision.apiKey;
  const useAI = mode === 'ai' || (mode === 'auto' && visionReady);
  try {
    const t0 = Date.now();
    let rows = [];
    let rawText = '';
    let method = 'ocr';
    let aiError = null;
    let model = null;
    if (useAI) {
      const r = await recognizeWithAI(buf, settings.vision);
      if (r.ok) {
        rows = r.rows;
        method = 'ai';
        model = r.model;
        rawText = r.raw || '';
      } else if (mode === 'ai') {
        throw new Error(r.error);
      } else {
        aiError = r.error; // auto 模式下 AI 失败自动降级本地 OCR
      }
    }
    if (!rows.length && method !== 'ai') {
      const text = await recognizeImage(buf);
      rawText = text.slice(0, 2000);
      rows = await parseFunds(text);
    }
    // 自动推算：截图只有「持有金额/持有收益率」时，用当日净值反推持有份额与成本净值
    //   份额 = 持有金额 ÷ 当日净值；成本净值 = 当日净值 ÷ (1 + 收益率)（或 = 净值×(金额-收益)/金额）
    let autoCalculated = false;
    if (rows.length) {
      const codes = [...new Set(rows.map((x) => x.code).filter((c) => /^\d{6}$/.test(c)))];
      const navMap = new Map();
      await Promise.all(codes.map(async (code) => {
        try {
          const q = await getFundQuote(code);
          if (q.nav && q.nav > 0) navMap.set(code, { nav: q.nav, navDate: q.navDate });
        } catch { /* 单个净值查询失败不影响其它 */ }
      }));
      rows = rows.map((r) => {
        const ni = navMap.get(r.code);
        if (!ni) return r;
        const out = { ...r, navUsed: ni.nav, navDate: ni.navDate };
        if ((!out.shares || out.shares <= 0) && out.amount && out.amount > 0) {
          out.shares = Math.round((out.amount / ni.nav) * 10000) / 10000;
          out.autoShares = true;
        }
        if ((!out.costNav || out.costNav <= 0) && ni.nav > 0) {
          if (out.profitRate && out.profitRate !== 0) {
            out.costNav = Math.round((ni.nav / (1 + out.profitRate / 100)) * 100000) / 100000;
            out.autoCostNav = true;
          } else if (out.amount && out.amount > 0 && out.profit !== null && out.profit !== undefined && out.amount - out.profit > 0) {
            out.costNav = Math.round((ni.nav * (out.amount - out.profit) / out.amount) * 100000) / 100000;
            out.autoCostNav = true;
          }
        }
        if (out.autoShares || out.autoCostNav) autoCalculated = true;
        return out;
      });
    }
    res.json({
      ok: true,
      rows,
      method,
      model,
      aiError,
      rawText,
      autoCalculated,
      elapsed: Date.now() - t0,
    });
  } catch (e) {
    res.status(500).json({ ok: false, error: '图片识别失败：' + e.message });
  }
});

// ---------- 建议 ----------
app.post('/api/advice/generate', async (req, res) => {
  const force = !!(req.body && req.body.force);
  const result = await generateAdvice({ force });
  if (!result.ok && result.busy) return res.status(409).json(result);
  if (!result.ok) return res.status(500).json(result);
  res.json(result);
});

app.get('/api/advice', (req, res) => {
  const date = req.query.date;
  const list = store.listAdviceDates();
  if (date) {
    const rec = store.getAdvice(date);
    if (!rec) return res.status(404).json({ ok: false, error: '该日期没有建议记录' });
    return res.json({ ok: true, record: rec });
  }
  if (!list.length) return res.json({ ok: true, record: null });
  res.json({ ok: true, record: store.getAdvice(list[0]) });
});

app.get('/api/advice/history', (req, res) => {
  const list = store.listAdviceDates().slice(0, 90).map((d) => {
    const r = store.getAdvice(d);
    return {
      date: d,
      generatedAt: r.generatedAt,
      score: r.overall && r.overall.score,
      level: r.overall && r.overall.level,
      totalProfitPct: r.portfolio && r.portfolio.totalProfitPct,
      todayPctWeighted: r.portfolio && r.portfolio.todayPctWeighted,
      fundCount: r.portfolio && r.portfolio.fundCount,
      aiText: !!(r.ai && r.ai.text),
    };
  });
  res.json({ ok: true, list });
});

// ---------- 实时行情 ----------
app.get('/api/market', async (req, res) => {
  try {
    const market = await getIndexQuotes();
    res.json({ ok: true, market });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ---------- 设置 ----------
app.get('/api/settings', (req, res) => {
  const s = store.getSettings();
  res.json({
    ...s,
    ai: { ...s.ai, apiKey: s.ai.apiKey ? '****' : '' },
    vision: { ...s.vision, apiKey: s.vision.apiKey ? '****' : '' },
  });
});

app.put('/api/settings', (req, res) => {
  const cur = store.getSettings();
  const body = req.body || {};
  const next = { ...cur };
  if (body.riskTolerance) next.riskTolerance = body.riskTolerance;
  if (body.schedule) {
    next.schedule = { ...cur.schedule, ...body.schedule };
    if (next.schedule.time && !/^\d{2}:\d{2}$/.test(next.schedule.time)) {
      return res.status(400).json({ ok: false, error: '触发时间格式应为 HH:MM' });
    }
  }
  if (body.ai) {
    next.ai = { ...cur.ai, ...body.ai };
    if (body.ai.apiKey === '****' || body.ai.apiKey === '') {
      next.ai.apiKey = body.ai.apiKey === '****' ? cur.ai.apiKey : '';
    }
  }
  if (body.vision) {
    next.vision = { ...cur.vision, ...body.vision };
    if (body.vision.apiKey === '****' || body.vision.apiKey === '') {
      next.vision.apiKey = body.vision.apiKey === '****' ? cur.vision.apiKey : '';
    }
  }
  store.saveSettings(next);
  const s = store.getSettings();
  res.json({
    ok: true,
    settings: {
      ...s,
      ai: { ...s.ai, apiKey: s.ai.apiKey ? '****' : '' },
      vision: { ...s.vision, apiKey: s.vision.apiKey ? '****' : '' },
    },
  });
});

// ---------- 工具 ----------
app.get('/api/fund/info', async (req, res) => {
  const code = String(req.query.code || '').replace(/\D/g, '');
  if (!/^\d{6}$/.test(code)) return res.status(400).json({ ok: false, error: '基金代码格式错误' });
  try {
    const q = await getFundQuote(code);
    if (!q.name || q.name === code) return res.status(404).json({ ok: false, error: '未找到该基金' });
    res.json({ ok: true, fund: { code, name: q.name, nav: q.nav, navDate: q.navDate } });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// 统一错误处理
app.use((err, req, res, next) => {
  console.error('[server]', err);
  res.status(500).json({ ok: false, error: err.message || '服务器内部错误' });
});

app.listen(PORT, '127.0.0.1', () => {
  console.log(`[fund-advisor] 服务已启动: http://127.0.0.1:${PORT}`);
  startScheduler();
  // 启动时补结算到期的加仓/减仓操作（如服务重启/跨日）
  settlePendingOps().catch((e) => console.error('[结算] 启动结算异常:', e.message));
});
