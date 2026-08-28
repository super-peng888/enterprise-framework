export function formatFans(fans: number): string {
  if (fans >= 10000) {
    const w = fans / 10000
    return `${Number.isInteger(w) ? w : w.toFixed(1)}万`
  }
  return String(fans)
}

/** 金额（元）格式化为万元展示 */
export function formatMoney(amount: number): string {
  if (amount >= 10000) {
    const w = amount / 10000
    return `¥${Number.isInteger(w) ? w : w.toFixed(1)}万`
  }
  return `¥${amount.toLocaleString()}`
}
