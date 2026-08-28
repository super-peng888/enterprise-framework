/**
 * CDP 截图（真实 token 版）：
 * 1. 调后端登录拿真 token  2. 在 set-auth.html 域内写入 localStorage
 * 3. 跳转目标页  4. 等待后截图
 * 用法：node shot2.mjs <path> <out.png> [waitMs] [width] [height] [username]
 */
import { writeFileSync } from 'node:fs'

const [path = '/dashboard', out = '/tmp/shot.png', waitMs = '7000', width = '1680', height = '1400', username = 'zhangsan'] = process.argv.slice(2)

// 1. 后端登录拿真 token
const loginRes = await fetch('http://localhost:8090/api/system/auth/login', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ username, password: '123456' }),
})
const loginData = await loginRes.json()
const token = loginData?.data?.token
if (!token) throw new Error('login failed: ' + JSON.stringify(loginData))
const meRes = await fetch('http://localhost:8090/api/system/auth/me', {
  headers: { Authorization: `Bearer ${token}` },
})
const me = await meRes.json()
const realName = me?.data?.user?.realName ?? username
console.log('login ok:', username, realName)

// 2. CDP
const listRes = await fetch('http://127.0.0.1:9222/json/list')
const target = (await listRes.json()).find((t) => t.type === 'page')
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
await send('Emulation.setDeviceMetricsOverride', {
  width: Number(width), height: Number(height), deviceScaleFactor: 1, mobile: false,
})
const evalJs = async (expression) =>
  (await send('Runtime.evaluate', { expression, returnByValue: true }))?.result?.value

await send('Page.navigate', { url: 'http://localhost:5175/set-auth.html' })
await new Promise((r) => setTimeout(r, 2000))
const seedValue = JSON.stringify({
  state: { token, userName: username, realName },
  version: 0,
})
await evalJs('localStorage.setItem("ef-auth", ' + JSON.stringify(seedValue) + ')')
await send('Page.navigate', { url: `http://localhost:5175${path}` })
await new Promise((r) => setTimeout(r, Number(waitMs)))
console.log('final url =', await evalJs('location.href'))
const shot = await send('Page.captureScreenshot', { format: 'png' })
writeFileSync(out, Buffer.from(shot.data, 'base64'))
console.log('saved', out)
process.exit(0)
