// 截图 OCR 识别持仓：tesseract.js（chi_sim+eng，字库本地缓存）
// 识别方式：① 6位基金代码（本地基金库/行情接口确认）② 基金名称模糊匹配（本地基金名称库）
import path from 'node:path';
import { createWorker } from 'tesseract.js';
import { DATA_DIR } from './config.js';
import { getFundQuote } from './market.js';
import { getFundByCode, searchFundByName, extractNameCandidate, normalizeName } from './fundnames.js';

const LANG_DIR = DATA_DIR;
const CODE_RE = /(?<!\d)(\d{6})(?!\d)/g;

let workerPromise = null;

function getWorker() {
  if (!workerPromise) {
    workerPromise = (async () => {
      const w = await createWorker('chi_sim+eng', 1, { langPath: LANG_DIR, gzip: false });
      return w;
    })();
  }
  return workerPromise;
}

export async function recognizeImage(buffer) {
  const w = await getWorker();
  const { data } = await w.recognize(Buffer.from(buffer));
  return data.text || '';
}

const round4 = (x) => Math.round(x * 10000) / 10000;

// 把 OCR 里 "2.800.00" 这类点号千分位还原为 "2800.00"
function normalizeNum(s) {
  if (/^\d{1,3}(\.\d{3})+$/.test(s)) return s.replace(/\./g, '');
  return s;
}

function findNumberAfter(text, labels) {
  for (const label of labels) {
    const idx = text.indexOf(label);
    if (idx < 0) continue;
    const rest = text.slice(idx + label.length, idx + label.length + 40);
    const m = rest.match(/([+-]?[\d,]+(?:\.\d+)?)/);
    if (m) {
      const n = parseFloat(normalizeNum(m[1]).replace(/,/g, ''));
      if (Number.isFinite(n) && n !== 0) return round4(n);
    }
  }
  return null;
}

function findSignedAfter(text, labels) {
  for (const label of labels) {
    const idx = text.indexOf(label);
    if (idx < 0) continue;
    const rest = text.slice(idx + label.length, idx + label.length + 40);
    const m = rest.match(/([+-]?[\d,]+(?:\.\d+)?)/);
    if (m) {
      const n = parseFloat(normalizeNum(m[1]).replace(/,/g, ''));
      if (Number.isFinite(n)) return round4(n);
    }
  }
  return null;
}

// 通过代码解析基金：本地库优先，行情接口兜底（如 ETF）
async function resolveByCode(code, ocrName) {
  const db = getFundByCode(code);
  if (db) {
    const normOCR = normalizeName(ocrName);
    const normDB = db.norm;
    const matched = normOCR.length >= 2 && (normOCR === normDB || normOCR.includes(normDB) || normDB.includes(normOCR));
    return { code, name: db.name, method: matched ? 'both' : 'code', confidence: 1 };
  }
  try {
    const q = await getFundQuote(code);
    if (!q.name || q.name === code) return null; // 不是基金代码（如金额）
    return { code, name: q.name, method: 'code', confidence: 1 };
  } catch {
    return null;
  }
}

/**
 * 从 OCR 文本识别基金列表，返回 [{code, name, method, confidence, shares, costNav, lineIdx}]
 * method: 'code' 按代码 / 'name' 按名称 / 'both' 代码+名称互相印证
 */
export async function parseFunds(text) {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const seen = new Set();
  const rows = [];

  // 第一遍：逐行找代码 / 名称
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const codeM = line.match(CODE_RE);
    const code = codeM ? codeM[0] : null;
    const nameCandidate = extractNameCandidate(line, code);

    if (code) {
      const resolved = await resolveByCode(code, nameCandidate);
      if (resolved && !seen.has(code)) {
        seen.add(code);
        rows.push({ ...resolved, lineIdx: i, shares: null, costNav: null });
      }
      continue;
    }

    if (nameCandidate.length < 2) continue;
    const hit = searchFundByName(nameCandidate);
    if (!hit || hit.score < 0.8) continue;
    if (seen.has(hit.code)) continue;
    seen.add(hit.code);
    rows.push({
      code: hit.code,
      name: hit.name,
      method: 'name',
      confidence: hit.score,
      lineIdx: i,
      shares: null,
      costNav: null,
    });
  }

  // 第二遍：按行块提取份额/成本（尽力而为）
  rows.sort((a, b) => a.lineIdx - b.lineIdx);
  for (let k = 0; k < rows.length; k++) {
    const r = rows[k];
    const end = k + 1 < rows.length ? rows[k + 1].lineIdx : r.lineIdx + 4;
    const block = lines.slice(r.lineIdx, Math.min(end, r.lineIdx + 5)).join(' ');
    const shares = findNumberAfter(block, ['持有份额', '持仓份额', '份额']);
    const amount = findNumberAfter(block, ['持有金额', '持仓金额', '金额']);
    const profit = findSignedAfter(block, ['持有收益', '持仓收益', '收益', '累计收益']);
    if (shares && shares > 0) r.shares = shares;
    if (amount && amount > 0 && profit !== null) {
      const cost = amount - profit;
      if (cost > 0 && r.shares) r.costNav = round4(cost / r.shares);
    }
  }

  return rows;
}
