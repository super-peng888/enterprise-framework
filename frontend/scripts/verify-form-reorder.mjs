/** 表单设计器画布内拖拽排序验证：把最后一个字段拖到第一个字段前 */
const list = await (await fetch('http://127.0.0.1:9223/json/list')).json()
const target = list.filter((t) => t.type === 'page').pop()
const ws = new WebSocket(target.webSocketDebuggerUrl)
let seq = 0
const pending = new Map()
const send = (m, p = {}) =>
  new Promise((r) => {
    const id = ++seq
    pending.set(id, r)
    ws.send(JSON.stringify({ id, method: m, params: p }))
  })
ws.onmessage = (ev) => {
  const m = JSON.parse(ev.data)
  if (m.id && pending.has(m.id)) {
    pending.get(m.id)(m.result ?? m.error)
    pending.delete(m.id)
  }
}
await new Promise((r) => (ws.onopen = r))
const evalJs = async (expression) =>
  (await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }))?.result
    ?.value

const result = await evalJs(`(async () => {
  const items = document.querySelectorAll('.fd-grid-item')
  const before = [...items].map(i => i.querySelector('.fd-field-title')?.textContent.trim()).join(' | ')
  const last = items[items.length - 1]
  const handle = last.querySelector('.fd-drag-handle')
  const target = items[0].querySelector('.fd-field-card')
  if (!handle || !target) return 'handle/target not found'
  const dt = new DataTransfer()
  const rect = target.getBoundingClientRect()
  handle.dispatchEvent(new DragEvent('dragstart', { bubbles: true, dataTransfer: dt }))
  await new Promise(r => setTimeout(r, 300))
  target.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: dt, clientX: rect.left + 50, clientY: rect.top + 5 }))
  await new Promise(r => setTimeout(r, 300))
  target.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt, clientX: rect.left + 50, clientY: rect.top + 5 }))
  await new Promise(r => setTimeout(r, 200))
  handle.dispatchEvent(new DragEvent('dragend', { bubbles: true, dataTransfer: dt }))
  await new Promise(r => setTimeout(r, 500))
  const after = [...document.querySelectorAll('.fd-grid-item')].map(i => i.querySelector('.fd-field-title')?.textContent.trim()).join(' | ')
  return 'before: ' + before + ' || after: ' + after
})()`)
console.log('canvas reorder:', result)
process.exit(0)
