/**
 * CDP 验证：嵌套 condition 各自配 merge 锚点、连线不打架。
 * 场景：在「分支布局验证」流程的条件 2 分支内追加一个嵌套条件分支（金额>5000 → 审批人 / 空默认分支）。
 * 用法：node verify-merge-nested.mjs <outDir>
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
        {
          name: '条件 2', isDefault: false, conditions: [{ op: '≥', field: 'days', value: '3' }],
          children: [
            approver('经理审批', ['李四']),
            {
              name: '金额判断', type: 'condition',
              branches: [
                { name: '条件 1', isDefault: false, conditions: [{ op: '>', field: '金额(元)', value: '5000' }], children: [approver('总监审批', ['系统管理员'])] },
                { name: '其他条件', isDefault: true, conditions: [], children: [] },
              ],
            },
          ],
        },
        { name: '条件 3', isDefault: false, conditions: [{ op: '>', field: '金额(元)', value: '1000' }], children: [approver('总监审批', ['系统管理员'])] },
        { name: '其他条件', isDefault: true, conditions: [], children: [] },
      ],
    },
    { name: '部门负责人审批', type: 'approver', signMode: 'or', approvers: [], approverType: 'deptLeader' },
  ],
}
const flows = (await (await fetch(`${API}/api/system/flows`, { headers: authH })).json())?.data?.list ?? []
const existing = flows.find((f) => f.name === '分支布局验证')
await fetch(`${API}/api/system/flows/${existing.id}`, { method: 'PUT', headers: authH, body: JSON.stringify({ name: existing.name, flowJson: JSON.stringify(scenario), status: '启用' }) })
console.log('updated flow id =', existing.id, '(nested)')

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
await send('Emulation.setDeviceMetricsOverride', { width: 1680, height: 1500, deviceScaleFactor: 1, mobile: false })
const seed = JSON.stringify(JSON.stringify({ state: { token, userName: 'zhangsan', realName }, version: 0 }))
await send('Page.addScriptToEvaluateOnNewDocument', {
  source: `try{localStorage.setItem('ef-auth', ${seed});}catch(e){}`,
})
const evalJs = async (expression) => {
  const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
  if (r?.exceptionDetails) console.log('JS ERROR:', JSON.stringify(r.exceptionDetails).slice(0, 300))
  return r?.result?.value
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

await send('Page.navigate', { url: `${BASE}/approval/designer` })
await sleep(8000)
await evalJs(`[...document.querySelectorAll('.flow-list-item')].find(i => i.textContent.includes('分支布局验证'))?.click()`)
await sleep(2000)
console.log('nested counts =', await evalJs(`JSON.stringify({
  cond: document.querySelectorAll('.flow-cond-anchor:not(.flow-merge-anchor)').length,
  merge: document.querySelectorAll('.flow-merge-anchor').length,
  branch: document.querySelectorAll('.flow-branch-card').length,
  edge: document.querySelectorAll('.react-flow__edge').length,
})`))
// 嵌套 merge 居中于其嵌套分支列（首/末嵌套分支卡中点）
console.log('nested geometry =', await evalJs(`(() => {
  const r = (el) => { const b = el.getBoundingClientRect(); return { x: +(b.left + b.width / 2).toFixed(1), y: +(b.top + b.height / 2).toFixed(1) } }
  const merges = [...document.querySelectorAll('.flow-merge-anchor')].map(r).sort((a, b) => a.y - b.y)
  const nestedCards = [...document.querySelectorAll('.flow-branch-card')]
    .filter((c) => c.getBoundingClientRect().top > 400) // 嵌套分支卡在视口更下方
    .map(r).sort((a, b) => a.x - b.x)
  if (nestedCards.length < 2) return JSON.stringify({ skip: true, merges })
  const mid = +(((nestedCards[0].x + nestedCards[nestedCards.length - 1].x) / 2).toFixed(1))
  const nestedMerge = merges[1] ?? merges[0]
  return JSON.stringify({ mid, nestedMergeX: nestedMerge.x, ok: Math.abs(nestedMerge.x - mid) < 2 })
})()`))
const s = await send('Page.captureScreenshot', { format: 'png' })
writeFileSync(`${outDir}/merge-nested.png`, Buffer.from(s.data, 'base64'))
console.log('saved merge-nested.png')
process.exit(0)
