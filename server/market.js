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

// ---------- 指数行情（东方财富） ----------
export async function getIndexQuotes() {
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
  return {
    list,
    weightedPct: n ? weightedPct : null,
    totalAmount,
    fetchedAt: shNow().toISOString(),
  };
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

// ---------- 基金盘中估值（东方财富 fundgz，基金公司口径，最常用/较准） ----------
async function fetchEastmoneyEstimate(code) {
  const url = `https://fundgz.1234567.com.cn/js/${code}.js`;
  const text = await fetchText(url, 'https://fund.eastmoney.com/');
  const m = text.match(/jsonpgz\((\{[\s\S]*?\})\)\s*;/);
  if (!m) throw new Error('东财估值接口返回格式异常');
  const j = JSON.parse(m[1]);
  return {
    code,
    name: j.name || null,
    nav: j.dwjz !== undefined ? Number(j.dwjz) : null,
    navDate: j.jzrq || null,
    estNav: j.gsz !== undefined ? Number(j.gsz) : null,
    estChgPct: j.gszzl !== undefined ? Number(j.gszzl) : null,
    estTime: j.gztime || null,
  };
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
  let emEst = null;
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
  try {
    emEst = await fetchEastmoneyEstimate(code);
  } catch (e) {
    errors.push(`东财估值:${e.message}`);
  }

  const nav = (emEst && emEst.nav) || (tencent && tencent.nav) || (sina && sina.nav) || null;
  const navDate = (emEst && emEst.navDate) || (tencent && tencent.navDate) || (sina && sina.navDate) || null;
  const name = (emEst && emEst.name) || (tencent && tencent.name) || (sina && sina.name) || code;

  let estNav = null;
  let estChgPct = null;
  let estimateSource = null;
  let estTime = null;
  if (isWithinTradingHours()) {
    // 优先东方财富基金公司口径估值，其次腾讯，最后新浪
    if (emEst && saneEstimate(emEst.estNav, emEst.nav || nav)) {
      estNav = emEst.estNav;
      estChgPct = emEst.estChgPct;
      estimateSource = '东财估值';
      estTime = emEst.estTime;
    } else if (tencent && saneEstimate(tencent.estNav, tencent.nav || nav)) {
      estNav = tencent.estNav;
      estChgPct = tencent.estChgPct;
      estimateSource = '腾讯估值';
    } else if (sina && saneEstimate(sina.estNav, sina.nav || nav)) {
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