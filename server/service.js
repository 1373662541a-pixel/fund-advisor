import { buildAnalysis } from './analysis.js';
import { enhanceWithAI } from './ai.js';
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
