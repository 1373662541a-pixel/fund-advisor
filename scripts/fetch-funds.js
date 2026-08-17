// 下载并缓存基金代码/名称数据库到 data/funds.json（天天基金 fundcode_search.js）
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.resolve(__dirname, '..', 'data', 'funds.json');

const res = await fetch('https://fund.eastmoney.com/js/fundcode_search.js', {
  headers: { Referer: 'https://fund.eastmoney.com/', 'User-Agent': 'Mozilla/5.0' },
});
if (!res.ok) throw new Error('HTTP ' + res.status);
const text = await res.text();
const m = text.match(/var r = (\[[\s\S]*?\]);/);
if (!m) throw new Error('基金库格式异常');
const arr = JSON.parse(m[1]);

// 场内基金（ETF/LOF）列表，补全名称库覆盖（分页 + 重试）
async function fetchJsonWithRetry(url, tries = 5) {
  let lastErr = null;
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(url, { headers: { Referer: 'https://quote.eastmoney.com/', 'User-Agent': 'Mozilla/5.0' } });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      return await res.json();
    } catch (e) {
      lastErr = e;
      await new Promise((r) => setTimeout(r, 1500 * (i + 1)));
    }
  }
  throw lastErr;
}

let merged = arr;
try {
  const etfs = [];
  const PAGE = 100;
  const first = await fetchJsonWithRetry(
    `https://push2.eastmoney.com/api/qt/clist/get?pn=1&pz=${PAGE}&po=1&np=1&fltt=2&invt=2&fid=f12&fs=b:MK0021&fields=f12,f14`
  );
  const total = ((first.data || {}).total) || 0;
  const pages = Math.max(1, Math.ceil(total / PAGE));
  for (const d of (first.data && first.data.diff) || []) etfs.push(d);
  for (let pn = 2; pn <= pages; pn++) {
    try {
      const j = await fetchJsonWithRetry(
        `https://push2.eastmoney.com/api/qt/clist/get?pn=${pn}&pz=${PAGE}&po=1&np=1&fltt=2&invt=2&fid=f12&fs=b:MK0021&fields=f12,f14`
      );
      for (const d of (j.data && j.data.diff) || []) etfs.push(d);
      console.log(`  场内基金第 ${pn}/${pages} 页：已累计 ${etfs.length} 只`);
    } catch (e) {
      console.warn(`  场内基金第 ${pn} 页获取失败，跳过（当前 ${etfs.length} 只）`);
    }
  }
  const byCode = new Map(arr.map((f) => [f[0], f]));
  let added = 0;
  for (const e of etfs) {
    if (!byCode.has(e.f12)) { byCode.set(e.f12, [e.f12, '', e.f14, 'ETF', '']); added++; }
  }
  merged = [...byCode.values()];
  console.log(`场内基金：共 ${etfs.length} 只，新增 ${added} 只`);
} catch (e) {
  console.warn('场内基金列表获取失败（不影响场外库）:', e.message);
}

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, JSON.stringify(merged));
console.log(`基金名称库已缓存：${merged.length} 只 -> ${OUT}`);
