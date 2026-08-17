// 基金名称识别模块：本地基金代码/名称库 + 规范化 + 模糊匹配
import fs from 'node:fs';
import path from 'node:path';
import { DATA_DIR } from './config.js';

let fundIndex = null; // [{code, abbr, name, type, pinyin, norm}]
let codeMap = null;   // Map code -> entry

// 规范化：去括号内容、去空白、去分隔符、大写
export function normalizeName(s) {
  return String(s || '')
    .replace(/[（(][^（）()]*[）)]/g, '') // 去掉 (LOF)、(后端) 等括号内容
    .replace(/[\s\u3000]/g, '')
    .replace(/[·．\-_/]/g, '')
    .toUpperCase();
}

function load() {
  if (fundIndex) return fundIndex;
  const file = path.join(DATA_DIR, 'funds.json');
  try {
    const arr = JSON.parse(fs.readFileSync(file, 'utf8'));
    fundIndex = arr.map((f) => ({
      code: f[0], abbr: f[1], name: f[2], type: f[3], pinyin: f[4],
      norm: normalizeName(f[2]),
    }));
    codeMap = new Map(fundIndex.map((f) => [f.code, f]));
  } catch (e) {
    fundIndex = [];
    codeMap = new Map();
    console.warn('[fundnames] 基金库加载失败:', e.message, '（可运行 node scripts/fetch-funds.js）');
  }
  return fundIndex;
}

export function getFundByCode(code) {
  load();
  return codeMap.get(code) || null;
}

// 字符多重集重叠率（顺序无关，用于"华泰柏瑞沪深300ETF" ↔ "沪深300ETF华泰柏瑞"这类命名倒序）
function charOverlap(a, b) {
  const count = (s) => {
    const m = {};
    for (const ch of s) m[ch] = (m[ch] || 0) + 1;
    return m;
  };
  const ma = count(a);
  const mb = count(b);
  let shared = 0;
  for (const k of Object.keys(ma)) shared += Math.min(ma[k], mb[k] || 0);
  return shared / Math.max(a.length, b.length, 1);
}

const MIN_SCORE = 0.8;

/**
 * 按名称模糊匹配基金，返回最佳结果或 null。
 * score: 1 = 规范化后完全一致；0.9 = 顺序一致的包含匹配；0.82 = 字符重叠匹配（顺序无关）。
 * OCR 名称带 ETF/LOF 时，"联接"基金降权，优先匹配 ETF/LOF 本体。
 */
export function searchFundByName(raw) {
  const norm = normalizeName(raw);
  if (norm.length < 2) return null;
  const idx = load();

  // 1) 完全一致（去括号等规范化后）
  let exact = null;
  for (const f of idx) {
    if (f.norm === norm) {
      if (!exact || f.code < exact.code) exact = f;
    }
  }
  if (exact) return { code: exact.code, name: exact.name, type: exact.type, score: 1, match: 'exact' };

  // 2) 包含 / 字符重叠匹配
  const wantsDirect = /ETF|LOF/.test(norm);
  let best = null; // {entry, score, len}
  for (const f of idx) {
    if (f.norm.length < 4) continue;
    let score = null;
    if (f.norm.includes(norm)) {
      score = 0.9; // OCR 名称是库名的简称（如 华夏成长 → 华夏成长混合）
    } else if (norm.includes(f.norm) && norm.length >= f.norm.length + 2) {
      score = 0.9; // 库名是 OCR 名称的一部分（OCR 带了多余词）
    } else if (charOverlap(norm, f.norm) >= 0.8) {
      score = 0.82; // 字符集一致但顺序不同（ETF 场内/场外命名倒序）
    }
    if (score === null) continue;

    if (wantsDirect && /联接/.test(f.norm)) score -= 0.2;   // 想要 ETF/LOF 本体，联接降权
    if (!wantsDirect && /联接/.test(f.norm)) score += 0.05; // 场外用户更常见联接
    if (score < MIN_SCORE) continue;

    if (!best || score > best.score || (score === best.score && f.norm.length < best.len)) {
      best = { entry: f, score, len: f.norm.length };
    }
  }
  if (best) {
    return {
      code: best.entry.code, name: best.entry.name, type: best.entry.type,
      score: Math.round(best.score * 100) / 100, match: 'token',
    };
  }
  return null;
}

// 常见持仓页标签词（用于从 OCR 行里剔除，避免误把标签当基金名）
export const LABEL_WORDS = [
  '持有份额', '持仓份额', '持有金额', '持仓金额', '持有收益', '持仓收益', '累计收益',
  '日涨跌幅', '日收益', '今日收益', '昨日收益', '昨日盈亏', '今日盈亏', '参考成本',
  '单位净值', '累计净值', '最新净值', '估算净值', '净值估算', '参考市值', '持有市值',
  '今年以来', '近一年', '近六月', '近三月', '近一月', '近一周', '近1年', '近6月', '近3月', '近1月', '近1周',
  '万份收益', '七日年化', '手续费', '分红', '确认金额', '可用金额', '可用份额',
  '卖出', '买入', '定投', '赎回', '转换', '详情', '确认中', '我的', '持仓', '总资产',
  '账户', '首页', '总览', '理财', '钱包', '资产', '可用', '在途', '冻结', '金额', '份额', '收益', '净值', '成本', '涨跌幅',
];

// 从一行 OCR 文本中提取"基金名称候选"：去掉代码、数字符号、标签词
export function extractNameCandidate(line, code) {
  let s = line;
  if (code) s = s.replace(code, '');
  // 去掉独立的金额/数字 token（保留与汉字/字母粘连的数字，如 沪深300、300ETF）
  s = s.replace(/(?:^|\s)[+-]?[\d,]+(?:\.\d+)?%?(?=\s|$)/g, ' ');
  for (const w of LABEL_WORDS) {
    s = s.split(w).join(' ');
  }
  s = s.replace(/[+\-−%％:：/／]/g, ' ');
  return s.replace(/\s+/g, ' ').trim();
}
