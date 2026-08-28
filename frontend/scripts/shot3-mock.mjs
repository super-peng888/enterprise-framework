/**
 * CDP 截图（mock 模式）：不依赖后端，预注入 mock 登录态，前端 api 降级到本地 mock 数据。
 * 前置：Edge headless 已带 --remote-debugging-port=9222 运行；dev server 5175 已启动
 * 用法：node shot3-mock.mjs <path> <out.png> [waitMs] [width] [height] [theme]
 * 环境变量：CDP_PORT（默认 9222）、BASE_URL（默认 http://localhost:5175）
 */
import { writeFileSync } from 'node:fs'

const CDP = `http://127.0.0.1:${process.env.CDP_PORT ?? '9222'}`
const BASE = process.env.BASE_URL ?? 'http://localhost:5175'

const [path = '/approval/designer', out = '/tmp/shot.png', waitMs = '7000', width = '1680', height = '1400', theme = ''] = process.argv.slice(2)

const list = await (await fetch(`${CDP}/json/list`)).json()
let target = list.filter((t) => t.type === 'page').pop()
try {
  const created = await fetch(`${CDP}/json/new?about:blank`, { method: 'PUT' })
  if (created.ok) target = await created.json()
} catch {}
console.log('target =', target.url)
const ws = new WebSocket(target.webSocketDebuggerUrl)
let seq = 0
const pending = new Map()
const send = (method, params = {}) =>
  new Promise((resolve, reject) => {
    const id = ++seq
    pending.set(id, { resolve, reject })
    ws.send(JSON.stringify({ id, method, params }))
  })
ws.onmessage = (ev) => {
  const msg = JSON.parse(ev.data)
  if (msg.id && pending.has(msg.id)) {
    pending.get(msg.id).resolve(msg.result ?? msg.error)
    pending.delete(msg.id)
  }
}
await new Promise((r) => (ws.onopen = r))
await send('Page.enable')
await send('Emulation.setDeviceMetricsOverride', { width: +width, height: +height, deviceScaleFactor: 1, mobile: false })

// mock 登录态：token 带 mock-token- 前缀，api 层请求失败后降级到 src/mocks 数据
const seed = JSON.stringify(JSON.stringify({ state: { token: 'mock-token-cdp', userName: 'zhangsan', realName: '张三' }, version: 0 }))
const themeSeed = theme ? JSON.stringify(JSON.stringify({ state: { themeKey: theme }, version: 0 })) : ''
await send('Page.addScriptToEvaluateOnNewDocument', {
  source: `try{localStorage.setItem('ef-auth', ${seed});${themeSeed ? `localStorage.setItem('ef-theme', ${themeSeed});` : ''}}catch(e){}`,
})
await send('Page.navigate', { url: `${BASE}${path}` })
await new Promise((r) => setTimeout(r, +waitMs))
const url = (await send('Runtime.evaluate', { expression: 'location.href', returnByValue: true }))?.result?.value
console.log('final url =', url)
const shot = await send('Page.captureScreenshot', { format: 'png' })
if (!shot?.data) throw new Error('screenshot failed: ' + JSON.stringify(shot))
writeFileSync(out, Buffer.from(shot.data, 'base64'))
console.log('saved', out)
process.exit(0)
