// 抓取官方节假日安排并缓存到 data/holidays.json
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.resolve(__dirname, '..', 'data');
const OUT = path.join(DATA_DIR, 'holidays.json');

// 自动覆盖 去年/今年/明年，避免年份写死过期
const baseYear = new Date().getFullYear();
const YEARS = [baseYear - 1, baseYear, baseYear + 1];
const BASE = 'https://raw.githubusercontent.com/NateScarlet/holiday-cn/master';

async function main() {
  const out = {};
  let fetched = 0;
  for (const y of YEARS) {
    try {
      const res = await fetch(`${BASE}/${y}.json`, { headers: { 'User-Agent': 'fund-advisor' } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      for (const d of json.days || []) {
        out[d.date] = { name: d.name, isOffDay: !!d.isOffDay };
      }
      fetched++;
      console.log(`已获取 ${y} 年节假日（${(json.days || []).length} 天）`);
    } catch (e) {
      console.warn(`获取 ${y} 年节假日失败: ${e.message}`);
    }
  }
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(out, null, 2), 'utf8');
  console.log(`完成：共 ${Object.keys(out).length} 条记录 -> ${OUT}`);
  if (fetched === 0) process.exitCode = 1;
}

main();
