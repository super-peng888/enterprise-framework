/**
 * CDP 截图（真实登录）：调后端登录拿真 token 预注入，单次导航。
 * 前置：Edge headless 带 remote-debugging-port 运行；dev server 与后端 8090 已启动
 * 用法：node shot3-real.mjs <path> <out.png> [waitMs] [width] [height] [theme] [username]
 * 环境变量：CDP_PORT（默认 9222）、BASE_URL（默认 http://localhost:5175）、API_URL（默认 http://localhost:8090）
 */
import { writeFileSync } from 'node:fs'

const CDP = `http://127.0.0.1:${process.env.CDP_PORT ?? '9222'}`
const BASE = process.env.BASE_URL ?? 'http://localhost:5175'
const API = process.env.API_URL ?? 'http://localhost:8090'

const [path = '/approval/designer', out = '/tmp/shot.png', waitMs = '7000', width = '1680', height = '1400', theme = '', username = 'zhangsan'] = process.argv.slice(2)

// 登录拿真 token
const loginRes = await fetch(`${API}/api/system/auth/login`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ username, password: '123456' }),
})
const token = (await loginRes.json())?.data?.token
if (!token) throw new Error('login failed')
const me = await (await fetch(`${API}/api/system/auth/me`, { headers: { Authorization: `Bearer ${token}` } })).json()
const realName = me?.data?.user?.realName ?? username

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

const seed = JSON.stringify(JSON.stringify({ state: { token, userName: username, realName }, version: 0 }))
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
