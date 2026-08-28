/**
 * CDP 端到端验证（坐标级真实鼠标事件版）：
 * 真实登录 admin → 菜单管理页新增「角色测试」菜单 → 侧边栏出现 → 点击打开组件 →
 * 编辑改名 → 删除。截图存 scripts/out/。
 * 用法：node verify-menus.mjs
 */
import { writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const CDP = `http://127.0.0.1:${process.env.CDP_PORT ?? '9222'}`
const BASE = process.env.BASE_URL ?? 'http://localhost:5175'
const API = process.env.API_URL ?? 'http://localhost:8090'
const OUT = fileURLToPath(new URL('./out/', import.meta.url))

// ---- 登录 ----
const loginRes = await fetch(`${API}/api/system/auth/login`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ username: 'admin', password: '123456' }),
})
const token = (await loginRes.json())?.data?.token
if (!token) throw new Error('login failed')
const me = await (
  await fetch(`${API}/api/system/auth/me`, { headers: { Authorization: `Bearer ${token}` } })
).json()
const { realName, username } = me.data.user
const perms = me.data.perms ?? []
console.log('login ok, perms =', perms)

// ---- CDP ----
const created = await fetch(`${CDP}/json/new?about:blank`, { method: 'PUT' })
const target = await created.json()
const ws = new WebSocket(target.webSocketDebuggerUrl)
let seq = 0
const pending = new Map()
const send = (m, p = {}) =>
  new Promise((res) => {
    const id = ++seq
    pending.set(id, res)
    ws.send(JSON.stringify({ id, method: m, params: p }))
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
await send('Runtime.enable')
await send('Emulation.setDeviceMetricsOverride', {
  width: 1680,
  height: 1400,
  deviceScaleFactor: 1,
  mobile: false,
})

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const ev = async (expression) => {
  const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
  if (r?.exceptionDetails) throw new Error('evaluate failed: ' + JSON.stringify(r.exceptionDetails).slice(0, 400))
  return r?.result?.value
}
/** 坐标级真实点击：先取元素中心点，再发 mousePressed/Released */
const realClick = async (findExpr) => {
  const rect = await ev(`(() => {
    const el = (${findExpr})
    if (!el) return null
    el.scrollIntoView({ block: 'center' })
    const r = el.getBoundingClientRect()
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 }
  })()`)
  if (!rect) return false
  for (const type of ['mousePressed', 'mouseReleased']) {
    await send('Input.dispatchMouseEvent', { type, x: rect.x, y: rect.y, button: 'left', clickCount: 1 })
  }
  return true
}
const shot = async (name) => {
  const data = (await send('Page.captureScreenshot', { format: 'png' }))?.data
  writeFileSync(`${OUT}${name}`, Buffer.from(data, 'base64'))
  console.log('saved', name)
}
const waitFor = async (expression, timeout = 10000, label = expression) => {
  const start = Date.now()
  while (Date.now() - start < timeout) {
    if (await ev(expression)) return true
    await sleep(300)
  }
  console.log('--- timeout dump ---')
  console.log('url:', await ev('location.pathname'))
  console.log('modal:', await ev(`!!document.querySelector('.ant-modal')`))
  console.log('dropdowns:', await ev(`[...document.querySelectorAll('.ant-select-dropdown')].map(d=>d.className.includes('hidden')?'hidden':'visible').join(',')`))
  console.log('messages:', await ev(`document.querySelector('.ant-message')?.textContent ?? ''`))
  console.log('form errors:', await ev(`[...document.querySelectorAll('.ant-modal [class*="error"]')].map(e=>e.textContent).filter(Boolean).join('|')`))
  throw new Error('waitFor timeout: ' + label)
}
const q = (sel, text) =>
  `[...document.querySelectorAll(${JSON.stringify(sel)})].find(e => e.textContent.includes(${JSON.stringify(text)}))`

// ---- 进入菜单管理页 ----
const seed = JSON.stringify(
  JSON.stringify({ state: { token, userName: username, realName, perms }, version: 0 }),
)
await send('Page.addScriptToEvaluateOnNewDocument', {
  source: `try{localStorage.setItem('ef-auth', ${seed});}catch(e){}`,
})
await send('Page.navigate', { url: `${BASE}/system/menus` })
await waitFor(`!!${q('.ant-table-row', '工作台')}`, 20000, 'menus table')
await sleep(1000)
await shot('menu-1-table.png')

// ---- 新增菜单「角色测试」 ----
await realClick(q('button', '新增菜单'))
await waitFor(`!!document.querySelector('.ant-modal .ant-form')`, 5000, 'modal')
await sleep(1000)
await realClick(q('.ant-modal .ant-radio-button-wrapper', '菜单'))
await sleep(600)
await ev(`document.querySelector('.ant-modal #title').focus()`)
await send('Input.insertText', { text: '角色测试' })
// 父级：系统管理（TreeSelect 节点用合成 click 点 content-wrapper，实测最稳）
await realClick(`document.querySelector('.ant-modal .ant-tree-select')`)
await waitFor(`!!${q('.ant-select-dropdown .ant-select-tree-treenode', '系统管理')}`, 5000, 'parent dropdown')
await sleep(500)
await ev(`${q('.ant-select-dropdown .ant-select-tree-treenode', '系统管理')}?.querySelector('[class*="node-content-wrapper"]')?.click()`)
await sleep(800)
// 组件地址：输入 Roles 过滤后键盘选中（选项在虚拟列表里宽度为 0，鼠标点不中，用 ArrowDown+Enter）
await realClick(`document.querySelector('.ant-modal .ant-select:not(.ant-tree-select):not(.ant-auto-complete)')`)
await sleep(600)
await send('Input.insertText', { text: 'Roles' })
await waitFor(`!!${q('.ant-select-dropdown:not(.ant-select-dropdown-hidden) [role="option"]', 'Roles.tsx')}`, 5000, 'component dropdown')
for (const [type, key, code, vk] of [
  ['rawKeyDown', 'ArrowDown', 'ArrowDown', 40],
  ['rawKeyDown', 'Enter', 'Enter', 13],
]) {
  await send('Input.dispatchKeyEvent', { type, key, code, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk })
  await sleep(400)
}
console.log('parent =', await ev(`document.querySelector('.ant-modal .ant-tree-select .ant-select-content')?.innerText`))
console.log('component =', await ev(`document.querySelector('.ant-modal .ant-select:not(.ant-tree-select):not(.ant-auto-complete) .ant-select-content')?.innerText`))
await shot('menu-2-create-form.png')
await realClick(`document.querySelector('.ant-modal-footer button.ant-btn-primary')`)
await waitFor(`!document.querySelector('.ant-modal-wrap:not(.ant-modal-wrap-hidden)')`, 8000, 'create done')
await sleep(1500)
await shot('menu-3-created.png')
console.log('sidebar 角色测试 =', await ev(`!!${q('.ant-menu', '角色测试')}`))
console.log('table 角色测试 =', await ev(`!!${q('.ant-table-row', '角色测试')}`))

// ---- 侧边栏点击「角色测试」→ 打开 Roles 组件 ----
await realClick(q('.ant-menu .ant-menu-title-content', '角色测试'))
await sleep(2500)
console.log('url =', await ev('location.pathname'))
await shot('menu-4-open-roles.png')

// ---- 编辑改名「角色测试2」 ----
await send('Page.navigate', { url: `${BASE}/system/menus` })
await waitFor(`!!${q('.ant-table-row', '角色测试')}`, 20000, 'row 角色测试')
await sleep(800)
await realClick(`(() => { const row = ${q('.ant-table-row', '角色测试')}; return row && row.querySelector('button[title="编辑"]') })()`)
await waitFor(`!!document.querySelector('.ant-modal .ant-form')`, 5000, 'edit modal')
await sleep(500)
await ev(`document.querySelector('.ant-modal #title').focus()`)
await send('Input.insertText', { text: '2' })
await realClick(`document.querySelector('.ant-modal-footer button.ant-btn-primary')`)
await waitFor(`!document.querySelector('.ant-modal-wrap:not(.ant-modal-wrap-hidden)')`, 8000, 'edit done')
await sleep(1500)
console.log('renamed =', await ev(`!!${q('.ant-table-row', '角色测试2')}`))
await shot('menu-5-edited.png')

// ---- 删除 ----
await realClick(`(() => { const row = ${q('.ant-table-row', '角色测试2')}; return row && row.querySelector('button[title="删除"]') })()`)
await waitFor(`!!document.querySelector('.ant-popconfirm, .ant-popover')`, 5000, 'popconfirm')
await sleep(400)
await ev(`(() => {
  const root = document.querySelector('.ant-popconfirm') || document.querySelector('.ant-popover')
  const btn = root && [...root.querySelectorAll('button')].find((b) => b.className.includes('primary'))
  btn && btn.click()
  return !!btn
})()`)
await sleep(1800)
console.log('deleted =', await ev(`!${q('.ant-table-row', '角色测试2')}`))
await shot('menu-6-deleted.png')

// ---- 后端终态 ----
const list = await (
  await fetch(`${API}/api/system/menus`, { headers: { Authorization: `Bearer ${token}` } })
).json()
console.log('backend leftover =', list.data.filter((m) => m.title.includes('角色测试')).length)

process.exit(0)
