/**
 * CDP 截图工具（零依赖，Node >= 22）：
 * 启动：先运行 Edge headless 带 --remote-debugging-port=9222
 * 用法：node shot.mjs <url> <out.png> [waitMs] [width] [height]
 */
import { writeFileSync } from 'node:fs'

const [url, out, waitMs = '6000', width = '1680', height = '1400'] = process.argv.slice(2)
if (!url || !out) {
  console.error('usage: node shot.mjs <url> <out.png> [waitMs] [width] [height]')
  process.exit(1)
}

// 找到页面 target
let target
for (let i = 0; i < 30; i++) {
  try {
    const res = await fetch('http://127.0.0.1:9222/json/list')
    const list = await res.json()
    target = list.find((t) => t.type === 'page')
    if (target) break
  } catch {}
  await new Promise((r) => setTimeout(r, 500))
}
if (!target) {
  console.error('no debug target found')
  process.exit(1)
}

const ws = new WebSocket(target.webSocketDebuggerUrl)
let seq = 0
const pending = new Map()

function send(method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = ++seq
    pending.set(id, { resolve, reject })
    ws.send(JSON.stringify({ id, method, params }))
  })
}

ws.onmessage = (ev) => {
  const msg = JSON.parse(ev.data)
  if (msg.id && pending.has(msg.id)) {
    pending.get(msg.id).resolve(msg.result ?? msg.error)
    pending.delete(msg.id)
  }
}

await new Promise((r) => (ws.onopen = r))
await send('Page.enable')
await send('Emulation.setDeviceMetricsOverride', {
  width: Number(width),
  height: Number(height),
  deviceScaleFactor: 1,
  mobile: false,
})
await send('Page.navigate', { url })
await new Promise((r) => setTimeout(r, Number(waitMs)))
const shot = await send('Page.captureScreenshot', { format: 'png' })
if (!shot?.data) {
  console.error('screenshot failed', JSON.stringify(shot))
  process.exit(1)
}
writeFileSync(out, Buffer.from(shot.data, 'base64'))
console.log('saved', out)

// 顺便输出当前 URL 和关键状态
const loc = await send('Runtime.evaluate', { expression: 'location.href', returnByValue: true })
console.log('url =', loc?.result?.value)
process.exit(0)
