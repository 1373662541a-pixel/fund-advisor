// 可选 DeepSeek API 增强：用大模型深化每日建议
const TIMEOUT = 30000;

export async function enhanceWithAI(analysis, settings) {
  const ai = settings.ai || {};
  if (!ai.enabled || !ai.apiKey) {
    return { enabled: false, text: null, error: null };
  }
  const baseUrl = (ai.baseUrl || 'https://api.deepseek.com').replace(/\/+$/, '');
  const model = ai.model || 'deepseek-chat';

  const context = {
    date: analysis.date,
    riskTolerance: settings.riskTolerance || '稳健',
    market: {
      indexes: (analysis.market.list || []).map((q) => ({ name: q.name, pct: q.pct, price: q.price })),
      weightedPct: analysis.market.weightedPct,
    },
    portfolio: analysis.portfolio,
    funds: analysis.funds.map((f) => ({
      code: f.code,
      name: f.name,
      profitPct: f.profitPct,
      weightPct: f.weightPct,
      todayPct: f.todayPct,
      trends: f.trends,
      signal: f.signal,
      signalReason: f.signalReason,
      suggestedRatio: f.suggestedRatio,
    })),
    overall: { score: analysis.overall.score, level: analysis.overall.level, summary: analysis.overall.summary },
  };

  const system = `你是一名专业的基金投资顾问。请基于给定的行情与持仓数据，输出一段不超过 300 字的当日解读，要求：
1. 先点评今日大盘与组合整体状态；
2. 再给出具体的操作要点：哪些基金可加仓/减仓/止盈/持有，金额或比例建议要谨慎、可执行；
3. 最后一句风险提示。
要求语气客观专业，不得编造数据，不得承诺收益，所有结论必须来自输入数据。`;

  const user = `风险偏好：${context.riskTolerance}\n今日日期：${context.date}\n\n数据：\n${JSON.stringify(context, null, 1)}`;

  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), TIMEOUT);
    const res = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      signal: ctrl.signal,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${ai.apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
        temperature: 0.4,
        max_tokens: 600,
        stream: false,
      }),
    });
    clearTimeout(timer);
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`AI 接口错误 ${res.status}: ${body.slice(0, 200)}`);
    }
    const json = await res.json();
    const text = json.choices?.[0]?.message?.content?.trim();
    if (!text) throw new Error('AI 返回为空');
    return { enabled: true, text, model, error: null };
  } catch (e) {
    return { enabled: true, text: null, model, error: e.message };
  }
}
