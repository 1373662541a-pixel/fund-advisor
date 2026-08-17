import { store } from './storage.js';
import { generateAdvice } from './service.js';
import { settlePendingOps } from './ops.js';
import { isTradingDay } from './trading.js';
import { shNow, shDateStr, shTimeStr } from './time.js';
// 每 60 秒检查一次：交易日且到达设定时间（默认 14:30）且当日尚未生成 -> 自动生成
export function startScheduler(log = console.log) {
  const tick = async () => {
    try {
      // 先结算到期的加仓/减仓操作（结算后会自动重算建议，含AI解读）
      await settlePendingOps(log).catch(() => {});
      const settings = store.getSettings();
      if (!settings.schedule || !settings.schedule.enabled) return;
      const now = shNow();
      const date = shDateStr(now);
      if (!isTradingDay(date)) return;
      const [h, m] = String(settings.schedule.time || '14:30').split(':').map(Number);
      const target = h * 60 + m;
      const cur = now.getHours() * 60 + now.getMinutes();
      if (cur < target || cur > target + 150) return;
      if (store.getAdvice(date)) return;
      const res = await generateAdvice();
      if (!res.ok) {
        log(`[调度] ${date} ${shTimeStr(now)} 生成失败: ${res.error || '未知错误'}`);
      } else if (!res.cached) {
        log(`[调度] ${date} ${shTimeStr(now)} 已自动生成当日操作建议`);
      }
    } catch (e) {
      log(`[调度] 异常: ${e.message}`);
    }
  };
  setInterval(tick, 60_000);
  tick();
  const s = store.getSettings();
  log(`[调度] 已启动：每个交易日 ${s.schedule.time} 自动生成建议（当前: ${s.schedule.enabled ? '开启' : '关闭'}）`);
}
