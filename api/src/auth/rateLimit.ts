// 轻量内存固定窗口速率限制（防登录爆破），无外部依赖。

export interface LimiterOpts { windowMs: number; max: number }

export function createRateLimiter(opts: LimiterOpts) {
  const hits = new Map<string, { count: number; resetAt: number }>();
  return {
    check(key: string): boolean {
      const now = Date.now();
      const cur = hits.get(key);
      if (!cur || cur.resetAt <= now) {
        if (hits.size > 10000) {
          for (const [k, v] of hits) if (v.resetAt <= now) hits.delete(k);
        }
        hits.set(key, { count: 1, resetAt: now + opts.windowMs });
        return true;
      }
      cur.count += 1;
      return cur.count <= opts.max;
    },
  };
}
