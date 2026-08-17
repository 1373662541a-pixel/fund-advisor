import { TZ } from './config.js';

// 所有时间均以 Asia/Shanghai 为准
const shPartsFmt = new Intl.DateTimeFormat('en-US', {
  timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
});
const shDateFmt = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' });

// 返回一个"本地时间字段 = 上海时间字段"的 Date（不依赖 toLocaleString 字符串再解析，更稳健）
export function shNow() {
  const parts = shPartsFmt.formatToParts(new Date());
  const get = (t) => parts.find((p) => p.type === t)?.value || '0';
  const hh = get('hour') === '24' ? '00' : get('hour'); // en-US 12小时制午夜可能显示 24
  return new Date(`${get('year')}-${get('month')}-${get('day')}T${hh}:${get('minute')}:${get('second')}`);
}

// 按上海时区格式化任意 Date 为 YYYY-MM-DD（供 trading 等模块使用，规避 UTC 偏差）
export function shDateStrOf(d) {
  return shDateFmt.format(d);
}

export function shDateStr(d = shNow()) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function shTimeStr(d = shNow()) {
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

export function isWeekend(d = shNow()) {
  const w = d.getDay();
  return w === 0 || w === 6;
}

export function isWithinTradingHours(d = shNow()) {
  const h = d.getHours() * 60 + d.getMinutes();
  return h >= 9 * 60 + 15 && h <= 15 * 60; // 9:15 ~ 15:00
}
