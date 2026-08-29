// 持久化存储层接口。
//
// v1 不接任何数据库：进程内 TTL 缓存（lib/cache.ts）已经够用，且上游本身有速率保护。
// 这里只把接口钉死，等下面任一条件成立再实现 MongoBarStore：
//   - 多实例部署，希望共享缓存 / 降低源站请求量
//   - 需要留存历史行情做复盘（缓存淘汰后不可恢复）
// TODO(v2): 实现 MongoBarStore 并在 lib/market-service.ts 里按 env 开关装配；
// 届时 Bar 主键建议 (symbol, market, date) 唯一索引，写入前按 source 优先级去重。

import type { Bar, Market } from "./providers/interface";

export interface BarQuery {
  symbol: string;
  market: Market;
  /** 闭区间 [from, to]，yyyy-mm-dd */
  from: string;
  to: string;
}

export interface BarStore {
  readonly name: string;
  load(query: BarQuery): Promise<Bar[] | null>;
  save(query: BarQuery, bars: Bar[]): Promise<void>;
}

/** v1 默认实现：只读缓存，不做任何持久化。 */
export class NoopBarStore implements BarStore {
  readonly name = "noop";
  async load(): Promise<Bar[] | null> {
    return null;
  }
  async save(): Promise<void> {
    // no-op
  }
}

export const barStore: BarStore = new NoopBarStore();
