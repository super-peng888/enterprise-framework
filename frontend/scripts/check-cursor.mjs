/** 验证排序列右缝的自定义光标是否生效 */
const list = await (await fetch('http://127.0.0.1:9222/json/list')).json()
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
await send('Page.enable')
await send('Emulation.setDeviceMetricsOverride', { width: 1680, height: 1300, deviceScaleFactor: 1, mobile: false })
await send('Page.navigate', { url: 'http://localhost:5175/system/menus' })
await new Promise((r) => setTimeout(r, 9000))

const evalJs = async (expression) =>
  (await send('Runtime.evaluate', { expression, returnByValue: true }))?.result?.value

const pos = await evalJs(`(() => {
  const ths = [...document.querySelectorAll('.ant-table-thead th')]
  const t = ths.find((x) => x.textContent.includes('排序'))
  if (!t) return null
  const rz = t.querySelector('.dt-col-resizer')
  if (!rz) return { error: 'no resizer in th' }
  const r = rz.getBoundingClientRect()
  return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2), rect: { left: r.left, right: r.right, top: r.top, h: r.height } }
})()`)
console.log('pos:', JSON.stringify(pos))
if (pos) {
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: pos.x, y: pos.y })
  await new Promise((r) => setTimeout(r, 500))
  const el = await evalJs(
    `(() => { const el = document.elementFromPoint(${pos.x}, ${pos.y}); return el ? el.className + ' | cursor=' + getComputedStyle(el).cursor.slice(0, 60) : 'none' })()`,
  )
  console.log('element at sort seam:', el)
}
process.exit(0)
