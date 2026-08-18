import { INDEXES, EXTRA_INDEXES } from './config.js';
import { isWithinTradingHours, shNow } from './time.js';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36';
const TIMEOUT = 8000;

async function fetchText(url, referer) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: {
        'User-Agent': UA,
        ...(referer ? { Referer: referer } : {}),
        Accept: '*/*',
      },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.text();
  } finally {
    clearTimeout(timer);
  }
}

// ---------- 指数行情（东方财富；30s 缓存，避免高频请求触发限流） ----------
let idxCache = null;
export async function getIndexQuotes() {
  if (idxCache && Date.now() - idxCache.ts < 30 * 1000) return idxCache.data;
  const secids = [...INDEXES, ...EXTRA_INDEXES].map((i) => i.secid).join(',');
  const url = `https://push2.eastmoney.com/api/qt/ulist.np/get?secids=${secids}&fields=f2,f3,f4,f5,f6,f12,f14&fltt=2&invt=2`;
  const text = await fetchText(url, 'https://quote.eastmoney.com/');
  const json = JSON.parse(text);
  const diff = (json.data && json.data.diff) || [];
  const byCode = {};
  for (const d of diff) {
    byCode[d.f12] = {
      code: d.f12,
      name: d.f14,
      price: d.f2,
      pct: d.f3,
      change: d.f4,
      volume: d.f5,
      amount: d.f6,
    };
  }
  const list = [];
  let weightedPct = 0;
  let totalAmount = 0;
  let n = 0;
  for (const idx of INDEXES) {
    const q = byCode[idx.secid.split('.')[1]];
    if (q) {
      list.push(q);
      if (typeof q.pct === 'number') {
        weightedPct += q.pct * idx.weight;
        n++;
      }
      if (typeof q.amount === 'number') totalAmount += q.amount;
    }
  }
  const data = {
    list,
    weightedPct: n ? weightedPct : null,
    totalAmount,
    fetchedAt: shNow().toISOString(),
  };
  idxCache = { ts: Date.now(), data };
  return data;
}

// ---------- 基金净值（腾讯行情，GBK 编码） ----------
async function fetchTencentFund(code) {
  const url = `https://qt.gtimg.cn/q=jj${code}`;
  const res = await fetch(url, {
    headers: { 'User-Agent': UA, Referer: 'https://gu.qq.com/' },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  const text = new TextDecoder('gbk').decode(buf);
  const m = text.match(/v_jj\d+="([^"]+)"/);
  if (!m) throw new Error('腾讯基金接口返回格式异常');
  const f = m[1].split('~');
  // 0:code 1:name 2:今日估算净值(盘中) 3:估算涨跌幅% 4:? 5:单位净值 6:累计净值 7:日增长率% 8:净值日期
  return {
    code,
    name: f[1],
    nav: Number(f[5]) || null,
    accNav: Number(f[6]) || null,
    chgPct: f[7] !== undefined && f[7] !== '' ? Number(f[7]) : null,
    navDate: f[8] || null,
    estNav: Number(f[2]) || null,
    estChgPct: f[3] !== undefined && f[3] !== '' ? Number(f[3]) : null,
  };
}

// ---------- 基金实时（新浪，含盘中估算） ----------
async function fetchSinaFund(code) {
  const url = `https://hq.sinajs.cn/list=f_${code}`;
  const res = await fetch(url, {
    headers: { 'User-Agent': UA, Referer: 'https://finance.sina.com.cn' },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  const text = new TextDecoder('gbk').decode(buf);
  const m = text.match(/="([^"]*)"/);
  if (!m || !m[1]) throw new Error('新浪基金接口返回为空');
  const f = m[1].split(',');
  // 0:名称 1:单位净值 2:累计净值 3:盘中估值净值(交易时段) 4:净值日期 5:总份额(亿份)
  return {
    code,
    name: f[0],
    nav: Number(f[1]) || null,
    accNav: Number(f[2]) || null,
    estNav: Number(f[3]) || null,
    navDate: f[4] || null,
    shares: Number(f[5]) || null,
  };
}

// ---------- 基金盘中估值（新浪 hq.sinajs.cn，目前免费公开源中唯一稳定可用） ----------
async function fetchSinaEstimate(code) {
  const url = `https://hq.sinajs.cn/list=f_${code}`;
  const res = await fetch(url, {
    headers: { 'User-Agent': UA, Referer: 'https://finance.sina.com.cn' },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  const text = new TextDecoder('gbk').decode(buf);
  const m = text.match(/="([^"]*)"/);
  if (!m || !m[1]) throw new Error('新浪估值接口返回为空');
  const f = m[1].split(',');
  // 0:名称 1:单位净值 2:累计净值 3:盘中估值净值(交易时段) 4:净值日期 5:总份额(亿份)
  return {
    code,
    name: f[0],
    nav: Number(f[1]) || null,
    accNav: Number(f[2]) || null,
    estNav: Number(f[3]) || null,
    navDate: f[4] || null,
    shares: Number(f[5]) || null,
  };
}

// ---------- 批量实时估值（前端 60s 轮询用；不读缓存，实时拉取） ----------
export async function getFundEstimates(codes) {
  const list = [];
  for (const code of codes) {
    try {
      const d = await fetchSinaEstimate(code);
      const nav = d.nav || 0;
      // 板块联动估算优先（对指数/主题基金更准），新浪估值兜底
      let est = d.estNav || 0;
      let src = '新浪估值';
      let chg = nav > 0 && est > 0 && est / nav > 0.85 && est / nav < 1.15 ? Math.round((est / nav - 1) * 10000) / 100 : null;
      const bySector = await estimateFundBySector(d.name, code).catch(() => null);
      if (bySector && typeof bySector.pct === 'number' && nav > 0) {
        est = Math.round(nav * (1 + bySector.pct / 100) * 10000) / 10000;
        chg = bySector.pct;
        src = bySector.source;
      }
      const sane = est > 0 && nav > 0 && est / nav > 0.85 && est / nav < 1.15;
      list.push({
        code,
        name: d.name || code,
        nav,
        navDate: d.navDate || null,
        estNav: sane ? est : null,
        estChgPct: sane ? chg : null,
        estimateSource: sane ? src : null,
        estimateAvailable: !!sane,
      });
    } catch (e) {
      list.push({ code, error: e.message, estimateAvailable: false });
    }
  }
  return { list, fetchedAt: shNow().toISOString() };
}

// ---------- 基金历史净值（东方财富 pingzhongdata） ----------
export async function fetchFundHistory(code) {
  const url = `https://fund.eastmoney.com/pingzhongdata/${code}.js`;
  const text = await fetchText(url, 'https://fund.eastmoney.com/');
  const nameM = text.match(/fS_name\s*=\s*"([^"]+)"/);
  const name = nameM ? nameM[1] : code;
  const trendM = text.match(/var Data_netWorthTrend\s*=\s*(\[[\s\S]*?\]);/);
  if (!trendM) throw new Error('未找到净值序列');
  const arr = JSON.parse(trendM[1]);
  const points = arr
    .map((p) => ({ date: new Date(p.x).toISOString().slice(0, 10), nav: p.y }))
    .filter((p) => typeof p.nav === 'number' && p.nav > 0);
  if (!points.length) throw new Error('净值序列为空');
  const last = points[points.length - 1];
  const pct = (n) => (n > 0 && points.length - 1 - n >= 0 ? (last.nav / points[points.length - 1 - n].nav - 1) * 100 : null);
  return {
    code,
    name,
    latestNav: last.nav,
    navDate: last.date,
    trends: {
      '1w': pct(5),
      '1m': pct(21),
      '3m': pct(63),
      '6m': pct(126),
      '1y': pct(250),
    },
    history: points.slice(-130),
  };
}

// ---------- 合并报价 ----------
const quoteCache = new Map();
const historyCache = new Map();

function saneEstimate(estNav, nav) {
  if (!estNav || !nav || estNav <= 0) return false;
  const ratio = estNav / nav;
  return ratio > 0.85 && ratio < 1.15;
}

export async function getFundQuote(code) {
  const cached = quoteCache.get(code);
  if (cached && Date.now() - cached.ts < 5 * 60 * 1000) return cached.data;
  let tencent = null;
  let sina = null;
  const errors = [];
  try {
    tencent = await fetchTencentFund(code);
  } catch (e) {
    errors.push(`腾讯:${e.message}`);
  }
  try {
    sina = await fetchSinaFund(code);
  } catch (e) {
    errors.push(`新浪:${e.message}`);
  }

  const nav = (tencent && tencent.nav) || (sina && sina.nav) || null;
  const navDate = (tencent && tencent.navDate) || (sina && sina.navDate) || null;
  const name = (tencent && tencent.name) || (sina && sina.name) || code;

  let estNav = null;
  let estChgPct = null;
  let estimateSource = null;
  let estTime = null;
  if (isWithinTradingHours()) {
    // ① 优先板块联动估算：按基金主题匹配实时板块/指数涨跌（对指数/主题基金更准）
    const bySector = await estimateFundBySector(name, code).catch(() => null);
    if (bySector && typeof bySector.pct === 'number' && nav > 0) {
      estNav = Math.round(nav * (1 + bySector.pct / 100) * 10000) / 10000;
      estChgPct = bySector.pct;
      estimateSource = bySector.source;
    } else if (sina && saneEstimate(sina.estNav, sina.nav || nav)) {
      // ② 回退新浪估值
      estNav = sina.estNav;
      estChgPct = nav ? (sina.estNav / nav - 1) * 100 : null;
      estimateSource = '新浪估值';
    }
  }

  const data = {
    code,
    name,
    nav,
    navDate,
    chgPct: (tencent && tencent.chgPct) || null,
    estNav,
    estChgPct,
    estimateSource,
    estimateAvailable: !!estNav,
    estTime,
    errors,
  };
  quoteCache.set(code, { ts: Date.now(), data });
  return data;
}

export async function getFundHistory(code) {
  const cached = historyCache.get(code);
  if (cached && Date.now() - cached.ts < 30 * 60 * 1000) return cached.data;
  const data = await fetchFundHistory(code);
  historyCache.set(code, { ts: Date.now(), data });
  return data;
}

export function clearFundCache(code) {
  quoteCache.delete(code);
  historyCache.delete(code);
}

// ---------- A股大盘指数（腾讯行情，GBK） ----------
const STOCK_INDEX_CODES = [
  { q: 'sh000001', name: '上证指数' },
  { q: 'sz399001', name: '深证成指' },
  { q: 'sz399006', name: '创业板指' },
  { q: 'sh000300', name: '沪深300' },
];
export async function getStockIndices() {
  const url = `https://qt.gtimg.cn/q=${STOCK_INDEX_CODES.map((i) => i.q).join(',')}`;
  const res = await fetch(url, { headers: { 'User-Agent': UA, Referer: 'https://gu.qq.com/' } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  const text = new TextDecoder('gbk').decode(buf);
  const list = [];
  for (const line of text.split(';')) {
    const m = line.match(/v_([a-z]+\d+)="([^"]*)"/);
    if (!m || !m[2]) continue;
    const f = m[2].split('~');
    // 1名称 2代码 3最新 4昨收 5今开 30时间 31涨跌额 32涨跌幅 33最高 34最低 36成交量(手) 37成交额(万元)
    const item = {
      code: f[2],
      name: f[1],
      price: Number(f[3]),
      prevClose: Number(f[4]),
      open: Number(f[5]),
      change: Number(f[31]),
      pct: Number(f[32]),
      high: Number(f[33]),
      low: Number(f[34]),
      volume: Number(f[36]),
      amount: Number(f[37]),
      time: f[30],
    };
    if (item.code) list.push(item);
  }
  return { list, fetchedAt: shNow().toISOString() };
}

// ---------- 行情分析技能：指数技术面快照（量能/振幅/位置） ----------
export async function getIndexTech() {
  const { list } = await getStockIndices();
  const tech = list.map((q) => {
    const amplitude = q.prevClose > 0 ? ((q.high - q.low) / q.prevClose) * 100 : null; // 振幅%
    const position = q.prevClose > 0 ? ((q.price - q.low) / Math.max(q.high - q.low, 1e-9)) * 100 : null; // 日内位置
    return {
      code: q.code,
      name: q.name,
      price: q.price,
      pct: q.pct,
      open: q.open,
      high: q.high,
      low: q.low,
      amplitude: Math.round(amplitude * 10) / 10,
      position: Math.round(position), // 0=贴近最低 100=贴近最高
      amountYi: Math.round((q.amount / 10000) * 10) / 10, // 成交额(亿)
      volume: q.volume,
    };
  });
  return { list: tech, fetchedAt: shNow().toISOString() };
}

// ---------- 行情分析技能：行业板块资金动向（东财板块榜） ----------
async function fetchSectorsByOrder(po) {
  // po=1 涨幅榜，po=0 跌幅榜；fs=m:90+t:2 行业板块
  const url = `https://push2.eastmoney.com/api/qt/clist/get?pn=1&pz=8&po=${po}&np=1&fltt=2&invt=2&fid=f3&fs=m:90+t:2&fields=f2,f3,f12,f14,f104,f105,f128`;
  const text = await fetchText(url, 'https://quote.eastmoney.com/');
  const json = JSON.parse(text);
  const diff = (json.data && json.data.diff) || [];
  return diff.map((d) => ({
    code: d.f12,
    name: d.f14,
    pct: d.f3,
    up: d.f104,
    down: d.f105,
    leader: d.f128 || null, // 领涨股
  }));
}
export async function getSectorQuotes() {
  if (sectorQuotesCache && Date.now() - sectorQuotesCache.ts < 30 * 1000) return sectorQuotesCache.data;
  const [gains, losses] = await Promise.allSettled([
    fetchSectorsByOrder(1),
    fetchSectorsByOrder(0),
  ]);
  const gainsList = gains.status === 'fulfilled' ? gains.value : [];
  const lossesList = losses.status === 'fulfilled' ? losses.value : [];
  const list = [...gainsList.slice(0, 6), ...lossesList.slice(0, 6)];
  if (!list.length) throw new Error('板块行情获取失败');
  const data = { list, gains: gainsList.slice(0, 6), losses: lossesList.slice(0, 6), fetchedAt: shNow().toISOString() };
  sectorQuotesCache = { ts: Date.now(), data };
  return data;
}
let sectorQuotesCache = null;

// ---------- 板块资金流向（主力净流入榜；东财 push2，缓存 30s 防限流） ----------
let moneyFlowCache = null;
async function fetchSectorsByMoney(po) {
  // fid=f62 按主力净流入排序；po=1 净流入榜，po=0 净流出榜
  const url = `https://push2.eastmoney.com/api/qt/clist/get?pn=1&pz=8&po=${po}&np=1&fltt=2&invt=2&fid=f62&fs=m:90+t:2&fields=f3,f12,f14,f62,f184,f66,f72,f78,f84`;
  const text = await fetchText(url, 'https://emdata.eastmoney.com/');
  const json = JSON.parse(text);
  const diff = (json.data && json.data.diff) || [];
  return diff.map((d) => ({
    code: d.f12,
    name: d.f14,
    pct: d.f3,
    mainNet: d.f62,        // 主力净流入（元）
    mainPct: d.f184,       // 主力净占比 %
    xlNet: d.f66,          // 超大单净流入
    lNet: d.f72,           // 大单净流入
    mNet: d.f78,           // 中单净流入
    sNet: d.f84,           // 小单净流入
  }));
}
export async function getSectorMoneyFlow() {
  if (moneyFlowCache && Date.now() - moneyFlowCache.ts < 30 * 1000) return moneyFlowCache.data;
  const [inflow, outflow] = await Promise.allSettled([
    fetchSectorsByMoney(1),
    fetchSectorsByMoney(0),
  ]);
  const inflowList = inflow.status === 'fulfilled' ? inflow.value : [];
  const outflowList = outflow.status === 'fulfilled' ? outflow.value : [];
  const list = [...inflowList.slice(0, 6), ...outflowList.slice(0, 6)];
  if (!list.length) throw new Error('资金流向获取失败');
  const data = { list, inflows: inflowList.slice(0, 6), outflows: outflowList.slice(0, 6), fetchedAt: shNow().toISOString() };
  moneyFlowCache = { ts: Date.now(), data };
  return data;
}

// ---------- 板块联动估算：主流行业板块全量（涨幅榜+跌幅榜+成交额榜合并，缓存 120s） ----------
let sectorsAllCache = null;
async function getAllSectors() {
  if (sectorsAllCache && Date.now() - sectorsAllCache.ts < 120 * 1000) return sectorsAllCache.data;
  const base = 'https://push2.eastmoney.com/api/qt/clist/get?pn=1&np=1&fltt=2&invt=2&fs=m:90+t:2&fields=f3,f12,f14';
  const urls = [
    `${base}&pz=100&po=1&fid=f3`,   // 涨幅榜
    `${base}&pz=100&po=0&fid=f3`,   // 跌幅榜
    `${base}&pz=100&po=1&fid=f6`,   // 成交额榜
  ];
  const results = await Promise.allSettled(urls.map(async (u) => {
    try {
      const text = await fetchText(u, 'https://quote.eastmoney.com/');
      const json = JSON.parse(text);
      return ((json.data && json.data.diff) || []);
    } catch { return []; }
  }));
  const map = new Map();
  for (const r of results) {
    if (r.status !== 'fulfilled') continue;
    for (const d of r.value) {
      const pct = Number(d.f3);
      if (d.f14 && typeof pct === 'number' && !map.has(d.f12)) map.set(d.f12, { code: d.f12, name: d.f14, pct });
    }
  }
  const data = [...map.values()];
  if (!data.length) throw new Error('板块数据获取失败');
  sectorsAllCache = { ts: Date.now(), data };
  return data;
}

// 基金名称关键词 → 行业板块（东财板块名）映射规则
const SECTOR_RULES = [
  { kws: ['白酒', '酒'], sector: '酿酒' },
  { kws: ['医药', '医疗', '生物', '药', '健康'], sector: '医药' },
  { kws: ['半导体', '芯片', '集成电路', '科创'], sector: '半导体' },
  { kws: ['科技', '计算机', '软件', '信息技术', '电子'], sector: '计算机' },
  { kws: ['新能源', '电池', '光伏', '锂'], sector: '电池' },
  { kws: ['消费', '食品', '饮料', '农业'], sector: '食品饮料' },
  { kws: ['证券', '券商', '金融'], sector: '证券' },
  { kws: ['军工', '国防', '航天'], sector: '国防军工' },
  { kws: ['地产', '房地产'], sector: '房地产' },
  { kws: ['银行'], sector: '银行' },
  { kws: ['有色', '稀土', '黄金', '贵金属'], sector: '有色金属' },
  { kws: ['煤炭', '能源'], sector: '煤炭' },
  { kws: ['化工', '材料'], sector: '化学制品' },
  { kws: ['钢铁'], sector: '钢铁' },
  { kws: ['汽车', '智能驾驶', '整车'], sector: '汽车整车' },
  { kws: ['传媒', '游戏', '互联网'], sector: '游戏' },
  { kws: ['家电', '家用电器'], sector: '家用电器' },
  { kws: ['环保'], sector: '环保行业' },
  { kws: ['基建', '建筑', '建材'], sector: '工程建设' },
  { kws: ['通信', '5G', '光模块'], sector: '通信设备' },
  { kws: ['机械', '高端装备'], sector: '通用设备' },
  { kws: ['养殖', '畜牧'], sector: '农牧饲渔' },
  { kws: ['航运', '物流'], sector: '物流行业' },
  { kws: ['旅游', '酒店', '免税'], sector: '旅游酒店' },
  { kws: ['教育'], sector: '教育' },
  { kws: ['纺织', '服装'], sector: '纺织服装' },
];

// 指数基金 → 宽基指数匹配（用东财指数行情）
const INDEX_RULES = [
  { kws: ['沪深300'], idx: '沪深300' },
  { kws: ['中证500'], idx: '中证500' },
  { kws: ['上证50', '上证180'], idx: '上证指数' },
  { kws: ['创业板'], idx: '创业板指' },
  { kws: ['中证1000'], idx: '深证成指' },
];

// 按基金名称匹配板块/指数，返回实时估算涨跌幅；匹配不到返回 null
export async function estimateFundBySector(name, code) {
  if (!name) return null;
  const full = name + (code || '');
  // ① 宽基指数基金（指数名称直接对应）
  try {
    const idxList = await getIndexQuotes();
    for (const rule of INDEX_RULES) {
      if (rule.kws.some((k) => full.includes(k))) {
        const q = (idxList.list || []).find((x) => x.name === rule.idx);
        if (q && typeof q.pct === 'number') return { pct: q.pct, source: `板块估算·${rule.idx}` };
      }
    }
  } catch { /* 忽略 */ }
  // ② 行业主题基金（关键词 → 板块实时涨跌）
  try {
    const sectors = await getAllSectors();
    for (const rule of SECTOR_RULES) {
      if (rule.kws.some((k) => full.includes(k))) {
        const s = (sectors || []).find((x) => x.name && x.name.includes(rule.sector));
        if (s && typeof s.pct === 'number') return { pct: s.pct, source: `板块估算·${s.name}` };
        // 板块名可能不同（如"白酒"在BK里就叫"白酒"），再模糊匹配一次
        const s2 = (sectors || []).find((x) => x.name && (rule.sector.includes(x.name) || x.name.includes(rule.sector)));
        if (s2 && typeof s2.pct === 'number') return { pct: s2.pct, source: `板块估算·${s2.name}` };
      }
    }
  } catch { /* 忽略 */ }
  return null;
}

// ---------- 热点新闻（东方财富快讯，新浪7x24备选） ----------
async function fetchEastmoneyNews() {
  const url = 'https://newsapi.eastmoney.com/kuaixun/v1/getlist_102_ajaxResult_50_1_.html';
  const text = await fetchText(url, 'https://finance.eastmoney.com/');
  const m = text.match(/var ajaxResult=(\{[\s\S]*\})/);
  if (!m) throw new Error('东财快讯返回格式异常');
  const json = JSON.parse(m[1]);
  const items = (json.LivesList || []).map((n) => ({
    id: n.id,
    title: n.title || n.simtitle || '财经快讯',
    digest: (n.digest || '').replace(/^【[^】]*】/, ''),
    url: n.url_w || n.url_unique || null,
    time: n.showtime || null,
  }));
  if (!items.length) throw new Error('东财快讯为空');
  return items;
}
async function fetchSinaNews() {
  const url = 'https://zhibo.sina.com.cn/api/zhibo/feed?page=1&page_size=20&zhibo_id=152&tag_id=0&dire=f&dpc=1';
  const json = JSON.parse(await fetchText(url, 'https://finance.sina.com.cn/'));
  const list = (json.result && json.result.data && json.result.data.feed && json.result.data.feed.list) || [];
  return list.map((n) => {
    let docUrl = null;
    try {
      const ext = JSON.parse(n.ext || '{}');
      docUrl = ext.docurl || null;
    } catch (e) { /* ignore */ }
    const rich = n.rich_text || '';
    return {
      id: String(n.id),
      title: rich.slice(0, 60),
      digest: rich,
      url: docUrl,
      time: n.create_time || null,
    };
  });
}
export async function getHotNews() {
  let items = [];
  let source = 'eastmoney';
  try {
    items = await fetchEastmoneyNews();
  } catch (e) {
    try {
      items = await fetchSinaNews();
      source = 'sina';
    } catch (e2) {
      throw new Error(`新闻源不可用: ${e.message} / ${e2.message}`);
    }
  }
  return { list: items.slice(0, 20), source, fetchedAt: shNow().toISOString() };
}