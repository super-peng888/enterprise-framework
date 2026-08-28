/** 表单设计器拖拽验证：控件面板拖一个控件到画布 */
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
  const widget = [...document.querySelectorAll('.fd-widget')].find(w => w.textContent.includes('下拉选择'))
  if (!widget) return 'widget not found'
  const canvas = document.querySelector('.fd-canvas-grid')
  const before = canvas.querySelectorAll('.fd-grid-item').length
  const dt = new DataTransfer()
  const rect = canvas.getBoundingClientRect()
  widget.dispatchEvent(new DragEvent('dragstart', { bubbles: true, dataTransfer: dt }))
  await new Promise(r => setTimeout(r, 300))
  canvas.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: dt, clientX: rect.left + 300, clientY: rect.top + 150 }))
  await new Promise(r => setTimeout(r, 300))
  canvas.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt, clientX: rect.left + 300, clientY: rect.top + 150 }))
  await new Promise(r => setTimeout(r, 200))
  widget.dispatchEvent(new DragEvent('dragend', { bubbles: true, dataTransfer: dt }))
  await new Promise(r => setTimeout(r, 500))
  const after = document.querySelector('.fd-canvas-grid').querySelectorAll('.fd-grid-item').length
  return 'before=' + before + ' after=' + after
})()`)
console.log('palette drag:', result)
process.exit(0)
