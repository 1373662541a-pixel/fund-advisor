// 命令行手动触发：node scripts/run-now.js [--force]
import { generateAdvice } from '../server/service.js';
import { shDateStr } from '../server/time.js';

const force = process.argv.includes('--force');
const date = shDateStr();
console.log(`[run-now] ${date} 手动生成${force ? '（强制覆盖）' : ''}...`);
const res = await generateAdvice({ force });
if (!res.ok) {
  console.error('生成失败:', res.error);
  process.exit(1);
}
console.log(`[run-now] 成功${res.cached ? '（当日已存在，返回缓存）' : ''}`);
const r = res.record;
console.log(`  综合评分: ${r.overall.score}（${r.overall.level}）`);
console.log(`  组合: 市值 ${r.portfolio.totalValue}，累计盈亏 ${r.portfolio.totalProfitPct}%`);
for (const f of r.funds) {
  console.log(`  ${f.name}(${f.code}): 信号=${f.signal} 今日=${f.todayPct ?? '-'}% 浮盈=${f.profitPct ?? '-'}%`);
}
if (r.ai && r.ai.text) console.log(`\nAI 解读:\n${r.ai.text}`);
