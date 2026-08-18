// 多 AI 并发分析 + 总裁判汇总
// 流程：① 多个 AI 分析员（可配置多个模型，或自动派生 谨慎/中性/积极 三视角）并发分析"当日消息面 + 持仓"
//       ② 用其中一个 AI 作为"首席投资官"汇总各路意见，输出最终决策（加仓X% / 减仓X% / 观望）
const TIMEOUT = 45000;

export async function enhanceWithAI(analysis, settings) {
  const ai = settings.ai || {};
  if (!ai.enabled || !ai.apiKey) {
    return { enabled: false, text: null, decisions: null, error: null };
  }

  // ① 构建分析员列表
  const analysts = buildAnalysts(ai);

  // ② 构造公共上下文（消息面 + 持仓数据）
  const news = (analysis.news && analysis.news.list) || [];
  const newsText = news.length
    ? news.slice(0, 12).map((n, i) => `${i + 1}. ${(n.title || n.digest || '').slice(0, 80)}`).join('\n')
    : '（当日新闻获取失败，请基于行情数据判断）';

  const context = {
    date: analysis.date,
    riskTolerance: settings.riskTolerance || '稳健',
    market: {
      indexes: (analysis.market.list || []).map((q) => ({ name: q.name, pct: q.pct, price: q.price })),
      weightedPct: analysis.market.weightedPct,
      // 行情分析技能：板块资金动向 + 指数技术面
      sectors: (analysis.market.sectors || []).map((s) => ({ name: s.name, pct: s.pct, up: s.up, down: s.down, leader: s.leader })),
      tech: (analysis.market.tech || []).map((t) => ({ name: t.name, pct: t.pct, amplitude: t.amplitude, position: t.position, amountYi: t.amountYi })),
    },
    portfolio: analysis.portfolio,
    funds: analysis.funds.map((f) => ({
      code: f.code,
      name: f.name,
      profitPct: f.profitPct,
      weightPct: f.weightPct,
      todayPct: f.todayPct,
      trends: f.trends,
      ruleSignal: f.signal,
      ruleReason: f.signalReason,
    })),
    overall: { score: analysis.overall.score, level: analysis.overall.level, summary: analysis.overall.summary },
    news: newsText,
  };

  // ③ 多路并发分析
  const settled = await Promise.allSettled(
    analysts.map(async (a) => {
      const r = await callAnalyst(a, context, newsText);
      return { analyst: a.name, model: a.model, apiKey: a.apiKey, baseUrl: a.baseUrl, ok: true, ...r };
    })
  );
  const okList = settled
    .filter((s) => s.status === 'fulfilled' && s.value && Array.isArray(s.value.decisions) && s.value.decisions.length)
    .map((s) => s.value);
  const failList = settled
    .filter((s) => s.status === 'rejected' || !(s.value && Array.isArray(s.value.decisions) && s.value.decisions.length))
    .map((s) => ({
      name: (s.status === 'fulfilled' ? s.value.analyst : (s.reason && s.reason.name)) || '未知',
      model: (s.status === 'fulfilled' ? s.value.model : '') || '',
      error: s.status === 'fulfilled' ? '返回无法解析' : (s.reason && s.reason.message) || '调用失败',
    }));

  if (!okList.length) {
    return {
      enabled: true, text: null, decisions: null, model: ai.model,
      method: 'multi-ai-summary', analystCount: 0,
      analysts: failList,
      error: '所有分析员均失败：' + failList.map((f) => `${f.name} ${f.error}`).join('; '),
    };
  }

  // ④ 首席投资官汇总（用第一个成功的分析员配置）
  const chief = okList[0];
  let merged = null;
  let sumErr = null;
  try {
    merged = await summarize(chief, context, newsText, okList);
  } catch (e) {
    sumErr = e.message;
  }
  if (!merged || !merged.decisions || !merged.decisions.length) {
    if (!sumErr) sumErr = '汇总结果为空或无法解析';
    merged = vote(okList);
  }

  return {
    enabled: true,
    text: merged.summary || '',
    decisions: merged.decisions,
    model: chief.model,
    method: merged.summary && merged.summary.startsWith('综合') && sumErr ? 'multi-ai-vote' : 'multi-ai-summary',
    analystCount: okList.length,
    summaryError: sumErr,
    analysts: [
      ...okList.map((a) => ({ name: a.analyst, model: a.model, ok: true })),
      ...failList,
    ],
    error: failList.length ? `${failList.length} 路分析失败：` + failList.map((f) => f.name).join('、') : null,
  };
}

// ---------- 分析员列表 ----------
function buildAnalysts(ai) {
  const list = [];
  const add = (name, cfg, temperature, bias) => {
    if (!cfg || !cfg.apiKey) return;
    const baseUrl = (cfg.baseUrl || 'https://api.deepseek.com').replace(/\/+$/, '');
    const model = cfg.model || 'deepseek-chat';
    if (list.some((x) => x.apiKey === cfg.apiKey && x.model === model && x.temperature === temperature)) return;
    list.push({ name, apiKey: cfg.apiKey, baseUrl, model, temperature, bias });
  };
  // 用户额外配置的分析员（settings.ai.analysts: [{name, apiKey, baseUrl, model}]）
  if (Array.isArray(ai.analysts)) {
    for (const a of ai.analysts) {
      if (a && a.apiKey) add(a.name || a.model || '分析师', a, 0.4, '');
    }
  }
  // 主分析员
  add('DeepSeek', ai, 0.4, '');
  // 不足 3 路时，用主配置自动派生不同视角
  const views = [
    { name: '谨慎视角', t: 0.2, bias: '在不确定时优先保守：倾向观望或减仓，严格控制风险，只在消息面明确利好且趋势向上时才建议加仓。' },
    { name: '积极视角', t: 0.7, bias: '关注机会与景气方向：消息面利好时可积极加仓（比例可给高些），但对明显利空仍应减仓或观望。' },
  ];
  for (const v of views) {
    if (list.length >= 3) break;
    add(v.name, ai, v.t, v.bias);
  }
  return list.slice(0, 4);
}

// ---------- 单个分析员调用 ----------
async function callAnalyst(a, context, newsText) {
  const system = `你是一名专业的基金投资分析师，擅长结合"当日消息面 + 实时行情 + 用户持仓数据"给出明确可执行的操作决策。
${a.bias ? `\n你的分析视角：${a.bias}` : ''}

【行情分析技能】你会收到以下实时行情数据，请充分利用：
- market.sectors：今日行业板块涨幅/跌幅榜（含领涨股），判断资金流向与板块轮动方向；
- market.tech：指数技术面（涨跌幅、振幅、日内位置0~100、成交额亿），判断市场强弱与量能；
- market.indexes：主要指数涨跌；
- news：当日消息面（政策/宏观/行业新闻）；
- funds：持仓基金数据（盈亏、趋势、今日估值涨跌、占比）。
分析时：先看板块资金动向与指数强弱判断市场环境，再对照持仓基金的主题（如消费/白酒/科技/医药/新能源），找出与强势/弱势板块相关的基金，给出决策。

要求：
1. 对每只持仓基金给出明确操作：
   - 加仓：pct 为占该基金当前市值的百分比（建议 5~20，单日加仓合计不超过组合总仓位的 10%）
   - 减仓：pct 为占该基金当前市值的百分比（建议 10~30）
   - 观望：pct 填 0
2. 理由必须结合行情技能数据（板块/量能/消息面）或持仓数据，不能泛泛而谈。
3. 持仓基金对应板块在涨幅榜前列且量能放大 → 可加仓；在跌幅榜且消息面利空 → 减仓或观望。
4. 不要编造数据；无法判断时给"观望"。
5. 只输出一个 JSON 对象（不要 markdown 代码块，不要解释文字）：
{"summary":"一句话点评（50字内）","decisions":[{"code":"基金代码","action":"加仓","pct":10,"reason":"理由（40字内）"}]}
每只持仓基金都要出现在 decisions 中，action 只能是"加仓"/"减仓"/"观望"之一。`;

  const user = `风险偏好：${context.riskTolerance}\n今日日期：${context.date}\n\n当日消息面：\n${newsText}\n\n持仓与行情数据：\n${JSON.stringify(context, null, 1)}`;

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT);
  try {
    const res = await fetch(`${a.baseUrl}/chat/completions`, {
      method: 'POST',
      signal: ctrl.signal,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${a.apiKey}` },
      body: JSON.stringify({
        model: a.model,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
        temperature: a.temperature,
        max_tokens: 1600,
        stream: false,
      }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`接口错误 ${res.status}: ${body.slice(0, 150)}`);
    }
    const json = await res.json();
    const content = json.choices?.[0]?.message?.content?.trim();
    if (!content) throw new Error('返回为空');
    const parsed = parseDecision(content);
    if (!parsed) throw new Error('无法解析为决策 JSON');
    return { summary: parsed.summary || '', decisions: parsed.decisions };
  } catch (e) {
    const err = new Error(e.message);
    err.name = a.name;
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

// ---------- 首席投资官汇总 ----------
async function summarize(chief, context, newsText, okList) {
  const input = {
    date: context.date,
    riskTolerance: context.riskTolerance,
    news: newsText,
    analysts: okList.map((a, i) => ({
      序号: i + 1,
      分析员: a.analyst,
      模型: a.model,
      点评: a.summary,
      决策: a.decisions,
    })),
  };
  const system = `你是首席投资官。${okList.length} 位 AI 分析师已独立给出操作决策，请综合所有意见输出最终决策。
要求：
1. 每只持仓基金都要有最终决策，action 只能是"加仓"/"减仓"/"观望"之一。
2. 意见分歧时：多数意见优先，其次选择更稳妥的结论（不确定时观望或减仓）。
3. pct 在分析师建议范围内取合理值（加仓 5~20，减仓 10~30，观望为 0）。
4. 理由要结合消息面与多数派观点，40字内。
5. 只输出一个 JSON 对象（不要 markdown 代码块）：
{"summary":"综合 ${okList.length} 位分析师的当日总评（60字内）","decisions":[{"code":"基金代码","action":"加仓","pct":10,"reason":"最终理由"}]}`;

  const user = `风险偏好：${context.riskTolerance}\n今日日期：${context.date}\n\n当日消息面：\n${newsText}\n\n各分析师意见：\n${JSON.stringify(input.analysts, null, 1)}`;

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT);
  try {
    const res = await fetch(`${chief.baseUrl}/chat/completions`, {
      method: 'POST',
      signal: ctrl.signal,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${chief.apiKey}` },
      body: JSON.stringify({
        model: chief.model,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
        temperature: 0.2,
        max_tokens: 1800,
        stream: false,
      }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`接口错误 ${res.status}: ${body.slice(0, 150)}`);
    }
    const json = await res.json();
    const content = json.choices?.[0]?.message?.content?.trim();
    if (!content) throw new Error('返回为空');
    return parseDecision(content);
  } finally {
    clearTimeout(timer);
  }
}

// ---------- 兜底：多数投票 ----------
function vote(okList) {
  const byCode = {};
  for (const r of okList) {
    for (const d of r.decisions) {
      if (!byCode[d.code]) byCode[d.code] = { code: d.code, actions: [], pcts: [], reasons: [] };
      byCode[d.code].actions.push(d.action);
      byCode[d.code].pcts.push(d.pct);
      byCode[d.code].reasons.push(d.reason || '');
    }
  }
  const decisions = Object.values(byCode).map((g) => {
    const cnt = { 加仓: 0, 减仓: 0, 观望: 0 };
    g.actions.forEach((a) => { if (cnt[a] != null) cnt[a]++; });
    const action = cnt.加仓 >= cnt.减仓 && cnt.加仓 >= cnt.观望 ? '加仓' : cnt.减仓 >= cnt.观望 ? '减仓' : '观望';
    const pos = g.pcts.filter((p) => p > 0);
    const pct = action === '观望' ? 0 : pos.length ? Math.round((pos.reduce((s, p) => s + p, 0) / pos.length) * 10) / 10 : 0;
    return { code: g.code, action, pct, reason: g.reasons[0] || '' };
  });
  return { summary: `综合 ${okList.length} 位 AI 分析师的判断，给出最终操作决策（多数投票结果）。`, decisions };
}

// ---------- JSON 解析 ----------
function parseDecision(text) {
  if (!text) return null;
  let s = text.trim();
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) s = fence[1].trim();
  const start = s.indexOf('{');
  const end = s.lastIndexOf('}');
  if (start >= 0 && end > start) {
    const frag = s.slice(start, end + 1);
    try {
      const obj = JSON.parse(frag);
      return normalizeDecision(obj);
    } catch { /* 继续尝试 */ }
  }
  try {
    return normalizeDecision(JSON.parse(s));
  } catch {
    return null;
  }
}

function normalizeDecision(obj) {
  if (!obj || typeof obj !== 'object') return null;
  const decisions = Array.isArray(obj.decisions) ? obj.decisions : [];
  const out = [];
  for (const d of decisions) {
    if (!d || typeof d !== 'object') continue;
    const code = String(d.code || '').replace(/\D/g, '');
    if (!/^\d{6}$/.test(code)) continue;
    let action = String(d.action || '').trim();
    if (!['加仓', '减仓', '观望'].includes(action)) action = '观望';
    let pct = Number(d.pct);
    if (!Number.isFinite(pct)) pct = 0;
    pct = action === '观望' ? 0 : Math.round(Math.min(Math.max(pct, 0), 50) * 10) / 10;
    out.push({
      code,
      action,
      pct,
      reason: String(d.reason || '').trim().slice(0, 100),
    });
  }
  return { summary: String(obj.summary || '').trim().slice(0, 300), decisions: out };
}