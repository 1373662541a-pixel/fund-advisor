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

// 全局默认 AI 配置（所有账号自动继承；可用环境变量覆盖）
// 文本 AI：DeepSeek；视觉 AI：通义千问 qwen-vl-max
const AI_KEY = process.env.FUND_AI_KEY || 'sk-a7123bff05134e35b200b4883a6e5c41';
const VISION_KEY = process.env.FUND_VISION_KEY || 'sk-ws-H.EPILXHR.OT23.MEUCIQCXA1aX1mfpJhJSI36gx_ELfTzF2dhxqfBTD6Fx202mpwIgBCrKPOk0buSYuX9_vvtrIXDgq_rr-Rqsgu_I-R3nHBw';

export const DEFAULT_SETTINGS = {
  riskTolerance: '稳健',
  schedule: { enabled: true, time: '14:30' },
  ai: { enabled: true, apiKey: AI_KEY, model: 'deepseek-chat', baseUrl: 'https://api.deepseek.com' },
  // 持仓截图 AI 视觉识别（OpenAI 兼容接口，默认通义千问 qwen-vl）
  vision: { enabled: true, apiKey: VISION_KEY, model: 'qwen-vl-max', baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1' },
  engine: { version: '1.1.0' },
};

export const TZ = 'Asia/Shanghai';