/**
 * CDP 拖拽排序验证：mock 登录态进流程设计器，真实 dispatchEvent 模拟 HTML5 DnD。
 * 前置：Edge 已带 --remote-debugging-port=9222 运行，dev server 5175 运行（后端可不在，走 mock 降级）。
 * 用法：node drag-test.mjs
 * 产出：scripts/out/drag-before.png（初始）、drag-indicator.png（拖拽中指示线）、drag-after.png（排序后）
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'

const OUT = 'scripts/out'
mkdirSync(OUT, { recursive: true })

const list = await (await fetch('http://127.0.0.1:9222/json/list')).json()
let target = list.filter((t) => t.type === 'page').pop()
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

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const evaluate = async (expression) => {
  const res = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
  if (res?.exceptionDetails) throw new Error('evaluate failed: ' + JSON.stringify(res.exceptionDetails))
  return res?.result?.value
}
const shot = async (name) => {
  const s = await send('Page.captureScreenshot', { format: 'png' })
  writeFileSync(`${OUT}/${name}.png`, Buffer.from(s.data, 'base64'))
  console.log('saved', `${OUT}/${name}.png`)
}

await send('Page.enable')
await send('Emulation.setDeviceMetricsOverride', {
  width: 1680,
  height: 1500,
  deviceScaleFactor: 1,
  mobile: false,
})

// 登录态：后端在跑则换真 token（与 shot3.mjs 一致）；不在则用 mock token 走数据降级
let token = 'mock-token-cdp-drag'
let userName = 'demo'
let realName = '演示用户'
try {
  const loginRes = await fetch('http://localhost:8090/api/system/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'zhangsan', password: '123456' }),
  })
  const t = (await loginRes.json())?.data?.token
  if (t) {
    token = t
    userName = 'zhangsan'
    const me = await (
      await fetch('http://localhost:8090/api/system/auth/me', {
        headers: { Authorization: `Bearer ${token}` },
      })
    ).json()
    realName = me?.data?.user?.realName ?? userName
  }
} catch {
  /* 后端不在，保持 mock */
}
console.log('auth =', userName, realName)

const seed = JSON.stringify(
  JSON.stringify({ state: { token, userName, realName }, version: 0 }),
)
await send('Page.addScriptToEvaluateOnNewDocument', {
  source: `try{localStorage.setItem('ef-auth', ${seed});}catch(e){}`,
})
await send('Page.navigate', { url: 'http://localhost:5175/approval/designer' })
await sleep(7000)
console.log('url =', await evaluate('location.href'))

const readState = () =>
  evaluate(`(() => {
    const branches = [...document.querySelectorAll('.flow-branch-card')].map((c) => ({
      priority: c.querySelector('.flow-branch-priority')?.textContent?.trim(),
      name: c.querySelector('.flow-card-name')?.textContent?.trim(),
      draggableHeader: !!c.querySelector('.flow-card-header.is-draggable'),
    }))
    const rootChain = document.querySelector('.flow-canvas-inner > .flow-chain')
    const rootNodes = [...rootChain.querySelectorAll(':scope > .flow-chain-item > .flow-node-wrap')].map((w) =>
      w.querySelector('.flow-card-name')?.textContent?.trim() ?? '(条件分支)',
    )
    return { branches, rootNodes, indicators: document.querySelectorAll('.flow-branch-drop-indicator, .flow-node-wrap.drop-before, .flow-node-wrap.drop-after').length }
  })()`)

const before = await readState()
console.log('before =', JSON.stringify(before, null, 2))
await shot('drag-before')

// 加一个分支，凑出两个普通分支用于排序
await evaluate(`[...document.querySelectorAll('.flow-branch-add-btn')][0].click()`)
await sleep(600)
console.log('after add =', JSON.stringify((await readState()).branches))

// ---- 分支拖拽：第 2 个普通分支(index 1) → 第 1 个分支左侧 ----
// 注意：dragstart / dragover 必须分次 evaluate（跨 JS task），否则 React 18 自动批处理
// 未 flush，dragover 处理函数闭包里的 dragBranchId 还是 null
await evaluate(`(() => {
  const cols = [...document.querySelectorAll('.flow-branch-col')]
  const srcHeader = cols[1].querySelector('.flow-card-header')
  const dt = new DataTransfer()
  window.__dt = dt
  srcHeader.dispatchEvent(new DragEvent('dragstart', { bubbles: true, cancelable: true, dataTransfer: dt }))
})()`)
await sleep(200)
await evaluate(`(() => {
  const cols = [...document.querySelectorAll('.flow-branch-col')]
  const r = cols[0].getBoundingClientRect()
  cols[0].dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: window.__dt, clientX: r.left + r.width * 0.25, clientY: r.top + 40 }))
})()`)
await sleep(400)
const mid = await readState()
console.log('mid-drag indicators =', mid.indicators)
await shot('drag-indicator')
await evaluate(`(() => {
  const cols = [...document.querySelectorAll('.flow-branch-col')]
  const srcHeader = cols[1].querySelector('.flow-card-header')
  const r = cols[0].getBoundingClientRect()
  cols[0].dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: window.__dt, clientX: r.left + r.width * 0.25, clientY: r.top + 40 }))
  srcHeader.dispatchEvent(new DragEvent('dragend', { bubbles: true, cancelable: true, dataTransfer: window.__dt }))
})()`)
await sleep(500)
const afterBranch = await readState()
console.log('after branch drag =', JSON.stringify(afterBranch.branches))
await shot('drag-after')

// ---- 节点拖拽：主链「抄送」→ 主链首个节点上方 ----
await evaluate(`(() => {
  const wraps = [...document.querySelectorAll('.flow-canvas-inner > .flow-chain > .flow-chain-item > .flow-node-wrap')]
  const dt = new DataTransfer()
  window.__dt2 = dt
  const src = wraps[wraps.length - 1]
  src.dispatchEvent(new DragEvent('dragstart', { bubbles: true, cancelable: true, dataTransfer: dt }))
})()`)
await sleep(200)
await evaluate(`(() => {
  const wraps = [...document.querySelectorAll('.flow-canvas-inner > .flow-chain > .flow-chain-item > .flow-node-wrap')]
  const r = wraps[0].getBoundingClientRect()
  wraps[0].dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: window.__dt2, clientX: r.left + r.width / 2, clientY: r.top + r.height * 0.2 }))
})()`)
await sleep(400)
console.log('node mid-drag indicators =', (await readState()).indicators)
await shot('drag-node-indicator')
await evaluate(`(() => {
  const wraps = [...document.querySelectorAll('.flow-canvas-inner > .flow-chain > .flow-chain-item > .flow-node-wrap')]
  const src = wraps[wraps.length - 1]
  const r = wraps[0].getBoundingClientRect()
  wraps[0].dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: window.__dt2, clientX: r.left + r.width / 2, clientY: r.top + r.height * 0.2 }))
  src.dispatchEvent(new DragEvent('dragend', { bubbles: true, cancelable: true, dataTransfer: window.__dt2 }))
})()`)
await sleep(500)
const afterNode = await readState()
console.log('after node drag rootNodes =', JSON.stringify(afterNode.rootNodes))
await shot('drag-node-after')

process.exit(0)
