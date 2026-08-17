/* 基金投资分析助手 - 前端逻辑 */
const $ = (s) => document.querySelector(s);
const IS_DEMO = new URLSearchParams(location.search).has('demo');
const state = {
  status: null, market: null, holdings: [], advice: null, history: [], settings: null,
  editingId: null, viewingDate: null, generating: false, ocrRows: [], opState: null,
};

/* ---------- 工具 ---------- */
const MOCK = {
  status: {
    now: { date: '2026-08-18', time: '14:32', tradingDay: true, withinTradingHours: true },
    schedule: { enabled: true, time: '14:30' },
    todayAdviceGenerated: true, generating: false,
    aiEnabled: true, visionEnabled: true,
  },
  market: {
    fetchedAt: Date.now(),
    list: [
      { name: '上证指数', price: 3247.56, pct: 1.23, change: 39.45 },
      { name: '深证成指', price: 10234.78, pct: 1.87, change: 187.32 },
      { name: '创业板指', price: 2156.43, pct: 2.45, change: 51.62 },
      { name: '沪深300', price: 3892.15, pct: 0.98, change: 37.81 },
      { name: '中证500', price: 5678.90, pct: 1.56, change: 87.23 },
      { name: '科创50', price: 987.65, pct: -0.43, change: -4.28 },
    ],
  },
  holdings: [
    { id: '1', code: '110022', name: '易方达消费行业股票', shares: 5000, costNav: 3.215, note: '核心仓位' },
    { id: '2', code: '161725', name: '招商中证白酒指数', shares: 8000, costNav: 1.087, note: '' },
    { id: '3', code: '005827', name: '易方达蓝筹精选混合', shares: 3000, costNav: 2.156, note: '长期持有' },
    { id: '4', code: '001102', name: '前海开源国家比较优势', shares: 2000, costNav: 1.876, note: '' },
    { id: '5', code: '519674', name: '银河创新成长混合', shares: 4000, costNav: 4.321, note: '科技赛道' },
  ],
  advice: {
    date: '2026-08-18', generatedAt: Date.now(), isTradingDay: true,
    overall: {
      score: 72, level: '中性偏多', color: '#0d9488',
      summary: '当前市场情绪回暖，消费与科技板块共振上行。组合整体估值处于合理区间，建议维持现有仓位结构，对短期涨幅较大的品种可适度止盈，同时关注低位补涨机会。',
      operations: [
        '易方达消费行业：持仓观望，等待回调至3.15以下可考虑加仓',
        '招商中证白酒：当前估值偏高，建议减仓1/3锁定收益',
        '易方达蓝筹精选：继续持有，基金经理调仓逻辑清晰',
        '银河创新成长：科技板块景气度回升，可小幅加仓',
      ],
      risks: [
        '美联储降息预期反复，北向资金可能出现短期波动',
        '白酒板块中报业绩分化，需警惕个股暴雷风险',
        '科技板块估值已处历史中高位，追高需谨慎',
      ],
    },
    ai: { enabled: true, text: '从资金面看，今日北向资金净流入超60亿，连续3日加仓消费与新能源板块，市场风险偏好明显提升。技术面上，上证指数突破3200点整数关口，MACD金叉确认，短期有望挑战3300点压力位。建议投资者保持中性偏多仓位，重点关注业绩确定性强的消费龙头和景气度向上的半导体赛道。' },
    portfolio: {
      totalValue: 128650.35, totalProfitPct: 12.45, todayPctWeighted: 1.32,
      todayProfit: 1678.45, fundCount: 5, hasEstimate: true,
    },
    funds: [
      { code: '110022', name: '易方达消费行业股票', marketValue: 17835.00, nav: 3.567, estNav: 3.582, estimateAvailable: true, todayPct: 1.45, todaySource: 'estimate', trends: { '1m': 5.23, '3m': 8.67 }, profitPct: 10.95, profit: 1760.00, weightPct: 13.9, signal: '观望', signalReason: '估值合理，持有为主' },
      { code: '161725', name: '招商中证白酒指数', marketValue: 9872.00, nav: 1.234, estNav: 1.241, estimateAvailable: true, todayPct: 2.13, todaySource: 'estimate', trends: { '1m': 7.89, '3m': 12.34 }, profitPct: 13.52, profit: 1176.00, weightPct: 7.7, signal: '止盈(部分)', signalReason: '短期涨幅过大，估值偏高' },
      { code: '005827', name: '易方达蓝筹精选混合', marketValue: 7035.00, nav: 2.345, estNav: 2.351, estimateAvailable: true, todayPct: 0.87, todaySource: 'estimate', trends: { '1m': 3.45, '3m': 6.78 }, profitPct: 8.77, profit: 567.00, weightPct: 5.5, signal: '可加仓', signalReason: '回调到位，经理调仓积极' },
      { code: '001102', name: '前海开源国家比较优势', marketValue: 3974.00, nav: 1.987, estNav: 1.995, estimateAvailable: true, todayPct: 1.12, todaySource: 'estimate', trends: { '1m': 4.56, '3m': 7.89 }, profitPct: 5.92, profit: 222.00, weightPct: 3.1, signal: '观望', signalReason: '方向不明，等待信号' },
      { code: '519674', name: '银河创新成长混合', marketValue: 18268.00, nav: 4.567, estNav: 4.589, estimateAvailable: true, todayPct: 2.87, todaySource: 'estimate', trends: { '1m': 9.23, '3m': 15.67 }, profitPct: 5.69, profit: 984.00, weightPct: 14.2, signal: '可加仓', signalReason: '科技景气向上，空间较大' },
    ],
  },
  history: [
    { date: '2026-08-18', score: 72, level: '中性偏多', totalProfitPct: 12.45, aiText: '...' },
    { date: '2026-08-15', score: 65, level: '中性', totalProfitPct: 10.23, aiText: '...' },
    { date: '2026-08-14', score: 58, level: '偏谨慎', totalProfitPct: 8.67, aiText: '' },
    { date: '2026-08-13', score: 70, level: '中性偏多', totalProfitPct: 9.45, aiText: '...' },
    { date: '2026-08-12', score: 55, level: '偏谨慎', totalProfitPct: 7.89, aiText: '' },
  ],
  settings: { riskTolerance: '稳健', schedule: { time: '14:30', enabled: true } },
};

async function api(path, opts = {}) {
  if (IS_DEMO) {
    await new Promise((r) => setTimeout(r, 200));
    if (path === '/api/status') return MOCK.status;
    if (path === '/api/market') return { market: MOCK.market };
    if (path === '/api/holdings') return MOCK.holdings;
    if (path === '/api/advice/history') return { list: MOCK.history };
    if (path.startsWith('/api/advice')) return { record: MOCK.advice };
    if (path === '/api/settings') return MOCK.settings;
    if (path === '/api/holdings/ops') return { ops: [] };
    return { ok: true };
  }
  const res = await fetch(path, {
    method: opts.method || 'GET',
    headers: { 'Content-Type': 'application/json' },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok && data.ok !== true) throw new Error(data.error || `请求失败 (${res.status})`);
  return data;
}

function fmtPct(p, digits = 2) {
  if (p === null || p === undefined || Number.isNaN(p)) return '--';
  const n = Number(p);
  return (n > 0 ? '+' : '') + n.toFixed(digits) + '%';
}
function fmtNum(n, digits = 2) {
  if (n === null || n === undefined || Number.isNaN(n)) return '--';
  return Number(n).toFixed(digits);
}
function fmtWan(v) {
  if (v === null || v === undefined || Number.isNaN(v)) return '--';
  if (v >= 1e8) return (v / 1e8).toFixed(2) + '亿';
  if (v >= 1e4) return (v / 1e4).toFixed(2) + '万';
  return v.toFixed(2);
}
function pctClass(p) {
  if (p === null || p === undefined || Number.isNaN(p)) return 'flat';
  return p > 0 ? 'up' : p < 0 ? 'down' : 'flat';
}
function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
// 操作信号样式类
function sigClass(s) {
  if (s === '可加仓') return 'add';
  if (s === '减仓' || s === '减仓/止损评估') return 'reduce';
  if (s === '止盈(部分)') return 'stop';
  if (s === '观望') return 'watch';
  return 'hold';
}
let toastTimer = null;
function toast(msg, isError = false) {
  const t = $('#toast');
  t.textContent = msg;
  t.className = 'toast' + (isError ? ' error' : '');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.add('hidden'), 3600);
}

/* ---------- 数字滚动动画 ---------- */
function animateNumber(el, target, duration = 900, formatter) {
  if (!el) return;
  const start = parseFloat(el.dataset.cur || '0') || 0;
  const end = Number(target);
  if (!Number.isFinite(end)) { if (formatter) el.textContent = formatter(target); else el.textContent = target; return; }
  el.dataset.cur = end;
  const t0 = performance.now();
  function tick(now) {
    const p = Math.min((now - t0) / duration, 1);
    const eased = 1 - Math.pow(1 - p, 3);
    const val = start + (end - start) * eased;
    el.textContent = formatter ? formatter(val) : (Math.round(val * 100) / 100).toString();
    if (p < 1) requestAnimationFrame(tick);
    else el.textContent = formatter ? formatter(end) : end.toString();
  }
  requestAnimationFrame(tick);
}

/* ---------- 状态栏 ---------- */
function renderStatus() {
  const st = state.status;
  if (!st) return;
  $('#st-date').textContent = `📅 ${st.now.date} ${st.now.time}${st.now.tradingDay ? '' : '（非交易日）'}`;
  const mkt = $('#st-market-state');
  if (!st.now.tradingDay) { mkt.textContent = '休市'; mkt.className = 'chip'; }
  else if (st.now.withinTradingHours) { mkt.textContent = '交易中'; mkt.className = 'chip ok'; }
  else { mkt.textContent = '已收盘'; mkt.className = 'chip'; }
  const sched = $('#st-schedule');
  if (st.schedule.enabled) {
    sched.textContent = `⏰ 每日 ${st.schedule.time} 自动生成${st.todayAdviceGenerated ? '（今日已生成）' : ''}`;
    sched.className = 'chip ' + (st.todayAdviceGenerated ? 'ok' : '');
  } else {
    sched.textContent = '⏸ 自动生成已关闭';
    sched.className = 'chip warn';
  }
  const ai = $('#st-ai');
  ai.textContent = st.aiEnabled ? '🤖 AI 已启用' : 'AI: 未启用';
  ai.className = 'chip ' + (st.aiEnabled ? 'ok' : '');
  const vis = $('#st-vision');
  if (vis) {
    vis.textContent = st.visionEnabled ? '👁 AI识别已启用' : '识别: 本地OCR';
    vis.className = 'chip ' + (st.visionEnabled ? 'ok' : '');
  }
  const btn = $('#btn-generate');
  btn.disabled = st.generating;
  btn.textContent = st.generating ? '⏳ 生成中…' : '⚡ 立即生成今日建议';
}

/* ---------- 市场卡片 ---------- */
function renderMarket() {
  const m = state.market;
  const wrap = $('#market-cards');
  if (!m || !m.list || !m.list.length) {
    wrap.innerHTML = '<div class="empty small">行情加载失败</div>';
    return;
  }
  $('#market-time').textContent = `更新于 ${new Date(m.fetchedAt).toLocaleTimeString('zh-CN', { hour12: false })}`;
  wrap.innerHTML = m.list.map((q) => `
    <div class="card">
      <div class="name">${esc(q.name)}</div>
      <div class="price ${pctClass(q.pct)}">${fmtNum(q.price)}</div>
      <div class="pct ${pctClass(q.pct)}">${fmtPct(q.pct)} ${q.change > 0 ? '▲' : q.change < 0 ? '▼' : ''}</div>
    </div>`).join('');
}

/* ---------- 建议区 ---------- */
const DIAL_C = 2 * Math.PI * 52;
function renderAdvice() {
  const r = state.advice;
  const dateEl = $('#advice-date');
  const body = $('#advice-body');
  const empty = $('#advice-empty');
  if (!r) {
    body.classList.add('hidden');
    empty.classList.remove('hidden');
    dateEl.textContent = '';
    $('#charts-section').classList.add('hidden');
    renderHoldings(); // 无建议时同步清空持仓汇总
    return;
  }
  empty.classList.add('hidden');
  body.classList.remove('hidden');
  dateEl.textContent = `（${r.date} 生成于 ${r.generatedAt ? new Date(r.generatedAt).toLocaleString('zh-CN', { hour12: false }) : '--'}${r.isTradingDay ? '' : ' · 非交易日快照'}）`;

  const score = r.overall.score;
  const color = r.overall.color || '#0f766e';
  const val = $('#dial-val');
  // 评分环渐变描边：颜色随评分状态变化（由 CSS 的 #dialGrad 引用）
  const stops = document.querySelectorAll('#dialGrad stop');
  if (stops.length) { stops[0].setAttribute('stop-color', color); stops[1].setAttribute('stop-color', color); }
  val.style.strokeDasharray = `${(score / 100) * DIAL_C} ${DIAL_C}`;
  animateNumber($('#score-num'), score, 1000, (v) => Math.round(v));
  $('#score-level').textContent = r.overall.level;
  $('#score-level').style.color = color;
  $('#advice-summary').textContent = r.overall.summary;

  // AI 解读
  const aiBox = $('#ai-box');
  if (r.ai && r.ai.enabled) {
    aiBox.classList.remove('hidden');
    if (r.ai.text) { $('#ai-text').textContent = r.ai.text; $('#ai-error').textContent = ''; }
    else { $('#ai-text').textContent = ''; $('#ai-error').textContent = 'AI 生成失败：' + (r.ai.error || '未知错误') + '（已展示规则引擎结果）'; }
  } else {
    aiBox.classList.add('hidden');
  }

  $('#advice-operations').innerHTML = (r.overall.operations || []).map((o) => `<li>${esc(o)}</li>`).join('');
  $('#advice-risks').innerHTML = (r.overall.risks || []).map((o) => `<li>${esc(o)}</li>`).join('');

  renderCharts(r);
  renderHoldings(); // 建议就绪后刷新「我的持仓」顶部的组合汇总（总市值/盈亏）
}

/* ---------- 图表 ---------- */
let pieChart = null;
function renderCharts(r) {
  const funds = (r.funds || []).filter((f) => f.marketValue > 0);
  const sec = $('#charts-section');
  if (!funds.length) { sec.classList.add('hidden'); return; }
  sec.classList.remove('hidden');

  if (!pieChart) pieChart = echarts.init($('#pie-chart'));
  pieChart.setOption({
    tooltip: { trigger: 'item', formatter: '{b}<br/>市值 {c} 元（{d}%）' },
    series: [{
      type: 'pie', radius: ['40%', '68%'], center: ['50%', '54%'],
      label: { formatter: '{b}\n{d}%', fontSize: 11 },
      data: funds.map((f) => ({ name: f.name, value: Math.round(f.marketValue * 100) / 100 })),
    }],
  });
}

/* ---------- 持仓表 ---------- */
function renderHoldings() {
  const list = state.holdings;
  $('#holdings-count').textContent = `共 ${list.length} 只`;
  // 组合概览汇总（融合自原「组合概览」，数据来自最近一次建议）
  const p = state.advice && state.advice.portfolio;
  const ps = $('#portfolio-summary');
  if (ps) {
    if (p && p.fundCount) {
      ps.innerHTML = `
        <div class="ps-item"><span class="ps-label">总市值</span><b class="ps-value">${fmtWan(p.totalValue)}</b></div>
        <div class="ps-item"><span class="ps-label">累计盈亏</span><b class="ps-value ${pctClass(p.totalProfitPct)}">${fmtPct(p.totalProfitPct)}</b></div>
        <div class="ps-item"><span class="ps-label">${p.hasEstimate ? '今日估算' : '最近净值变动'}</span><b class="ps-value ${pctClass(p.todayPctWeighted)}">${fmtPct(p.todayPctWeighted)}</b>${p.todayProfit != null ? `<em class="ps-sub ${pctClass(p.todayProfit)}">约 ${p.todayProfit > 0 ? '+' : ''}${fmtWan(p.todayProfit)}</em>` : ''}</div>
        <div class="ps-item"><span class="ps-label">基金数量</span><b class="ps-value">${p.fundCount || 0}只</b></div>`;
      ps.classList.remove('hidden');
    } else {
      ps.innerHTML = '';
      ps.classList.add('hidden');
    }
  }
  const empty = $('#holdings-empty');
  const wrap = $('#holdings-table-wrap');
  if (!list.length) { empty.classList.remove('hidden'); wrap.classList.add('hidden'); return; }
  empty.classList.add('hidden');
  wrap.classList.remove('hidden');
  // 融合「各基金操作建议」：按代码合并建议数据（最新净值/涨跌/盈亏/操作信号），一只基金一行
  const funds = (state.advice && state.advice.funds) || [];
  const byCode = new Map(funds.map((f) => [f.code, f]));
  $('#holdings-rows').innerHTML = list.map((h) => {
    const f = byCode.get(h.code);
    const adviceTd = f ? `
      <td class="num">${fmtNum(f.nav)}${f.estimateAvailable ? `<br><span class="muted small">估值 ${fmtNum(f.estNav)}</span>` : ''}</td>
      <td class="num ${pctClass(f.todayPct)}">${fmtPct(f.todayPct)}${f.todaySource === 'nav' && f.todayPct != null ? '<br><span class="muted small">昨日净值</span>' : ''}</td>
      <td class="num ${pctClass(f.trends['1m'])}">${fmtPct(f.trends['1m'])}</td>
      <td class="num ${pctClass(f.trends['3m'])}">${fmtPct(f.trends['3m'])}</td>
      <td class="num ${pctClass(f.profitPct)}">${fmtPct(f.profitPct)}<br><span class="muted small">${f.profit > 0 ? '+' : ''}${fmtWan(f.profit)}</span></td>
      <td class="num">${f.weightPct}%</td>
      <td><span class="signal-badge ${sigClass(f.signal)}">${esc(f.signal)}</span><br><span class="muted small">${esc(f.signalReason)}</span></td>` : '<td class="num" colspan="7">--</td>';
    return `<tr>
      <td><b>${esc(h.name)}</b>${h.note ? `<br><span class="muted small">${esc(h.note)}</span>` : ''}</td>
      <td>${esc(h.code)}</td>
      <td class="num">${fmtNum(h.shares, 4)}</td>
      <td class="num">${fmtNum(h.costNav, 4)}</td>
      ${adviceTd}
      <td class="th-actions">
        <button class="btn small op-add" data-act="add" data-id="${h.id}" data-code="${h.code}" data-name="${esc(h.name)}">＋加仓</button>
        <button class="btn small op-reduce" data-act="reduce" data-id="${h.id}" data-code="${h.code}" data-name="${esc(h.name)}">－减仓</button>
        <button class="btn small" data-act="edit" data-id="${h.id}">编辑</button>
        <button class="btn small danger" data-act="del" data-id="${h.id}">删除</button>
      </td>
    </tr>`;
  }).join('');
}

/* ---------- 历史建议 ---------- */
function renderHistory() {
  const list = state.history;
  const wrap = $('#history-list');
  if (!list.length) { wrap.innerHTML = '<div class="empty small">暂无历史记录</div>'; return; }
  wrap.innerHTML = list.map((h) => `
    <div class="history-item" data-date="${h.date}">
      <span class="h-date">${h.date}</span>
      <span class="signal-badge" style="color:${h.level === '偏谨慎' ? '#1971c2' : h.level === '偏积极' ? '#e03131' : h.level === '中性偏多' ? '#f08c00' : '#666'}">${h.score ?? '--'}分 ${h.level}</span>
      <span class="muted">盈亏 ${fmtPct(h.totalProfitPct)}${h.aiText ? ' · AI' : ''}</span>
    </div>`).join('');
}

/* ---------- 设置表单 ---------- */
function fillSettingsForm() {
  const s = state.settings;
  if (!s) return;
  $('#set-risk').value = s.riskTolerance || '稳健';
  $('#set-sched-time').value = s.schedule.time || '14:30';
}

/* ---------- 弹窗 ---------- */
function openModal(h = null) {
  state.editingId = h ? h.id : null;
  $('#modal-title').textContent = h ? '编辑持仓' : '添加持仓';
  $('#f-code').value = h ? h.code : '';
  $('#f-name').value = h ? h.name : '';
  $('#f-shares').value = h ? h.shares : '';
  $('#f-costnav').value = h ? h.costNav : '';
  $('#f-note').value = h ? h.note || '' : '';
  $('#modal').classList.remove('hidden');
  $('#f-code').focus();
}
function closeModal() { $('#modal').classList.add('hidden'); state.editingId = null; }

/* ---------- 加仓/减仓弹窗 ---------- */
function openOpModal(h, type) {
  state.opState = { code: h.code, name: h.name, type };
  $('#op-title').textContent = (type === 'add' ? '加仓 ' : '减仓 ') + h.name;
  $('#op-name').value = h.name;
  $('#op-amount').value = '';
  $('#op-modal').classList.remove('hidden');
  $('#op-amount').focus();
}
function closeOpModal() { $('#op-modal').classList.add('hidden'); state.opState = null; }

// 拉取待执行操作并展示提示（下一个交易日生效）
async function loadOps() {
  try {
    const data = await api('/api/holdings/ops');
    const pending = (data.ops || []).filter((o) => o.status === 'pending');
    const el = $('#pending-ops');
    if (!el) return;
    if (!pending.length) { el.innerHTML = ''; return; }
    el.innerHTML = pending.map((o) =>
      `<span class="chip warn">${esc(o.name)} ${o.type === 'add' ? '加仓' : '减仓'} ${o.amount}元 · 预计 ${o.effDate} 生效</span>`
    ).join(' ');
  } catch (e) { console.warn('loadOps:', e); }
}

/* ---------- 数据加载 ---------- */
async function loadStatus() { try { state.status = await api('/api/status'); renderStatus(); } catch (e) { console.warn(e); } }
async function loadMarket() { try { state.market = (await api('/api/market')).market; renderMarket(); } catch (e) { console.warn(e); } }
async function loadHoldings() { state.holdings = await api('/api/holdings'); renderHoldings(); }
async function loadAdvice(date) {
  try {
    const q = date ? `?date=${date}` : '';
    const data = await api('/api/advice' + q);
    state.advice = data.record;
    state.viewingDate = date || null;
    renderAdvice();
  } catch (e) {
    state.advice = null;
    state.viewingDate = date || null; // 失败也重置查看状态，避免停留在过期历史日期
    renderAdvice();
  }
}
async function loadHistory() { try { state.history = (await api('/api/advice/history')).list; renderHistory(); } catch (e) { console.warn(e); } }
async function loadSettings() { try { state.settings = await api('/api/settings'); fillSettingsForm(); } catch (e) { console.warn(e); } }

// 持仓变更后自动同步：重新生成今日建议（含各基金操作建议表），并刷新页面
async function syncAdviceAfterHoldingsChange() {
  toast('持仓已更新，正在重新生成今日建议…');
  try {
    const res = await api('/api/advice/generate', { method: 'POST', body: { force: true } });
    toast('建议已重新生成，与当前持仓同步');
  } catch (e) {
    toast('持仓已更新，但建议刷新失败：' + e.message, true);
  }
  await Promise.all([loadStatus(), loadAdvice(), loadHistory()]);
}

/* ---------- 上传解析（SheetJS） ---------- */
function pickHeader(row, aliases) {
  for (const k of Object.keys(row)) {
    const key = String(k).replace(/^\uFEFF/, '').trim(); // 去掉 UTF-8 BOM（Excel/微信导出的 CSV 常见）
    for (const a of aliases) {
      if (key === a) return row[k];
    }
  }
  return undefined;
}
async function handleFile(file) {
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { type: 'array' });
  const ws = wb.Sheets[wb.SheetNames[0]];
  if (!ws) throw new Error('文件中没有工作表');
  const raw = XLSX.utils.sheet_to_json(ws, { defval: '' });
  const rows = raw.map((r) => ({
    code: pickHeader(r, ['基金代码', 'code', '代码']),
    name: pickHeader(r, ['基金名称', 'name', '名称']),
    shares: pickHeader(r, ['持有份额', 'shares', '份额']),
    costNav: pickHeader(r, ['成本净值', 'costNav', '成本']),
    note: pickHeader(r, ['备注', 'note']),
  })).filter((r) => r.code && String(r.code).trim());
  if (!rows.length) throw new Error('没有识别到有效数据行（请使用模板列名）');
  const res = await api('/api/holdings/import', { method: 'POST', body: { rows } });
  await Promise.all([loadHoldings(), syncAdviceAfterHoldingsChange()]);
  toast(`导入成功：新增 ${res.addedCount} 只，合并更新 ${rows.length - res.addedCount} 只，建议已同步刷新`);
}

/* ---------- 截图 OCR ---------- */
function openOcrModal() {
  $('#ocr-loading').classList.remove('hidden');
  $('#ocr-result').classList.add('hidden');
  $('#ocr-rows').innerHTML = '';
  const useAI = state.status && state.status.visionEnabled;
  $('#ocr-loading').textContent = useAI
    ? '⏳ 正在调用 AI 视觉模型识别图片中的基金…（通常 5~15 秒）'
    : '⏳ 正在用本地 OCR 识别图片中的基金…（首次需加载中文字库，可能约 1 分钟；之后会快很多）';
  $('#ocr-modal').classList.remove('hidden');
}
function closeOcrModal() { $('#ocr-modal').classList.add('hidden'); }

// 压缩图片：最长边 1600px、JPEG 0.88，大幅降低体积（利于 AI 接口上传与识别速度）
function compressImage(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        const max = 1600;
        let { width, height } = img;
        if (width > max || height > max) {
          const scale = max / Math.max(width, height);
          width = Math.round(width * scale);
          height = Math.round(height * scale);
        }
        const c = document.createElement('canvas');
        c.width = width; c.height = height;
        c.getContext('2d').drawImage(img, 0, 0, width, height);
        c.toBlob((blob) => resolve(blob || file), 'image/jpeg', 0.88);
      };
      img.onerror = reject;
      img.src = reader.result;
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function renderOcrRows(rows) {
  state.ocrRows = rows;
  const tbody = $('#ocr-rows');
  if (!rows.length) {
    tbody.innerHTML = '<tr><td colspan="7" class="empty">未识别到基金（既没找到基金代码，也没匹配到基金名称）。可能原因：截图不清晰 / 不是持仓页面 / 图片过大。可换一张再试，或手动添加。</td></tr>';
    $('#ocr-confirm').disabled = true;
    return;
  }
  $('#ocr-confirm').disabled = false;
  const methodBadge = (m) => {
    if (m === 'both') return '<span class="signal-badge hold">代码+名称</span>';
    if (m === 'name') return '<span class="signal-badge watch">按名称</span>';
    if (m === 'ai') return '<span class="signal-badge add">AI识别</span>';
    return '<span class="signal-badge add">按代码</span>';
  };
  tbody.innerHTML = rows.map((r, i) => `
    <tr>
      <td><input type="checkbox" data-i="${i}" checked></td>
      <td><b>${esc(r.name)}</b></td>
      <td>${esc(r.code)}</td>
      <td>${methodBadge(r.method)}</td>
      <td class="num">${r.amount ? fmtNum(r.amount) : '--'}${r.navUsed ? `<br><span class="muted small">净值 ${r.navUsed}${r.navDate ? ' (' + esc(r.navDate) + ')' : ''}</span>` : ''}</td>
      <td><input type="number" step="0.0001" min="0" data-i="${i}" data-k="shares" value="${r.shares ?? ''}" placeholder="${r.autoShares ? '自动' : '必填'}">${r.autoShares ? '<span class="muted small">自动</span>' : ''}</td>
      <td><input type="number" step="0.0001" min="0" data-i="${i}" data-k="costNav" value="${r.costNav ?? ''}" placeholder="${r.autoCostNav ? '自动' : '必填'}">${r.autoCostNav ? '<span class="muted small">自动</span>' : ''}</td>
    </tr>`).join('');
}

async function handleOcrFile(file) {
  openOcrModal();
  try {
    const blob = await compressImage(file); // 压缩后上传，提速且兼容 AI 接口体积限制
    const res = await fetch('/api/holdings/import-image?mode=auto', {
      method: 'POST',
      headers: { 'Content-Type': blob.type || 'image/jpeg' },
      body: blob,
    });
    const data = await res.json();
    if (!data.ok) throw new Error(data.error || '识别失败');
    $('#ocr-loading').classList.add('hidden');
    $('#ocr-result').classList.remove('hidden');
    const modeLabel = data.method === 'ai' ? `AI 识别（${data.model || '视觉模型'}）` : '本地 OCR';
    $('#ocr-title').textContent = `${modeLabel} · 用时 ${(data.elapsed / 1000).toFixed(1)} 秒`;
    $('#ocr-hint').textContent = data.rows.length
      ? `识别到 ${data.rows.length} 只基金。${data.autoCalculated ? '已按当日净值自动推算「持有份额」「成本净值」（标"自动"），请核对后确认导入。' : '请核对并补全「持有份额」「成本净值」，再确认导入。'}`
      : (data.aiError ? `AI 识别失败：${data.aiError}，已自动回退本地 OCR，仍未识别到基金。` : '未识别到基金代码。');
    $('#ocr-raw').textContent = data.rawText || '（无文本）';
    renderOcrRows(data.rows);
  } catch (e) {
    $('#ocr-loading').classList.add('hidden');
    $('#ocr-result').classList.remove('hidden');
    $('#ocr-title').textContent = '识别失败';
    $('#ocr-hint').textContent = '';
    $('#ocr-raw').textContent = '';
    $('#ocr-rows').innerHTML = `<tr><td colspan="6" class="empty">${esc(e.message)}<br>可以换一张清晰的持仓截图重试，或手动添加持仓。</td></tr>`;
    $('#ocr-confirm').disabled = true;
  }
}

/* ---------- 事件绑定 ---------- */
function bindEvents() {
  $('#btn-generate').addEventListener('click', async () => {
    const st = state.status;
    if (st && st.generating) return;
    let force = false;
    if (st && st.todayAdviceGenerated) {
      force = confirm('今日已生成过建议，是否强制重新生成（会覆盖今日记录）？');
      if (!force) return;
    }
    $('#btn-generate').disabled = true;
    $('#btn-generate').textContent = '⏳ 生成中…';
    try {
      const res = await api('/api/advice/generate', { method: 'POST', body: { force } });
      toast(res.cached ? '今日建议已存在，直接展示' : '已生成今日建议');
      await Promise.all([loadStatus(), loadAdvice(), loadHistory()]);
    } catch (e) {
      toast('生成失败：' + e.message, true);
      await loadStatus();
    }
  });

  $('#btn-add').addEventListener('click', () => openModal(null));
  $('#f-cancel').addEventListener('click', closeModal);
  $('#modal').addEventListener('click', (e) => { if (e.target === $('#modal')) closeModal(); });

  $('#f-lookup').addEventListener('click', async () => {
    const code = $('#f-code').value.trim();
    if (!/^\d{6}$/.test(code)) { toast('请输入 6 位基金代码', true); return; }
    try {
      const d = await api('/api/fund/info?code=' + code);
      $('#f-name').value = d.fund.name;
      toast(`已识别：${d.fund.name}${d.fund.nav ? `（最新净值 ${d.fund.nav}）` : ''}`);
    } catch (e) { toast('未找到该基金：' + e.message, true); }
  });

  $('#holding-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const body = {
      code: $('#f-code').value.trim(),
      name: $('#f-name').value.trim(),
      shares: Number($('#f-shares').value),
      costNav: Number($('#f-costnav').value),
      note: $('#f-note').value.trim(),
    };
    try {
      if (state.editingId) await api('/api/holdings/' + state.editingId, { method: 'PUT', body });
      else await api('/api/holdings', { method: 'POST', body });
      closeModal();
      await Promise.all([loadHoldings(), syncAdviceAfterHoldingsChange()]);
    } catch (err) { toast('保存失败：' + err.message, true); }
  });

  $('#holdings-rows').addEventListener('click', async (e) => {
    const btn = e.target.closest('button[data-act]');
    if (!btn) return;
    const id = btn.dataset.id;
    const h = state.holdings.find((x) => x.id === id);
    if (btn.dataset.act === 'edit') openModal(h);
    else if (btn.dataset.act === 'add' || btn.dataset.act === 'reduce') openOpModal(h, btn.dataset.act);
    else if (btn.dataset.act === 'del') {
      if (!confirm(`确定删除 ${h.name}（${h.code}）？`)) return;
      await api('/api/holdings/' + id, { method: 'DELETE' });
      await Promise.all([loadHoldings(), syncAdviceAfterHoldingsChange()]);
    }
  });

  $('#op-cancel').addEventListener('click', closeOpModal);
  $('#op-modal').addEventListener('click', (e) => { if (e.target === $('#op-modal')) closeOpModal(); });
  $('#op-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!state.opState) return;
    const amount = Number($('#op-amount').value);
    if (!Number.isFinite(amount) || amount <= 0) { toast('请输入有效的操作金额', true); return; }
    const body = { code: state.opState.code, type: state.opState.type, amount };
    try {
      const res = await api('/api/holdings/ops', { method: 'POST', body });
      closeOpModal();
      toast(`已提交${state.opState.type === 'add' ? '加仓' : '减仓'} ${res.op.amount} 元，将于 ${res.op.effDate} 自动生效`);
      await loadOps();
    } catch (err) { toast('提交失败：' + err.message, true); }
  });

  $('#btn-import').addEventListener('click', () => $('#file-input').click());
  $('#btn-ocr').addEventListener('click', () => $('#file-ocr').click());
  $('#file-ocr').addEventListener('change', async (e) => {
    const f = e.target.files[0];
    e.target.value = '';
    if (!f) return;
    await handleOcrFile(f);
  });
  $('#ocr-cancel').addEventListener('click', closeOcrModal);
  $('#ocr-modal').addEventListener('click', (e) => { if (e.target === $('#ocr-modal')) closeOcrModal(); });
  $('#ocr-reupload').addEventListener('click', () => $('#file-ocr').click());
  $('#ocr-rows').addEventListener('input', (e) => {
    const el = e.target;
    if (!el.dataset || el.dataset.i === undefined) return;
    const row = state.ocrRows[Number(el.dataset.i)];
    if (row && el.dataset.k) row[el.dataset.k] = el.value === '' ? null : Number(el.value);
  });
  $('#ocr-confirm').addEventListener('click', async () => {
    const rows = [];
    for (let i = 0; i < state.ocrRows.length; i++) {
      const r = state.ocrRows[i];
      const cb = document.querySelector(`#ocr-rows input[type="checkbox"][data-i="${i}"]`);
      if (cb && !cb.checked) continue;
      if (!r.shares || !(r.shares > 0) || !r.costNav || !(r.costNav > 0)) {
        toast(`「${r.name}」需要填写持有份额和成本净值`, true);
        return;
      }
      rows.push({ code: r.code, name: r.name, shares: r.shares, costNav: r.costNav });
    }
    if (!rows.length) { toast('请至少勾选一只基金', true); return; }
    try {
      const res = await api('/api/holdings/import', { method: 'POST', body: { rows } });
      closeOcrModal();
      await Promise.all([loadHoldings(), syncAdviceAfterHoldingsChange()]);
      toast(`已导入 ${rows.length} 只基金，建议已同步刷新`);
    } catch (err) { toast('导入失败：' + err.message, true); }
  });
  $('#file-input').addEventListener('change', async (e) => {
    const f = e.target.files[0];
    e.target.value = '';
    if (!f) return;
    try { await handleFile(f); } catch (err) { toast('导入失败：' + err.message, true); }
  });

  $('#history-list').addEventListener('click', (e) => {
    const item = e.target.closest('.history-item');
    if (!item) return;
    document.querySelectorAll('.history-item').forEach((x) => x.classList.remove('active'));
    item.classList.add('active');
    loadAdvice(item.dataset.date);
    $('#advice-section').scrollIntoView({ behavior: 'smooth' });
  });

  $('#settings-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const body = {
      riskTolerance: $('#set-risk').value,
      schedule: { time: $('#set-sched-time').value || '14:30' }, // 仅调整时间，自动生成保持启用
    };
    try {
      const res = await api('/api/settings', { method: 'PUT', body });
      state.settings = res.settings;
      fillSettingsForm();
      toast('设置已保存');
      await loadStatus();
    } catch (err) { toast('保存失败：' + err.message, true); }
  });

  window.addEventListener('resize', () => { if (pieChart) pieChart.resize(); });
}

/* ---------- 启动 ---------- */
async function init() {
  bindEvents();
  await Promise.all([loadStatus(), loadMarket(), loadHoldings(), loadAdvice(), loadHistory(), loadSettings(), loadOps()]);
  setInterval(() => {
    loadStatus();
    loadMarket();
    loadOps(); // 定时刷新待生效操作（跨日后服务端会自动结算）
    // 页面停在“今日”时跟随自动生成结果
    if (!state.viewingDate) loadAdvice();
  }, 60_000);
}
init();
