// 交易操作结算模块：用户提交的加仓/减仓操作，在生效日（下一个交易日）按净值自动更新持仓
import crypto from 'node:crypto';
import { getFundQuote } from './market.js';
import { generateAdvice } from './service.js';
import { shNow, shDateStr } from './time.js';

// 结算所有已到生效日的待执行操作；结算后如有持仓变化，自动重新生成建议（AI 解读同步刷新）
export async function settlePendingOps(log = console.log, userStore) {
  if (!userStore) return { settled: 0, pending: 0 };
  const today = shDateStr(shNow());
  const allOps = userStore.getPendingOps();
  const due = allOps.filter((o) => o.status === 'pending' && o.effDate && o.effDate <= today);
  if (!due.length) return { settled: 0, pending: allOps.filter((o) => o.status === 'pending').length };

  const list = userStore.getHoldings();
  const byCode = new Map(list.map((h) => [h.code, h]));
  let changed = false;
  let settledCount = 0;

  for (const op of due) {
    try {
      const q = await getFundQuote(op.code);
      const nav = q && q.nav;
      if (!nav || nav <= 0) {
        op.error = '净值未更新，稍后重试';
        continue; // 净值不可得则留待下次结算
      }
      let h = byCode.get(op.code);
      if (op.type === 'add') {
        const addShares = Math.round((op.amount / nav) * 10000) / 10000;
        if (!h) {
          // 加仓但无持仓：按结算净值新建
          h = {
            id: crypto.randomUUID(),
            code: op.code,
            name: q.name || op.name || op.code,
            shares: addShares,
            costNav: Math.round(nav * 100000) / 100000,
            note: op.note ? `加仓 ${op.amount}元（${op.effDate}生效）` : '',
            updatedAt: new Date().toISOString(),
          };
          byCode.set(op.code, h);
        } else {
          const oldCost = h.costNav * h.shares;
          const newShares = h.shares + addShares;
          h.shares = Math.round(newShares * 10000) / 10000;
          h.costNav = Math.round(((oldCost + op.amount) / newShares) * 100000) / 100000; // 加权平均成本
          h.updatedAt = new Date().toISOString();
        }
        op.result = `按净值 ${nav} 加仓 ${op.amount} 元，增加 ${addShares} 份`;
        changed = true;
      } else if (op.type === 'reduce') {
        if (!h) {
          op.result = '持仓不存在，跳过';
        } else {
          const reduceShares = Math.round((op.amount / nav) * 10000) / 10000;
          if (reduceShares >= h.shares - 1e-6) {
            // 赎回金额超过持仓市值：视为全部赎回，移除持仓
            byCode.delete(op.code);
            op.result = `按净值 ${nav} 赎回全部持仓（${h.shares} 份）`;
          } else {
            h.shares = Math.round((h.shares - reduceShares) * 10000) / 10000;
            h.updatedAt = new Date().toISOString();
            op.result = `按净值 ${nav} 减仓 ${op.amount} 元，减少 ${reduceShares} 份，剩余 ${h.shares} 份`;
          }
          changed = true;
        }
      } else {
        op.result = '未知操作类型，跳过';
      }
      op.status = 'done';
      op.doneAt = new Date().toISOString();
      delete op.error;
      settledCount++;
    } catch (e) {
      op.error = e.message;
    }
  }

  userStore.saveHoldings([...byCode.values()]);
  userStore.savePendingOps(allOps);

  if (changed) {
    try {
      await generateAdvice({ force: true }, userStore);
      log(`[结算] ${today} 持仓已更新，今日建议已重新生成（含AI解读）`);
    } catch (e) {
      log(`[结算] ${today} 建议重新生成失败: ${e.message}`);
    }
  }
  return { settled: settledCount, pending: allOps.filter((o) => o.status === 'pending').length };
}