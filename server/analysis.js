import { getFundQuote, getFundHistory, getIndexQuotes } from './market.js';

const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));
const round1 = (x) => (typeof x === 'number' ? Math.round(x * 10) / 10 : null);
const round2 = (x) => (typeof x === 'number' ? Math.round(x * 100) / 100 : null);

function profitScore(p) {
  if (p >= 30) return 40;
  if (p >= 15) return 62;
  if (p >= 5) return 72;
  if (p >= 0) return 66;
  if (p >= -10) return 55;
  if (p >= -20) return 42;
  return 28;
}

function trendScore(t1m, t3m) {
  const a = typeof t1m === 'number' ? t1m : 0;
  const b = typeof t3m === 'number' ? t3m : 0;
  return clamp(50 + b * 1.0 + a * 1.5, 0, 100);
}

function divScore(funds) {
  const n = funds.length;
  if (n === 0) return 50;
  const maxW = Math.max(...funds.map((f) => f.weightPct));
  let s = 55;
  if (n >= 5) s += 10;
  else if (n >= 3) s += 5;
  else if (n === 1) s -= 8;
  if (maxW > 60) s -= 25;
  else if (maxW > 40) s -= 15;
  return clamp(s, 0, 100);
}

function levelOf(score) {
  if (score >= 75) return { level: '偏积极', color: '#e03131' };
  if (score >= 60) return { level: '中性偏多', color: '#f08c00' };
  if (score >= 45) return { level: '中性', color: '#666666' };
  return { level: '偏谨慎', color: '#1971c2' };
}

function signalFor(fund, ctx) {
  const { weightedPct } = ctx;
  const { todayPct, profitPct, t1m, t3m, score } = fund;
  const bigDrop = typeof weightedPct === 'number' && weightedPct <= -2.5;
  if (bigDrop || (typeof todayPct === 'number' && todayPct <= -3)) {
    return { signal: '观望', reason: bigDrop ? '大盘显著下跌，今日暂缓操作' : '当日估值跌幅较大，观望为主', ratio: '不加仓不减仓' };
  }
  if (profitPct >= 25 && t1m >= 8) {
    return { signal: '止盈(部分)', reason: `浮盈 ${round1(profitPct)}% 且近1月上涨 ${round1(t1m)}%，落袋为安`, ratio: '建议止盈 1/3 ~ 1/2' };
  }
  if (score >= 70 && t1m > 0 && profitPct < 15) {
    return { signal: '可加仓', reason: `组合环境分 ${Math.round(score)}，短期趋势向上且浮盈不高`, ratio: '单日加仓不超过总仓位 5%' };
  }
  if (score < 45 && t3m < 0 && profitPct < -15) {
    return { signal: '减仓/止损评估', reason: `环境偏弱且浮亏 ${round1(profitPct)}%，评估止损或调仓`, ratio: '分批减仓，控制风险' };
  }
  if (t3m < -8 && profitPct < -10) {
    return { signal: '减仓', reason: `近3月下跌 ${round1(t3m)}% 且浮亏，趋势走弱`, ratio: '分批减仓 1/3' };
  }
  return { signal: '持有', reason: '趋势与盈亏处于均衡区间', ratio: '维持现有仓位' };
}

async function safe(p) {
  try {
    return await p;
  } catch {
    return null;
  }
}

/**
 * 构建完整分析。holdings 需包含 code/name/shares/costNav。
 */
export async function buildAnalysis(holdings, settings) {
  let market = null;
  try {
    market = await getIndexQuotes();
  } catch (e) {
    market = { list: [], weightedPct: null, totalAmount: null, error: e.message };
  }
  const weightedPct = market.weightedPct;

  const funds = [];
  for (const h of holdings) {
    const quote = await safe(getFundQuote(h.code));
    const history = await safe(getFundHistory(h.code));
    const nav = (quote && quote.nav) || (history && history.latestNav) || h.costNav || 0;
    const navDate = (quote && quote.navDate) || (history && history.navDate) || null;
    const estNav = (quote && quote.estNav) || null;
    const hasEst = !!(quote && quote.estimateAvailable && typeof quote.estChgPct === 'number');
    const todayPct = hasEst ? quote.estChgPct : ((quote && quote.chgPct) || null);
    const todaySource = hasEst ? 'estimate' : (typeof quote?.chgPct === 'number' ? 'nav' : null);

    const marketValue = h.shares * nav;
    const cost = h.shares * h.costNav;
    const profit = marketValue - cost;
    const profitPct = cost > 0 ? (profit / cost) * 100 : null;

    const t1w = (history && history.trends && history.trends['1w']) ?? null;
    const t1m = (history && history.trends && history.trends['1m']) ?? null;
    const t3m = (history && history.trends && history.trends['3m']) ?? null;
    const t6m = (history && history.trends && history.trends['6m']) ?? null;

    funds.push({
      code: h.code,
      name: (quote && quote.name) || h.name || h.code,
      shares: h.shares,
      costNav: h.costNav,
      nav: round2(nav),
      navDate,
      estNav: round2(estNav) || null,
      estimateAvailable: !!(quote && quote.estimateAvailable),
      estimateSource: (quote && quote.estimateSource) || null,
      todayPct: round1(todayPct),
      todaySource,
      chgPct: (quote && quote.chgPct) || null,
      marketValue: round2(marketValue),
      cost: round2(cost),
      profit: round2(profit),
      profitPct: round1(profitPct),
      trends: { '1w': round1(t1w), '1m': round1(t1m), '3m': round1(t3m), '6m': round1(t6m) },
      history: (history && history.history) || [],
      errors: (quote && quote.errors) || [],
    });
  }

  const totalValue = funds.reduce((s, f) => s + f.marketValue, 0);
  const totalCost = funds.reduce((s, f) => s + f.cost, 0);
  for (const f of funds) {
    f.weightPct = totalValue > 0 ? round1((f.marketValue / totalValue) * 100) : 0;
  }
  const totalProfit = totalValue - totalCost;
  const totalProfitPct = totalCost > 0 ? (totalProfit / totalCost) * 100 : null;

  // 今日组合盈亏（有盘中估算时用估算差额）
  let todayProfit = 0;
  let hasEst = false;
  for (const f of funds) {
    if (f.estNav && f.estNav > 0 && f.nav > 0) {
      todayProfit += f.shares * (f.estNav - f.nav);
      hasEst = true;
    }
  }
  const todayPctWeighted = (() => {
    const vals = funds.filter((f) => typeof f.todayPct === 'number' && f.weightPct > 0);
    if (!vals.length) return null;
    const wsum = vals.reduce((s, f) => s + f.weightPct, 0);
    return wsum > 0 ? vals.reduce((s, f) => s + f.todayPct * f.weightPct, 0) / wsum : null;
  })();

  const portfolioProfitPct = totalProfitPct ?? 0;
  const avgT1m = funds.length ? funds.reduce((s, f) => s + (f.trends['1m'] ?? 0), 0) / funds.length : 0;
  const avgT3m = funds.length ? funds.reduce((s, f) => s + (f.trends['3m'] ?? 0), 0) / funds.length : 0;
  const marketScore = typeof weightedPct === 'number' ? clamp(50 + weightedPct * 8, 0, 100) : 50;
  const pScore = profitScore(portfolioProfitPct);
  const tScore = trendScore(avgT1m, avgT3m);
  const dScore = divScore(funds);
  const overallScore = Math.round(0.3 * marketScore + 0.25 * pScore + 0.25 * tScore + 0.2 * dScore);

  for (const f of funds) {
    f.fundScore = Math.round(
      0.35 * marketScore +
      0.25 * profitScore(f.profitPct ?? 0) +
      0.3 * trendScore(f.trends['1m'], f.trends['3m']) +
      0.1 * dScore
    );
    const sig = signalFor(f, { weightedPct });
    f.signal = sig.signal;
    f.signalReason = sig.reason;
    f.suggestedRatio = sig.ratio;
  }

  const { level, color } = levelOf(overallScore);
  const operations = composeOperations(funds, overallScore, weightedPct, todayPctWeighted);
  const risks = composeRisks(funds, totalProfitPct, weightedPct);
  const summary = composeSummary(market, funds, totalProfitPct, todayPctWeighted, overallScore, level);

  return {
    market,
    portfolio: {
      totalValue: round2(totalValue),
      totalCost: round2(totalCost),
      totalProfit: round2(totalProfit),
      totalProfitPct: round1(totalProfitPct),
      todayProfit: hasEst ? round2(todayProfit) : null,
      todayPctWeighted: round1(todayPctWeighted),
      hasEstimate: hasEst,
      fundCount: funds.length,
    },
    funds,
    overall: { score: overallScore, level, color, signal: level, summary, operations, risks },
  };
}

function composeSummary(market, funds, totalProfitPct, todayPctWeighted, score, level) {
  const parts = [];
  const idx = market.list.filter((q) => q && typeof q.pct === 'number');
  if (idx.length) {
    const up = idx.filter((q) => q.pct > 0).length;
    parts.push(
      `大盘${up === idx.length ? '普涨' : up === 0 ? '普跌' : '分化'}，${idx
        .map((q) => `${q.name} ${q.pct > 0 ? '+' : ''}${round1(q.pct)}%`)
        .join('、')}。`
    );
  } else if (market.error) {
    parts.push('大盘行情获取失败，本次分析仅基于持仓数据。');
  }
  if (funds.length) {
    const tv = funds.reduce((s, f) => s + f.marketValue, 0);
    parts.push(
      `组合共 ${funds.length} 只基金，总市值 ${formatWan(tv)}，累计盈亏 ${totalProfitPct >= 0 ? '+' : ''}${round1(totalProfitPct)}%${
        typeof todayPctWeighted === 'number' ? `，今日估算 ${todayPctWeighted > 0 ? '+' : ''}${round1(todayPctWeighted)}%` : ''
      }。`
    );
  } else {
    parts.push('当前无持仓，建议先建立基础仓位或观望。');
  }
  parts.push(`综合评分 ${score} 分（${level}）。`);
  return parts.join('');
}

function formatWan(v) {
  if (v >= 1e8) return `${round2(v / 1e8)}亿`;
  if (v >= 1e4) return `${round2(v / 1e4)}万`;
  return `${round2(v)}`;
}

function composeOperations(funds, score, weightedPct, todayPctWeighted) {
  const ops = [];
  if (score >= 75) {
    ops.push('组合环境偏积极：可逢回调适度加仓，单日加仓合计不超过总仓位的 10%。');
  } else if (score >= 60) {
    ops.push('组合环境中性偏多：以持有为主，回调时可小幅分批加仓。');
  } else if (score >= 45) {
    ops.push('组合环境中性：保持现有仓位，等待趋势明朗，不追涨杀跌。');
  } else {
    ops.push('组合环境偏谨慎：优先控制仓位与回撤，谨慎加仓，必要时减仓降风险。');
  }
  const act = funds.filter((f) => f.signal !== '持有');
  if (act.length) {
    ops.push('单只基金操作：');
    for (const f of act) {
      ops.push(`  • ${f.name}（${f.code}）：${f.signal}——${f.signalReason}（${f.suggestedRatio}）`);
    }
  } else if (funds.length) {
    ops.push('单只基金操作：全部以持有为主，暂不调整。');
  }
  if (typeof weightedPct === 'number' && weightedPct <= -2.5) {
    ops.push('提示：今日大盘跌幅较大，避免恐慌性操作，也勿盲目抄底，观察明日是否企稳。');
  }
  if (typeof todayPctWeighted === 'number' && todayPctWeighted >= 3) {
    ops.push('提示：今日组合估值涨幅较大，若持有浮盈较高的品种可考虑部分止盈。');
  }
  return ops;
}

function composeRisks(funds, totalProfitPct, weightedPct) {
  const risks = [];
  const maxW = funds.length ? Math.max(...funds.map((f) => f.weightPct)) : 0;
  if (maxW > 60) {
    const f = funds.find((x) => x.weightPct === maxW);
    risks.push(`集中度风险：${f.name} 占比 ${round1(maxW)}%，单只基金占比过高，波动影响大。`);
  } else if (maxW > 40) {
    const f = funds.find((x) => x.weightPct === maxW);
    risks.push(`集中度偏高：${f.name} 占比 ${round1(maxW)}%，建议适当分散。`);
  }
  if (funds.length === 1) risks.push('组合仅持有 1 只基金，分散度不足。');
  if (typeof totalProfitPct === 'number' && totalProfitPct < -15) risks.push(`组合累计浮亏 ${round1(totalProfitPct)}%，需关注回撤控制与止损纪律。`);
  if (typeof weightedPct === 'number' && weightedPct <= -2.5) risks.push('大盘出现较大跌幅，短期波动风险上升。');
  risks.push('基金有风险，投资需谨慎。本建议基于公开行情数据与规则模型自动生成，仅供参考，不构成任何投资建议。');
  return risks;
}
