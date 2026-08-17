import { store } from './storage.js';
import { generateAdvice } from './service.js';
import { settlePendingOps } from './ops.js';
import { clearFundCache } from './market.js';
import { isTradingDay } from './trading.js';
import { shNow, shDateStr, shTimeStr } from './time.js';

// 晚间净值刷新窗口：交易日 20:30–23:00（基金净值通常 20 点后陆续公布完毕）
const NIGHT_START_MIN = 20 * 60 + 30;
const NIGHT_END_MIN = 23 * 60;

// 每 60 秒检查一次：
//  ① 收盘前：交易日到达设定时间（默认 14:30）且当日尚未生成 -> 自动生成当日建议
//  ② 晚间：交易日 20:30 后用当晚公布净值清缓存并强制重算组合与 AI 解读（每交易日仅一次）
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

      // ① 收盘前定时生成（设定时间 ~ 设定时间+150分钟，当日无建议时）
      if (cur >= target && cur <= target + 150 && !store.getAdvice(date)) {
        const res = await generateAdvice();
        if (!res.ok) {
          log(`[调度] ${date} ${shTimeStr(now)} 生成失败: ${res.error || '未知错误'}`);
        } else if (!res.cached) {
          log(`[调度] ${date} ${shTimeStr(now)} 已自动生成当日操作建议`);
        }
      }

      // ② 晚间净值刷新：用当晚公布净值重算组合与 AI 解读（每交易日一次）
      if (cur >= NIGHT_START_MIN && cur <= NIGHT_END_MIN) {
        if (settings.nightRefreshed !== date) {
          log(`[调度] ${date} ${shTimeStr(now)} 晚间净值刷新开始（清缓存→按当晚净值重算组合/AI解读）`);
          const holdings = store.getHoldings();
          for (const hld of holdings) clearFundCache(hld.code);
          const res = await generateAdvice({ force: true });
          if (res.ok && !res.busy) {
            settings.nightRefreshed = date;
            store.saveSettings(settings);
            log(`[调度] ${date} 晚间净值刷新完成（${holdings.length} 只基金按当晚净值重算，AI解读已同步更新）`);
          } else {
            log(`[调度] ${date} 晚间刷新未完成: ${res.error || '未知'}（下次 tick 重试）`);
          }
        }
      }
    } catch (e) {
      log(`[调度] 异常: ${e.message}`);
    }
  };
  setInterval(tick, 60_000);
  tick();
  const s = store.getSettings();
  log(`[调度] 已启动：每个交易日 ${s.schedule.time} 生成建议 + 20:30 晚间净值刷新（当前: ${s.schedule.enabled ? '开启' : '关闭'}）`);
}
