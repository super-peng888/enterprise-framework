/**
 * CDP 验证：merge 汇合锚点 + 条件节点分支管理抽屉。
 * 场景：API 构造「分支布局验证」流程（条件 1/2/3 各一个审批人 + 空默认分支，主链 condition 后还有审批人），
 * 然后真实登录打开设计器：布局截图 → 抽屉分支管理（改名/下移/添加/删除）→ 锚点 + 加分支 → merge 边插入。
 * 用法：node verify-merge.mjs <outDir>
 * 环境变量：CDP_PORT（默认 9222）、BASE_URL（默认 http://localhost:5175）、API_URL（默认 http://localhost:8090）
 */
import { writeFileSync, mkdirSync } from 'node:fs'

const CDP = `http://127.0.0.1:${process.env.CDP_PORT ?? '9222'}`
const BASE = process.env.BASE_URL ?? 'http://localhost:5175'
const API = process.env.API_URL ?? 'http://localhost:8090'
const [outDir = 'scripts/out'] = process.argv.slice(2)
mkdirSync(outDir, { recursive: true })

/* ---------------- 登录 + 构造场景流程 ---------------- */
const loginRes = await fetch(`${API}/api/system/auth/login`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ username: 'zhangsan', password: '123456' }),
})
const token = (await loginRes.json())?.data?.token
if (!token) throw new Error('login failed')
const me = await (await fetch(`${API}/api/system/auth/me`, { headers: { Authorization: `Bearer ${token}` } })).json()
const realName = me?.data?.user?.realName ?? 'zhangsan'
const authH = { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }

const approver = (name, people) => ({
  name, type: 'approver', signMode: 'or', approvers: people, approverType: 'member',
})
const scenario = {
  nodes: [
    {
      name: '条件分支', type: 'condition',
      branches: [
        { name: '条件 1', isDefault: false, conditions: [{ op: '<', field: 'days', value: '3' }], children: [approver('组长审批', ['张三'])] },
        { name: '条件 2', isDefault: false, conditions: [{ op: '≥', field: 'days', value: '3' }], children: [approver('经理审批', ['李四'])] },
        { name: '条件 3', isDefault: false, conditions: [{ op: '>', field: '金额(元)', value: '1000' }], children: [approver('总监审批', ['系统管理员'])] },
        { name: '其他条件', isDefault: true, conditions: [], children: [] },
      ],
    },
    { name: '部门负责人审批', type: 'approver', signMode: 'or', approvers: [], approverType: 'deptLeader' },
  ],
}
const flows = (await (await fetch(`${API}/api/system/flows`, { headers: authH })).json())?.data?.list ?? []
const existing = flows.find((f) => f.name === '分支布局验证')
if (existing) {
  await fetch(`${API}/api/system/flows/${existing.id}`, { method: 'PUT', headers: authH, body: JSON.stringify({ name: existing.name, flowJson: JSON.stringify(scenario), status: '启用' }) })
  console.log('updated flow id =', existing.id)
} else {
  const r = await fetch(`${API}/api/system/flows`, { method: 'POST', headers: authH, body: JSON.stringify({ name: '分支布局验证', flowJson: JSON.stringify(scenario), status: 1 }) })
  console.log('created flow =', (await r.json())?.data?.id)
}

/* ---------------- CDP ---------------- */
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
await send('Emulation.setDeviceMetricsOverride', { width: 1680, height: 1400, deviceScaleFactor: 1, mobile: false })
const seed = JSON.stringify(JSON.stringify({ state: { token, userName: 'zhangsan', realName }, version: 0 }))
await send('Page.addScriptToEvaluateOnNewDocument', {
  source: `try{localStorage.setItem('ef-auth', ${seed});}catch(e){}`,
})

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
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const counts = () =>
  evalJs(`JSON.stringify({
    cond: document.querySelectorAll('.flow-cond-anchor:not(.flow-merge-anchor)').length,
    merge: document.querySelectorAll('.flow-merge-anchor').length,
    branch: document.querySelectorAll('.flow-branch-card').length,
    card: document.querySelectorAll('.flow-node-card').length,
    edge: document.querySelectorAll('.react-flow__edge').length,
    plus: document.querySelectorAll('.flow-edge-label .flow-add-btn').length,
  })`).then((s) => JSON.parse(s ?? '{}'))

await send('Page.navigate', { url: `${BASE}/approval/designer` })
await sleep(8000)
console.log('url =', await evalJs('location.href'))

// 打开场景流程
await evalJs(`[...document.querySelectorAll('.flow-list-item')].find(i => i.textContent.includes('分支布局验证'))?.click()`)
await sleep(2000)
console.log('counts =', JSON.stringify(await counts()))

// 几何校验：merge 中心 x ≈ 首/末分支卡中心的中点；fork/merge 横线对称
console.log('geometry =', await evalJs(`(() => {
  const r = (el) => { const b = el.getBoundingClientRect(); return { x: +(b.left + b.width / 2).toFixed(1), y: +(b.top + b.height / 2).toFixed(1) } }
  const cards = [...document.querySelectorAll('.flow-branch-card')].map(r).sort((a, b) => a.x - b.x)
  const merge = r(document.querySelector('.flow-merge-anchor'))
  const cond = r(document.querySelector('.flow-cond-anchor:not(.flow-merge-anchor)'))
  const mid = +(((cards[0].x + cards[cards.length - 1].x) / 2).toFixed(1))
  return JSON.stringify({ first: cards[0].x, last: cards[cards.length - 1].x, mid, mergeX: merge.x, condX: cond.x,
    mergeOk: Math.abs(merge.x - mid) < 2, condOk: Math.abs(cond.x - mid) < 2, mergeBelow: merge.y > Math.max(...cards.map(c => c.y)) })
})()`))
await shot('merge-4branches.png')

// merge → 主链边的 + 插入审批人（插到主链 condition 之后）
await evalJs(`(() => {
  const m = document.querySelector('.flow-merge-anchor').getBoundingClientRect()
  const labels = [...document.querySelectorAll('.flow-edge-label')]
  const below = labels
    .filter((l) => { const r = l.getBoundingClientRect(); const cx = (r.left + r.right) / 2; return r.top > m.bottom - 20 && Math.abs(cx - (m.left + m.right) / 2) < 150 })
    .sort((a, b) => a.getBoundingClientRect().top - b.getBoundingClientRect().top)[0]
  below?.querySelector('.flow-add-btn')?.click()
})()`)
await sleep(800)
await evalJs(`[...document.querySelectorAll('.ant-dropdown-menu-item')].find(i => i.textContent.includes('审批人'))?.click()`)
await sleep(1500)
const afterInsert = await counts()
console.log('after merge-edge insert =', JSON.stringify(afterInsert))
await shot('merge-edge-insert.png')

// 点 condition 锚点 → 分支管理抽屉
await evalJs(`document.querySelector('.flow-cond-anchor:not(.flow-merge-anchor)')?.click()`)
await sleep(1200)
console.log('drawer open =', await evalJs(`!!document.querySelector('.ant-drawer-open')`),
  'rows =', await evalJs(`document.querySelectorAll('.flow-branch-row').length`),
  'default tag =', await evalJs(`document.querySelectorAll('.flow-branch-default-tag').length`))
await shot('merge-drawer.png')

// 抽屉内改名：条件 2 → 金额分支（原生 setter 触发 React onChange）
await evalJs(`(() => {
  const input = document.querySelectorAll('.flow-branch-row .ant-input')[1]
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
  setter.call(input, '金额分支')
  input.dispatchEvent(new Event('input', { bubbles: true }))
})()`)
await sleep(1000)
console.log('branch names after rename =', await evalJs(`JSON.stringify([...document.querySelectorAll('.flow-branch-card .flow-card-name')].map(e => e.textContent))`))

// 下移第一行（条件 1 ↔ 金额分支 交换）
await evalJs(`document.querySelectorAll('.flow-branch-row')[0].querySelectorAll('.flow-branch-row-btn')[1]?.click()`)
await sleep(1000)
console.log('branch order after move-down =', await evalJs(`JSON.stringify([...document.querySelectorAll('.flow-branch-card')].sort((a,b)=>a.getBoundingClientRect().left-b.getBoundingClientRect().left).map(e => e.querySelector('.flow-card-name').textContent))`))

// 抽屉内「添加分支」→ 5 行 / 5 卡
await evalJs(`[...document.querySelectorAll('.ant-drawer-open button')].find(b => b.textContent.includes('添加分支'))?.click()`)
await sleep(1200)
console.log('after drawer add =', await evalJs(`document.querySelectorAll('.flow-branch-row').length`), '/', (await counts()).branch)

// 删除刚加的分支（条件 4，第 4 行的删除按钮）→ 回到 4
await evalJs(`(() => { const btns = document.querySelectorAll('.flow-branch-row')[3].querySelectorAll('.flow-branch-row-btn'); btns[btns.length - 1]?.click() })()`)
await sleep(1200)
console.log('after drawer delete =', await evalJs(`document.querySelectorAll('.flow-branch-row').length`), '/', (await counts()).branch)

// 关抽屉，点锚点上的 + → 5 分支 refit（lucide 图标是 SVG，无 .click()，需派发 MouseEvent）
await evalJs(`document.querySelector('.ant-drawer-close')?.dispatchEvent(new MouseEvent('click', { bubbles: true }))`)
await sleep(800)
await evalJs(`document.querySelector('.flow-cond-anchor-add')?.dispatchEvent(new MouseEvent('click', { bubbles: true }))`)
await sleep(1800)
console.log('after anchor + =', JSON.stringify(await counts()))
await shot('merge-5branches.png')

process.exit(0)
