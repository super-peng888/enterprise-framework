/**
 * CDP 交互验证：真实登录 → 打开流程设计器 → ①点击节点开抽屉截图 ②点边中点 + 插入审批人节点截图。
 * 用法：node interact.mjs <outDir> [theme]
 * 环境变量：CDP_PORT（默认 9223）、BASE_URL（默认 http://localhost:5176）、API_URL（默认 http://localhost:8090）
 */
import { writeFileSync } from 'node:fs'

const CDP = `http://127.0.0.1:${process.env.CDP_PORT ?? '9223'}`
const BASE = process.env.BASE_URL ?? 'http://localhost:5176'
const API = process.env.API_URL ?? 'http://localhost:8090'
const [outDir = 'scripts/out', theme = ''] = process.argv.slice(2)

const loginRes = await fetch(`${API}/api/system/auth/login`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ username: 'zhangsan', password: '123456' }),
})
const token = (await loginRes.json())?.data?.token
if (!token) throw new Error('login failed')
const me = await (await fetch(`${API}/api/system/auth/me`, { headers: { Authorization: `Bearer ${token}` } })).json()
const realName = me?.data?.user?.realName ?? 'zhangsan'

const created = await fetch(`${CDP}/json/new?about:blank`, { method: 'PUT' })
const target = await created.json()
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
await send('Emulation.setDeviceMetricsOverride', { width: 1680, height: 1200, deviceScaleFactor: 1, mobile: false })
const seed = JSON.stringify(JSON.stringify({ state: { token, userName: 'zhangsan', realName }, version: 0 }))
const themeSeed = theme ? JSON.stringify(JSON.stringify({ state: { themeKey: theme }, version: 0 })) : ''
await send('Page.addScriptToEvaluateOnNewDocument', {
  source: `try{localStorage.setItem('ef-auth', ${seed});${themeSeed ? `localStorage.setItem('ef-theme', ${themeSeed});` : ''}}catch(e){}`,
})
await send('Page.navigate', { url: `${BASE}/approval/designer` })
await new Promise((r) => setTimeout(r, 8000))

const evalJs = async (expression) => {
  const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
  return r?.result?.value
}
const shot = async (name) => {
  const s = await send('Page.captureScreenshot', { format: 'png' })
  writeFileSync(`${outDir}/${name}`, Buffer.from(s.data, 'base64'))
  console.log('saved', name)
}

console.log('url =', await evalJs('location.href'))
console.log('cards =', await evalJs(`document.querySelectorAll('.flow-node-card').length`),
  'edges+ =', await evalJs(`document.querySelectorAll('.flow-edge-label .flow-add-btn').length`))

// ① 点击「部门负责人审批」节点卡 → 抽屉
await evalJs(`[...document.querySelectorAll('.flow-node-card')].find(c => c.textContent.includes('部门负责人'))?.click()`)
await new Promise((r) => setTimeout(r, 1200))
console.log('drawer open =', await evalJs(`!!document.querySelector('.ant-drawer-open')`))
await shot('rf-interact-drawer.png')
// 关抽屉
await evalJs(`document.querySelector('.ant-drawer-close')?.click()`)
await new Promise((r) => setTimeout(r, 800))

// ② 点击主链第一条边（发起人→部门负责人）的 + → 菜单选「审批人」
await evalJs(`document.querySelector('.flow-edge-label .flow-add-btn')?.click()`)
await new Promise((r) => setTimeout(r, 800))
await shot('rf-interact-edgemenu.png')
await evalJs(`[...document.querySelectorAll('.ant-dropdown-menu-item')].find(i => i.textContent.includes('审批人'))?.click()`)
await new Promise((r) => setTimeout(r, 1500))
console.log('cards after insert =', await evalJs(`document.querySelectorAll('.flow-node-card').length`))
await shot('rf-interact-inserted.png')

// ③ 点击分支卡 → 分支抽屉（含上移/下移）
await evalJs(`[...document.querySelectorAll('.flow-branch-card')].find(c => c.textContent.includes('天数'))?.click()`)
await new Promise((r) => setTimeout(r, 1200))
console.log('branch drawer =', await evalJs(`document.querySelector('.ant-drawer-open .ant-drawer-title')?.textContent`))
await shot('rf-interact-branch-drawer.png')

process.exit(0)
