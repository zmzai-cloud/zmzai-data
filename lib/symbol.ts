// 标的代码归一化：调用方可以写 600519 / 600519.SH / sh600519 / BTC / BTCUSDT，
// 出口统一收敛为「规范代码」：A股 6 位数字、加密 base（BTC/ETH/SOL…）。
// 规范代码与 zmzai-arena 的 INSTRUMENT_MAP key 一致，便于回测侧直接对接。

import type { Market } from "./providers/interface";

const A_SHARE = /^\d{6}$/;
const CRYPTO_PAIR = /^([A-Z0-9]{2,10})USDT$/;
const CRYPTO_BASE = /^[A-Z0-9]{2,10}$/;

export class SymbolError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SymbolError";
  }
}

/**
 * 归一化入参 → 规范代码。无法识别时抛 SymbolError（调用方映射为 400）。
 */
export function normalizeSymbol(raw: string): string {
  const s = raw.trim().toUpperCase();
  if (!s) throw new SymbolError("symbol 不能为空");
  if (s.length > 24) throw new SymbolError(`symbol 过长：${raw}`);

  // A股：600519 / 600519.SH / SH600519 / sh600519
  const suffix = s.match(/^(\d{6})\.(SH|SZ|BJ)$/);
  if (suffix) return suffix[1];
  const prefixed = s.match(/^(SH|SZ|BJ)(\d{6})$/);
  if (prefixed) return prefixed[2];
  if (A_SHARE.test(s)) return s;
  // 纯数字但位数不对（如 60051）不可能是加密代码 → 明确报错，避免被当成 base 静默接受
  if (/^\d+$/.test(s)) throw new SymbolError(`A股代码必须是 6 位数字：${raw}`);

  // 加密：BTCUSDT → BTC；BTC → BTC
  const pair = s.match(CRYPTO_PAIR);
  if (pair) return pair[1];
  if (CRYPTO_BASE.test(s)) return s;

  throw new SymbolError(`无法识别的标的代码：${raw}`);
}

export function marketOf(symbol: string): Market {
  return A_SHARE.test(symbol) ? "A股" : "加密";
}

/** A股规范代码 → Tushare ts_code（600519 → 600519.SH） */
export function toTsCode(symbol: string): string {
  if (!A_SHARE.test(symbol)) throw new SymbolError(`不是 A股代码：${symbol}`);
  // 深市：000/001/002/003 主板、30 创业板、15x/16x/18x 基金（含 159xxx ETF）、20 B股
  if (/^(0|3|15|16|18|20)/.test(symbol)) return `${symbol}.SZ`;
  // 北交所：4xx / 8xx / 920xxx
  if (/^(4|8|920)/.test(symbol)) return `${symbol}.BJ`;
  // 其余（6 主板 / 688 科创板 / 5x 沪市基金 ETF / 9 B股）归沪市
  return `${symbol}.SH`;
}

/** 加密规范代码 → Binance 交易对（BTC → BTCUSDT） */
export function toBinanceSymbol(symbol: string): string {
  if (A_SHARE.test(symbol)) throw new SymbolError(`不是加密代码：${symbol}`);
  return `${symbol}USDT`;
}

/** 报价货币 */
export function currencyOf(market: Market): string {
  return market === "A股" ? "CNY" : "USDT";
}
