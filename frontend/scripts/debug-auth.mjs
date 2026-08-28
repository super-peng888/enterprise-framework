/** CDP 调试：检查 seed 流程中 localStorage 与最终状态 */
const base = 'http://localhost:5175'

async function getTarget() {
  for (let i = 0; i < 20; i++) {
    try {
      const res = await fetch('http://127.0.0.1:9222/json/list')
      const list = await res.json()
      const t = list.find((x) => x.type === 'page')
      if (t) return t
    } catch {}
    await new Promise((r) => setTimeout(r, 500))
  }
  throw new Error('no target')
}

const target = await getTarget()
const ws = new WebSocket(target.webSocketDebuggerUrl)
let seq = 0
const pending = new Map()
const send = (method, params = {}) =>
  new Promise((resolve) => {
    const id = ++seq
    pending.set(id, resolve)
    ws.send(JSON.stringify({ id, method, params }))
  })
ws.onmessage = (ev) => {
  const msg = JSON.parse(ev.data)
  if (msg.id && pending.has(msg.id)) {
    pending.get(msg.id)(msg.result ?? msg.error)
    pending.delete(msg.id)
  }
}
await new Promise((r) => (ws.onopen = r))
await send('Page.enable')

const evalJs = async (expr) => {
  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true })
  return r?.result?.value
}

// 1. 打开 set-auth（带 hash 会跳转，这里先看写入）
await send('Page.navigate', { url: `${base}/set-auth.html` })
await new Promise((r) => setTimeout(r, 2000))
console.log('1. after seed, localStorage =', await evalJs("localStorage.getItem('ef-auth')"))

// 2. 跳转设计器
await send('Page.navigate', { url: `${base}/approval/designer` })
await new Promise((r) => setTimeout(r, 6000))
console.log('2. final url =', await evalJs('location.href'))
console.log('3. localStorage still =', await evalJs("localStorage.getItem('ef-auth')"))
console.log('4. body snippet =', (await evalJs('document.body.innerText.slice(0,200)'))?.replace(/\n/g, ' | '))
process.exit(0)
