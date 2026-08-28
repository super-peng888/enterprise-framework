/**
 * CDP 交互复现：在「条件1」分支内点 + 插入审批人，观察节点落到哪里。
 * 用法：MSYS2_ARG_CONV_EXCL="*" node repro-insert.mjs
 */
import { writeFileSync } from 'node:fs'

const loginRes = await fetch('http://localhost:8090/api/system/auth/login', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ username: 'wangfang', password: '123456' }),
})
const token = (await loginRes.json())?.data?.token

const list = await (await fetch('http://127.0.0.1:9222/json/list')).json()
const target = list.filter((t) => t.type === 'page').pop()
const ws = new WebSocket(target.webSocketDebuggerUrl)
let seq = 0
const pending = new Map()
const send = (m, p = {}) =>
  new Promise((r) => {
    const id = ++seq
    pending.set(id, r)
    ws.send(JSON.stringify({ id, method: m, params: p }))
  })
ws.onmessage = (ev) => {
  const m = JSON.parse(ev.data)
  if (m.id && pending.has(m.id)) {
    pending.get(m.id)(m.result ?? m.error)
    pending.delete(m.id)
  }
}
await new Promise((r) => (ws.onopen = r))
await send('Page.enable')
await send('Emulation.setDeviceMetricsOverride', { width: 1680, height: 1600, deviceScaleFactor: 1, mobile: false })
const seed = JSON.stringify(JSON.stringify({ state: { token, userName: 'wangfang', realName: '王芳' }, version: 0 }))
await send('Page.addScriptToEvaluateOnNewDocument', {
  source: `try{localStorage.setItem('ef-auth', ${seed})}catch(e){}`,
})
await send('Page.navigate', { url: 'http://localhost:5175/approval/designer' })
await new Promise((r) => setTimeout(r, 15000))

const evalJs = async (expression) =>
  (await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }))?.result?.value

// 点击条件1分支内的最后一个 +（分支末尾插入）
const clicked = await evalJs(`(() => {
  const col = document.querySelector('.flow-branch-col.is-first')
  if (!col) return 'no branch col'
  const btns = col.querySelectorAll('.flow-add-btn')
  if (!btns.length) return 'no add btn'
  btns[btns.length - 1].click()
  return 'clicked ' + btns.length
})()`)
console.log('click +:', clicked)
await new Promise((r) => setTimeout(r, 800))

// 点 Dropdown 里的「审批人」
const picked = await evalJs(`(() => {
  const items = [...document.querySelectorAll('.ant-dropdown-menu-item')]
  const it = items.find(i => i.textContent.includes('审批人'))
  if (!it) return 'no menu item, open menus=' + items.length
  it.click()
  return 'picked'
})()`)
console.log('pick 审批人:', picked)
await new Promise((r) => setTimeout(r, 1500))

// 输出当前结构：主链和分支内各有什么节点
const structure = await evalJs(`(() => {
  const dump = []
  document.querySelectorAll('.flow-chain-item').forEach(item => {
    const name = item.querySelector('.flow-card-name')?.textContent ?? '(条件块)'
    dump.push(name)
  })
  return dump.join(' | ')
})()`)
console.log('structure:', structure)

const shot = await send('Page.captureScreenshot', { format: 'png' })
writeFileSync('C:/Users/王鹏/AppData/Local/Temp/insert-test.png', Buffer.from(shot.data, 'base64'))
console.log('saved insert-test.png')
process.exit(0)
