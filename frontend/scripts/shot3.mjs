/**
 * CDP 截图 v3：Page.addScriptToEvaluateOnNewDocument 预注入登录态，单次导航。
 * 前置：Edge headless 已带 --remote-debugging-port=9222 运行
 * 用法：node shot3.mjs <path> <out.png> [waitMs] [width] [height] [username] [theme]
 */
import { writeFileSync } from 'node:fs'

const [path = '/dashboard', out = '/tmp/shot.png', waitMs = '7000', width = '1680', height = '1400', username = 'zhangsan', theme = ''] = process.argv.slice(2)

// 登录拿真 token
const loginRes = await fetch('http://localhost:8090/api/system/auth/login', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ username, password: '123456' }),
})
const token = (await loginRes.json())?.data?.token
if (!token) throw new Error('login failed')
const me = await (await fetch('http://localhost:8090/api/system/auth/me', { headers: { Authorization: `Bearer ${token}` } })).json()
const realName = me?.data?.user?.realName ?? username

const list = await (await fetch('http://127.0.0.1:9222/json/list')).json()
let target = list.filter((t) => t.type === 'page').pop()
// 优先新建干净 target（新版 CDP 需 PUT）
try {
  const created = await fetch('http://127.0.0.1:9222/json/new?about:blank', { method: 'PUT' })
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
const navResp = await send('Page.navigate', { url: `http://localhost:5175${path}` })
console.log('navigate resp =', JSON.stringify(navResp))
await new Promise((r) => setTimeout(r, +waitMs))
const url = (await send('Runtime.evaluate', { expression: 'location.href', returnByValue: true }))?.result?.value
console.log('final url =', url)
const shot = await send('Page.captureScreenshot', { format: 'png' })
if (!shot?.data) throw new Error('screenshot failed: ' + JSON.stringify(shot))
writeFileSync(out, Buffer.from(shot.data, 'base64'))
console.log('saved', out)
process.exit(0)
