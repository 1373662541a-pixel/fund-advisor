import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(__dirname, '..');
export const DATA_DIR = path.join(ROOT, 'data');
export const PUBLIC_DIR = path.join(ROOT, 'public');

export const PORT = Number(process.env.FUND_ADVISOR_PORT || 3081);

export const INDEXES = [
  { secid: '1.000001', code: 'sh000001', name: '上证指数', weight: 0.30 },
  { secid: '0.399001', code: 'sz399001', name: '深证成指', weight: 0.25 },
  { secid: '0.399006', code: 'sz399006', name: '创业板指', weight: 0.25 },
  { secid: '1.000300', code: 'sh000300', name: '沪深300', weight: 0.20 },
];

export const EXTRA_INDEXES = [
  { secid: '1.000905', code: 'sh000905', name: '中证500', weight: 0 },
];

export const DEFAULT_SETTINGS = {
  riskTolerance: '稳健',
  schedule: { enabled: true, time: '14:30' },
  ai: { enabled: false, apiKey: '', model: 'deepseek-chat', baseUrl: 'https://api.deepseek.com' },
  // 持仓截图 AI 视觉识别（OpenAI 兼容接口，默认通义千问 qwen-vl）
  vision: { enabled: false, apiKey: '', model: 'qwen-vl-max', baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1' },
  engine: { version: '1.1.0' },
};

export const TZ = 'Asia/Shanghai';
