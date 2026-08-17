// 持仓截图 AI 视觉识别模块（OpenAI 兼容接口：通义千问 qwen-vl、GPT-4o、GLM-4V 等）
// 相比本地 tesseract OCR：识别准确率高、速度快，直接输出结构化持仓数据
import { getFundByCode, searchFundByName, normalizeName } from './fundnames.js';

const TIMEOUT = 45000;

const PROMPT = `你是基金持仓截图信息提取专家。请识别这张"基金持仓页面"截图，逐行提取每只基金的信息，输出 JSON 数组，字段：
1. code：6 位基金代码（只有截图中**明确出现**才填写；**绝对不要猜测或编造**，看不到就填空字符串 ""）
2. name：基金名称（务必准确完整，如"招商中证白酒指数A"）
3. amount：持有金额/持有市值（对应"持有金额/市值/金额"列的数值，纯数字去千分位逗号，如 19581.75；没有该列填 null）
4. shares：持有份额（对应"持有份额/份额"列的数值，纯数字，如 5000.00；没有该列填 null）
5. costNav：成本净值（对应"成本净值/成本"列的数值，纯数字，如 0.9000；没有该列填 null）
6. profit：持有收益（对应"持有收益/累计收益/收益"列的数值，保留正负号，如 2173.05；注意"昨日收益"不是持有收益）
7. profitRate：持有收益率（百分数数值，不带 % 号，如 12.48；亏损为负数如 -5.16）

严格要求：
- 只输出一个 JSON 数组，不要任何解释文字、不要 markdown 代码块，例如：
[{"code":"","name":"东方惠新灵活配置混合C","amount":19581.75,"shares":null,"costNav":null,"profit":2173.05,"profitRate":12.48}]
- 每个数值必须对应截图表格中该基金所在行的对应列，逐行逐列精确识别
- "持有金额"≠"持有份额"：金额是"元"、份额是"份"，千万不要把金额当份额
- "昨日收益"≠"持有收益"：只提取"持有收益/累计收益"列的数值作为 profit
- 某字段在截图中看不清/不存在时填 null，不要编造
- 只识别基金持仓条目，忽略页面上的标题、底部导航、广告等其他元素
- 若截图不是持仓页面，输出 []`;

function detectMime(buf) {
  if (buf.length > 3 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return 'image/png';
  if (buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (buf.length > 3 && buf[0] === 0x47 && buf[1] === 0x49 && buf[2] === 0x46) return 'image/gif';
  if (buf.length > 3 && buf[0] === 0x42 && buf[1] === 0x4d) return 'image/bmp';
  return 'image/png';
}

function extractJSON(text) {
  if (!text) return null;
  let s = text.trim();
  // 去掉 ```json ... ``` 包裹
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) s = fence[1].trim();
  const start = s.indexOf('[');
  const end = s.lastIndexOf(']');
  if (start >= 0 && end > start) {
    const frag = s.slice(start, end + 1);
    try { return JSON.parse(frag); } catch { /* 继续尝试 */ }
  }
  try { return JSON.parse(s); } catch { return null; }
}

// AI 结果规范化：代码与名称互相印证，防 AI 编造代码；份额/成本转数字，与本地 OCR 的 rows 结构对齐
export function normalizeAIRows(rows) {
  if (!Array.isArray(rows)) return [];
  const out = [];
  for (const r of rows) {
    if (!r || typeof r !== 'object') continue;
    const code = String(r.code || '').replace(/\D/g, '');
    const name = String(r.name || '').trim();
    const codeOk = /^\d{6}$/.test(code);
    const shares = Number(String(r.shares ?? '').replace(/,/g, ''));
    const costNav = Number(String(r.costNav ?? '').replace(/,/g, ''));
    const amount = Number(String(r.amount ?? '').replace(/,/g, ''));
    const profit = Number(String(r.profit ?? '').replace(/,/g, ''));
    const profitRate = Number(String(r.profitRate ?? '').replace(/,/g, ''));
    let finalCode = '';
    let finalName = '';
    let method = 'name';
    let confidence = 0.9;

    const db = codeOk ? getFundByCode(code) : null;
    if (db) {
      // 代码在库中：校验名称是否一致，防止 AI 编造的代码碰巧命中真实基金
      const n1 = normalizeName(name);
      const n2 = normalizeName(db.name);
      const nameMatch = n1 && (n1 === n2 || n1.includes(n2) || n2.includes(n1));
      if (nameMatch) {
        finalCode = db.code;
        finalName = db.name;
        method = 'both';
        confidence = 1;
      } else {
        // 名称对不上：代码疑似编造，优先信任名称重新匹配
        const byName = name ? searchFundByName(name) : null;
        if (byName) {
          finalCode = byName.code;
          finalName = byName.name;
          method = 'name';
          confidence = byName.score;
        } else {
          finalCode = db.code;
          finalName = db.name;
          method = 'code';
          confidence = 0.9;
        }
      }
    } else if (codeOk) {
      // 代码不在本地库（可能编造或极新基金），有名称则按名称匹配，无名称则跳过
      const byName = name ? searchFundByName(name) : null;
      if (byName) {
        finalCode = byName.code;
        finalName = byName.name;
        method = 'name';
        confidence = byName.score;
      } else if (name) {
        finalCode = code;
        finalName = name;
        method = 'code';
        confidence = 0.9;
      } else {
        continue;
      }
    } else {
      // 无代码，仅按名称匹配
      if (!name) continue;
      const byName = searchFundByName(name);
      if (byName) {
        finalCode = byName.code;
        finalName = byName.name;
        method = 'name';
        confidence = byName.score;
      } else {
        finalCode = '';
        finalName = name;
        method = 'name';
        confidence = 0.9;
      }
    }

    if (!finalCode && !finalName) continue;
    out.push({
      code: finalCode,
      name: finalName,
      method,
      confidence: Math.round(confidence * 100) / 100,
      shares: Number.isFinite(shares) && shares > 0 ? Math.round(shares * 10000) / 10000 : null,
      costNav: Number.isFinite(costNav) && costNav > 0 ? Math.round(costNav * 100000) / 100000 : null,
      amount: Number.isFinite(amount) && amount > 0 ? Math.round(amount * 100) / 100 : null,
      profit: Number.isFinite(profit) ? Math.round(profit * 100) / 100 : null,
      profitRate: Number.isFinite(profitRate) ? Math.round(profitRate * 100) / 100 : null,
    });
  }
  return out;
}

/**
 * 调用视觉大模型识别持仓截图。
 * @param {Buffer} buffer 图片原始字节
 * @param {object} vision 设置项 {enabled, baseUrl, apiKey, model}
 * @returns {Promise<{ok:boolean, rows?:Array, error?:string, model?:string}>}
 */
export async function recognizeWithAI(buffer, vision) {
  if (!vision || !vision.enabled || !vision.apiKey) {
    return { ok: false, error: 'AI 识别未启用或未配置 API Key' };
  }
  const baseUrl = (vision.baseUrl || 'https://dashscope.aliyuncs.com/compatible-mode/v1').replace(/\/+$/, '');
  const model = vision.model || 'qwen-vl-max';
  const mime = detectMime(buffer);
  const base64 = buffer.toString('base64');

  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), TIMEOUT);
    const res = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      signal: ctrl.signal,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${vision.apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: PROMPT },
              { type: 'image_url', image_url: { url: `data:${mime};base64,${base64}` } },
            ],
          },
        ],
        temperature: 0.1,
        max_tokens: 1200,
        stream: false,
      }),
    });
    clearTimeout(timer);
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`AI 接口错误 ${res.status}: ${body.slice(0, 200)}`);
    }
    const json = await res.json();
    const content = json.choices?.[0]?.message?.content;
    const rows = extractJSON(typeof content === 'string' ? content : JSON.stringify(content || ''));
    if (!rows) throw new Error('AI 返回内容无法解析为 JSON');
    return { ok: true, rows: normalizeAIRows(rows), model, raw: typeof content === 'string' ? content.slice(0, 2000) : '' };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}