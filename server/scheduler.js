import { auth, userStoreOf } from './storage.js';
import { generateAdvice } from './service.js';
import { settlePendingOps } from './ops.js';
import { clearFundCache } from './market.js';
import { isTradingDay } from './trading.js';
import { shNow, shDateStr, shTimeStr } from './time.js';

// 晚间净值刷新窗口：交易日 20:30–23:00（基金净值通常 20 点后陆续公布完毕）
const NIGHT_START_MIN = 20 * 60 + 30;
const NIGHT_END_MIN = 23 * 60;

// 每 60 秒检查一次，遍历所有用户：
//  ① 收盘前：该用户到达设定时间（默认 14:30）且当日尚未生成 -> 自动生成当日建议
//  ② 晚间：交易日 20:30 后用当晚公布净值清缓存并强制重算组合与 AI 解读（每用户每交易日一次）
export function startScheduler(log = console.log) {
  const tick = async () => {
    try {
      const now = shNow();
      const date = shDateStr(now);
      if (!isTradingDay(date)) return;
      const cur = now.getHours() * 60 + now.getMinutes();
      const users = auth.getUsers();
      for (const u of Object.values(users)) {
        try {
          const userStore = userStoreOf(u.userId);
          // 先结算该用户到期的加仓/减仓操作（结算后会自动重算建议，含AI解读）
          await settlePendingOps(log, userStore).catch(() => {});
          const settings = userStore.getSettings();
          if (!settings.schedule || !settings.schedule.enabled) continue;

          // ① 收盘前定时生成（设定时间 ~ 设定时间+150分钟，当日无建议时）
          const [h, m] = String(settings.schedule.time || '14:30').split(':').map(Number);
          const target = h * 60 + m;
          if (cur >= target && cur <= target + 150 && !userStore.getAdvice(date)) {
            const res = await generateAdvice({}, userStore);
            if (!res.ok) {
              log(`[调度] ${u.username} ${date} ${shTimeStr(now)} 生成失败: ${res.error || '未知错误'}`);
            } else if (!res.cached) {
              log(`[调度] ${u.username} ${date} ${shTimeStr(now)} 已自动生成当日操作建议`);
            }
          }

          // ② 晚间净值刷新：用当晚公布净值重算组合与 AI 解读（每交易日一次）
          if (cur >= NIGHT_START_MIN && cur <= NIGHT_END_MIN) {
            if (settings.nightRefreshed !== date) {
              log(`[调度] ${u.username} ${date} ${shTimeStr(now)} 晚间净值刷新开始（清缓存→按当晚净值重算组合/AI解读）`);
              const holdings = userStore.getHoldings();
              for (const hld of holdings) clearFundCache(hld.code);
              const res = await generateAdvice({ force: true }, userStore);
              if (res.ok && !res.busy) {
                settings.nightRefreshed = date;
                userStore.saveSettings(settings);
                log(`[调度] ${u.username} ${date} 晚间净值刷新完成（${holdings.length} 只基金按当晚净值重算，AI解读已同步更新）`);
              } else {
                log(`[调度] ${u.username} ${date} 晚间刷新未完成: ${res.error || '未知'}（下次 tick 重试）`);
              }
            }
          }
        } catch (e) {
          log(`[调度] ${u.username} 异常: ${e.message}`);
        }
      }
    } catch (e) {
      log(`[调度] 异常: ${e.message}`);
    }
  };
  setInterval(tick, 60_000);
  tick();
  const userCount = Object.keys(auth.getUsers()).length;
  log(`[调度] 已启动：${userCount} 个用户，每交易日按各自设定时间生成建议 + 20:30 晚间净值刷新`);
}