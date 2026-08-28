/** 检查 Dream Han Sans 是否加载生效 */
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
const evalJs = async (expression) =>
  (await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }))?.result?.value

console.log('check 400:', await evalJs(`document.fonts.check('400 16px "Dream Han Sans CN"')`))
console.log('check 700:', await evalJs(`document.fonts.check('700 16px "Dream Han Sans CN"')`))
console.log('faces:', await evalJs(`[...document.fonts].map(f => f.family + ' w' + f.weight + ' ' + f.status).join(' | ')`))
console.log('body font-family:', await evalJs(`getComputedStyle(document.body).fontFamily.slice(0, 100)`))
process.exit(0)
