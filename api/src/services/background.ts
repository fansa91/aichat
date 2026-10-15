// 跟踪 fire-and-forget 的后台任务（如标题自动生成），便于测试等待其收敛。
// 生产环境仍是"发射后不管"，不阻塞主流程。

const pending = new Set<Promise<unknown>>();

export function trackBackground(p: Promise<unknown>): void {
  pending.add(p);
  p.finally(() => {
    pending.delete(p);
  }).catch(() => {
    /* maybeGenerateTitle 内部已 catch，此处兜底 */
  });
}

export async function drainBackground(): Promise<void> {
  while (pending.size > 0) {
    await Promise.allSettled([...pending]);
  }
}
