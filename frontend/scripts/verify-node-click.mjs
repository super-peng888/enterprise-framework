/**
 * CDP 真实鼠标验证（修复 @xyflow/react v12 节点 pointer-events 后）：
 * 真实登录 → 打开流程设计器 → 用 Input.dispatchMouseEvent（非 .click()）：
 * ①点击「部门负责人审批」节点卡 → 抽屉打开 + 截图 + 读取悬停处实际光标
 * ②点击「天数>3」分支卡 → 分支抽屉 + 截图
 * ③点击边中点 + → 插入菜单弹出（验证其他交互未受影响）
 * 用法：node verify-node-click.mjs [outDir]
 * 环境变量：CDP_PORT（默认 9222）、BASE_URL（默认 http://localhost:5175）、API_URL（默认 http://localhost:8090）
 */
import { writeFileSync, mkdirSync } from 'node:fs'

const CDP = `http://127.0.0.1:${process.env.CDP_PORT ?? '9222'}`
const BASE = process.env.BASE_URL ?? 'http://localhost:5175'
const API = process.env.API_URL ?? 'http://localhost:8090'
const [outDir = 'scripts/out'] = process.argv.slice(2)
mkdirSync(outDir, { recursive: true })

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
await send('Page.addScriptToEvaluateOnNewDocument', {
  source: `try{localStorage.setItem('ef-auth', ${seed});}catch(e){}`,
})
await send('Page.navigate', { url: `${BASE}/approval/designer` })
await new Promise((r) => setTimeout(r, 8000))

const evalJs = async (expression) => {
  const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
  if (r?.exceptionDetails) console.log('JS ERROR:', JSON.stringify(r.exceptionDetails).slice(0, 300))
  return r?.result?.value
}
const shot = async (name) => {
  const s = await send('Page.captureScreenshot', { format: 'png' })
  writeFileSync(`${outDir}/${name}`, Buffer.from(s.data, 'base64'))
  console.log('saved', name)
}
const center = async (selExpr) =>
  evalJs(`(() => { const el = ${selExpr}; if (!el) return null
    const r = el.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 } })()`)
const mouse = async (type, x, y, extra = {}) =>
  send('Input.dispatchMouseEvent', { type, x, y, button: 'left', clickCount: 1, ...extra })
const realClick = async (pt) => {
  await mouse('mouseMoved', pt.x, pt.y, { button: 'none', clickCount: 0 })
  await new Promise((r) => setTimeout(r, 300))
  await mouse('mousePressed', pt.x, pt.y)
  await new Promise((r) => setTimeout(r, 80))
  await mouse('mouseReleased', pt.x, pt.y, { clickCount: 1 })
}
const cursorAt = async (pt) =>
  evalJs(`(() => { const el = document.elementFromPoint(${pt.x}, ${pt.y})
    return el ? getComputedStyle(el).cursor + ' <- ' + el.className : 'none' })()`)

console.log('url =', await evalJs('location.href'))
console.log('node cards =', await evalJs(`document.querySelectorAll('.flow-node-card').length`),
  'branch cards =', await evalJs(`document.querySelectorAll('.flow-branch-card').length`),
  'edge + =', await evalJs(`document.querySelectorAll('.flow-edge-label .flow-add-btn').length`))
console.log('node wrapper inline pointer-events =',
  await evalJs(`document.querySelector('.react-flow__node')?.style.pointerEvents ?? '(unset)'`))

// ① 真实点击「部门负责人审批」节点卡
let pt = await center(`[...document.querySelectorAll('.flow-node-card')].find(c => c.textContent.includes('部门负责人'))`)
console.log('node card at', JSON.stringify(pt), '| cursor at point:', await cursorAt(pt))
await realClick(pt)
await new Promise((r) => setTimeout(r, 1200))
console.log('① drawer open =', await evalJs(`!!document.querySelector('.ant-drawer-open')`),
  '| title =', await evalJs(`document.querySelector('.ant-drawer-open .ant-drawer-title')?.textContent`))
await shot('fix-node-drawer.png')
await evalJs(`document.querySelector('.ant-drawer-close')?.click()`)
await new Promise((r) => setTimeout(r, 800))

// ② 真实点击「天数>3」分支卡
pt = await center(`[...document.querySelectorAll('.flow-branch-card')].find(c => c.textContent.includes('天数'))`)
console.log('branch card at', JSON.stringify(pt), '| cursor at point:', await cursorAt(pt))
await realClick(pt)
await new Promise((r) => setTimeout(r, 1200))
console.log('② branch drawer open =', await evalJs(`!!document.querySelector('.ant-drawer-open')`),
  '| title =', await evalJs(`document.querySelector('.ant-drawer-open .ant-drawer-title')?.textContent`),
  '| has 触发条件 =', await evalJs(`!![...document.querySelectorAll('.ant-drawer-open .flow-drawer-section-title')].find(d => d.textContent.includes('触发条件'))`))
await shot('fix-branch-drawer.png')
await evalJs(`document.querySelector('.ant-drawer-close')?.click()`)
await new Promise((r) => setTimeout(r, 800))

// ③ 边中点 +（真实点击）→ 插入菜单
pt = await center(`document.querySelector('.flow-edge-label .flow-add-btn')`)
console.log('edge + at', JSON.stringify(pt), '| cursor at point:', await cursorAt(pt))
await realClick(pt)
await new Promise((r) => setTimeout(r, 900))
console.log('③ insert menu open =', await evalJs(`document.querySelectorAll('.ant-dropdown-menu-item').length`), 'items')
await shot('fix-edge-menu.png')
await evalJs(`document.body.click()`)

// ④ 空白画布光标应为 grab（pane 平移）
const panePt = { x: 1400, y: 200 }
await mouse('mouseMoved', panePt.x, panePt.y, { button: 'none', clickCount: 0 })
await new Promise((r) => setTimeout(r, 300))
console.log('④ pane cursor at empty area:', await cursorAt(panePt))

// ⑤ 「添加分支」按钮光标
pt = await center(`document.querySelector('.flow-branch-add-btn')`)
if (pt) console.log('⑤ add-branch btn cursor:', await cursorAt(pt))

process.exit(0)
