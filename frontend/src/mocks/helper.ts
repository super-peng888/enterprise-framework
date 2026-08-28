/**
 * 模拟接口延迟，第一期统一走本地 mock 数据。
 */
export function mockResolve<T>(data: T, delay = 300): Promise<T> {
  return new Promise((resolve) => {
    setTimeout(() => resolve(data), delay)
  })
}
