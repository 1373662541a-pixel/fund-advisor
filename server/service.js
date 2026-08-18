import { buildAnalysis } from './analysis.js';
import { enhanceWithAI } from './ai.js';
import { getHotNews, getSectorQuotes, getIndexTech, getSectorMoneyFlow } from './market.js';
import { shDateStr } from './time.js';
import { isTradingDay } from './trading.js';

let generating = false;
let lastRun = null;

export function isGenerating() {
  return generating;
}

export function getLastRun() {
  return lastRun;
}

export async function generateAdvice({ force = false } = {}, userStore) {
  if (!userStore) return { ok: false, error: '缺少用户上下文' };
  if (generating) {
    return { ok: false, error: '已有一次生成正在进行中，请稍候再试', busy: true };
  }
  generating = true;
  const date = shDateStr();
  try {
    if (!force) {
      const existing = userStore.getAdvice(date);
      if (existing) {
        lastRun = { time: new Date().toISOString(), ok: true, date, cached: true };
        return { ok: true, record: existing, cached: true };
      }
    }
    const settings = userStore.getSettings();
    const holdings = userStore.getHoldings();
    const analysis = await buildAnalysis(holdings, settings);
    analysis.date = date;
    analysis.generatedAt = new Date().toISOString();
    analysis.isTradingDay = isTradingDay(date);
    analysis.engineVersion = settings.engine.version;
    // 拉取当日消息面（热点新闻）+ 行情分析技能数据（板块资金动向/指数技术面），供 AI 决策使用；失败不阻塞生成
    try {
      analysis.news = await getHotNews();
    } catch (e) {
      analysis.news = { list: [], error: e.message };
    }
    const [sectorsRes, techRes, moneyRes] = await Promise.allSettled([getSectorQuotes(), getIndexTech(), getSectorMoneyFlow()]);
    analysis.market.sectors = sectorsRes.status === 'fulfilled' ? sectorsRes.value.list : [];
    analysis.market.sectorError = sectorsRes.status === 'rejected' ? sectorsRes.reason.message : null;
    analysis.market.tech = techRes.status === 'fulfilled' ? techRes.value.list : [];
    analysis.market.techError = techRes.status === 'rejected' ? techRes.reason.message : null;
    analysis.market.moneyFlow = moneyRes.status === 'fulfilled' ? moneyRes.value.list : [];
    analysis.market.moneyFlowError = moneyRes.status === 'rejected' ? moneyRes.reason.message : null;
    const aiResult = await enhanceWithAI(analysis, settings);
    const record = { ...analysis, ai: aiResult };
    userStore.saveAdvice(date, record);
    lastRun = { time: new Date().toISOString(), ok: true, date, cached: false };
    return { ok: true, record, cached: false };
  } catch (e) {
    lastRun = { time: new Date().toISOString(), ok: false, date, error: e.message };
    return { ok: false, error: e.message, stack: e.stack };
  } finally {
    generating = false;
  }
}