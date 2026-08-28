/**
 * 角色管理卡片页 CDP 截图（零依赖，Node >= 22）：
 * 前置：Edge headless --remote-debugging-port=9222，dev server 5175，后端 8090。
 * 用法：node shot-roles.mjs
 * 产出：scripts/out/roles-{grid,drawer,modal,dark}.png
 * 流程：真实登录 admin/123456（API 换取 token 写入 ef-auth）→ 卡片网格 →
 * 权限配置 Drawer → 新建角色弹窗 → dark 主题。
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const BASE = 'http://localhost:5175'
const OUT = fileURLToPath(new URL('./out/', import.meta.url))
mkdirSync(OUT, { recursive: true })

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
  return new Promise((resolve) => {
    const id = ++seq
    pending.set(id, resolve)
    ws.send(JSON.stringify({ id, method, params }))
  })
}
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
  width: 1680,
  height: 1000,
  deviceScaleFactor: 1,
  mobile: false,
})

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function evaluate(expression) {
  const res = await send('Runtime.evaluate', {
    expression,
    returnByValue: true,
    awaitPromise: true,
  })
  if (res?.exceptionDetails) {
    console.error('evaluate error:', JSON.stringify(res.exceptionDetails).slice(0, 400))
  }
  return res?.result?.value
}

async function shot(name) {
  const res = await send('Page.captureScreenshot', { format: 'png' })
  if (!res?.data) {
    console.error('screenshot failed:', name)
    process.exit(1)
  }
  writeFileSync(`${OUT}${name}.png`, Buffer.from(res.data, 'base64'))
  console.log('saved', `${OUT}${name}.png`)
}

// 1) 打开登录页，走真实登录（admin/123456）写 token 到 ef-auth
await send('Page.navigate', { url: `${BASE}/login` })
await sleep(2500)
const loginResult = await evaluate(`(async () => {
  const res = await fetch('/api/system/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'admin', password: '123456' }),
  })
  const json = await res.json()
  const token = json?.data?.token
  if (!token) return 'login failed: ' + JSON.stringify(json).slice(0, 200)
  localStorage.setItem('ef-auth', JSON.stringify({
    state: { token, userName: 'admin', realName: '系统管理员', perms: [] },
    version: 0,
  }))
  localStorage.setItem('ef-theme', JSON.stringify({ state: { themeKey: 'cool' }, version: 1 }))
  return 'ok'
})()`)
console.log('login:', loginResult)
if (loginResult !== 'ok') process.exit(1)

// 2) 卡片网格
await send('Page.navigate', { url: `${BASE}/system/roles` })
await sleep(3500)
console.log('cards =', await evaluate(`document.querySelectorAll('.role-card').length`))
await shot('roles-grid')

// 3) 权限配置 Drawer：点第一张卡的「权限配置」按钮
console.log('open drawer =', await evaluate(`(() => {
  const btn = [...document.querySelectorAll('.role-card-actions button')]
    .find((b) => b.textContent.includes('权限配置'))
  if (!btn) return 'button not found'
  btn.click()
  return 'ok'
})()`))
await sleep(1500)
await shot('roles-drawer')
await evaluate(`document.querySelector('.ant-drawer-close')?.click()`)
await sleep(800)

// 4) 新建角色弹窗：点工具栏「新建角色」
console.log('open modal =', await evaluate(`(() => {
  const btn = [...document.querySelectorAll('.roles-toolbar-actions button')]
    .find((b) => b.textContent.includes('新建角色'))
  if (!btn) return 'button not found'
  btn.click()
  return 'ok'
})()`))
await sleep(1200)
await shot('roles-modal')
await evaluate(`document.querySelector('.ant-modal-close')?.click()`)
await sleep(600)

// 5) dark 主题：改 ef-theme 持久化后重载
await evaluate(`localStorage.setItem('ef-theme', JSON.stringify({ state: { themeKey: 'dark' }, version: 1 }))`)
await send('Page.navigate', { url: `${BASE}/system/roles` })
await sleep(3500)
console.log('theme =', await evaluate(`document.documentElement.dataset.theme`))
await shot('roles-dark')

process.exit(0)
