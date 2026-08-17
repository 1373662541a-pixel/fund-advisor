import { store } from './storage.js';
import { isWeekend, shDateStrOf } from './time.js';

// 交易日判断：周一~周五，且不在节假日列表中（调休上班的周末也算交易日）
export function isTradingDay(dateStr) {
  const d = new Date(dateStr + 'T12:00:00+08:00');
  if (Number.isNaN(d.getTime())) return false;
  if (isWeekend(d)) {
    const h = store.getHolidays()[dateStr];
    return h ? !h.isOffDay : false;
  }
  const h = store.getHolidays()[dateStr];
  return h ? !h.isOffDay : true;
}

export function nextTradingDay(dateStr) {
  const d = new Date(dateStr + 'T12:00:00+08:00');
  if (Number.isNaN(d.getTime())) return null;
  for (let i = 0; i < 60; i++) {
    // 按绝对时间戳 +1 天，并用上海时区格式化日期，规避服务器本地时区导致的 UTC 偏差
    const nd = new Date(d.getTime() + (i + 1) * 86400000);
    const s = shDateStrOf(nd);
    if (isTradingDay(s)) return s;
  }
  return null;
}
