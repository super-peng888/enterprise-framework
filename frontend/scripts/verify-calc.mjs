/**
 * CDP 端到端验证：计算字段（compute 公式）。
 * 流程：登录 admin → 表单中心 → 打开请假申请表设计器 → 加明细子表（数量 quantity / 单价 price / 金额 amount=quantity*price）
 * → 加总金额 total=SUM(detail.amount)、含税金额 total_tax=total*1.06（验证计算字段引用计算字段的两轮兜底）
 * → 非法公式红字提示（截图）→ 预览：填两行数量/单价，行金额自动算、总金额/含税金额自动算（截图）。
 * 全程不保存，退出设计器。
 * 用法：MSYS2_ARG_CONV_EXCL='*' node verify-calc.mjs
 * 前置：Edge headless --remote-debugging-port=9223；dev server 5175；后端 8090
 */
import { writeFileSync } from 'node:fs'

const CDP = 'http://127.0.0.1:9223'
const BASE = 'http://localhost:5175'
const API = 'http://localhost:8090'
const OUT = new URL('./out/', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')

const loginRes = await fetch(`${API}/api/system/auth/login`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ username: 'admin', password: '123456' }),
})
const token = (await loginRes.json())?.data?.token
if (!token) throw new Error('login failed')
const me = await (await fetch(`${API}/api/system/auth/me`, { headers: { Authorization: `Bearer ${token}` } })).json()
const realName = me?.data?.user?.realName ?? 'admin'

const list = await (await fetch(`${CDP}/json/list`)).json()
let target = list.filter((t) => t.type === 'page').pop()
try {
  const created = await fetch(`${CDP}/json/new?about:blank`, { method: 'PUT' })
  if (created.ok) target = await created.json()
} catch {}
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
  const m = JSON.parse(ev.data)
  if (m.id && pending.has(m.id)) {
    pending.get(m.id)(m.result ?? m.error)
    pending.delete(m.id)
  }
}
await new Promise((r) => (ws.onopen = r))
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const evalJs = async (expression) => {
  const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
  if (r?.exceptionDetails) throw new Error('eval failed: ' + JSON.stringify(r.exceptionDetails).slice(0, 500))
  return r?.result?.value
}
const shot = async (name) => {
  const s = await send('Page.captureScreenshot', { format: 'png' })
  writeFileSync(`${OUT}${name}.png`, Buffer.from(s.data, 'base64'))
  console.log('saved', name)
}

await send('Page.enable')
await send('Emulation.setDeviceMetricsOverride', { width: 1680, height: 1400, deviceScaleFactor: 1, mobile: false })
const seed = JSON.stringify(JSON.stringify({ state: { token, userName: 'admin', realName }, version: 0 }))
await send('Page.addScriptToEvaluateOnNewDocument', {
  source: `try{localStorage.setItem('ef-auth', ${seed});}catch(e){}`,
})
await send('Page.addScriptToEvaluateOnNewDocument', {
  source: `window.__t = {
    setValue(el, v) {
      const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype
      Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, v)
      el.dispatchEvent(new Event('input', { bubbles: true }))
    },
    click(el) { el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true })) },
    btn(scope, text) {
      return [...(scope ?? document).querySelectorAll('button')].find(
        (b) => b.textContent.replace(/\\s/g, '').includes(text),
      )
    },
    cfgItem(label) {
      const panel = document.querySelector('.fd-config')
      return [...panel.querySelectorAll('.fd-form-item')].find(i =>
        i.querySelector('.fd-form-label')?.textContent.trim().startsWith(label))
    },
    async pick(selectEl, text) {
      const trigger = selectEl.querySelector('.ant-select-selector') ?? selectEl
      trigger.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }))
      await new Promise(r => setTimeout(r, 400))
      const opt = [...document.querySelectorAll('.ant-select-dropdown:not(.ant-select-dropdown-hidden) .ant-select-item-option')]
        .find(o => o.textContent.includes(text))
      if (!opt) throw new Error('option not found: ' + text)
      this.click(opt)
      await new Promise(r => setTimeout(r, 300))
    },
  }`,
})

await send('Page.navigate', { url: `${BASE}/approval/forms` })
await sleep(5000)
console.log('url =', await evalJs('location.href'))

// 1. 打开请假申请表设计器
console.log('open designer:', await evalJs(`(() => {
  const row = [...document.querySelectorAll('.ant-table-row')].find(r => r.textContent.includes('请假申请'))
  if (!row) return 'row not found'
  __t.click(row.querySelector('td'))
  return 'clicked'
})()`))
await sleep(2000)
console.log('designer ready:', await evalJs(`!!document.querySelector('.fd-canvas-grid')`))

// 2. 加明细子表，编码改 detail
console.log('add subTable:', await evalJs(`(() => {
  const w = [...document.querySelectorAll('.fd-widget')].find(w => w.textContent.includes('明细子表'))
  if (!w) return 'widget not found'
  __t.click(w)
  return 'clicked'
})()`))
await sleep(800)
console.log('set key=detail:', await evalJs(`(() => {
  const item = __t.cfgItem('编码')
  if (!item) return 'key item not found'
  const input = item.querySelector('input')
  __t.setValue(input, 'detail')
  return input.value
})()`))
await sleep(400)

// 3. 子列：col0 → 数量 quantity 数字；col1 → 单价 price 金额；新增 col2 → 金额 amount 金额 + 行内公式
console.log('edit col0:', await evalJs(`(async () => {
  const sub = document.querySelectorAll('.fd-subcol')[0]
  const inputs = sub.querySelectorAll('.fd-subcol-row input')
  __t.setValue(inputs[0], '数量')
  __t.setValue(inputs[1], 'quantity')
  await __t.pick(sub.querySelector('.ant-select'), '数字')
  return 'done'
})()`))
await sleep(400)
console.log('edit col1:', await evalJs(`(() => {
  const sub = document.querySelectorAll('.fd-subcol')[1]
  const inputs = sub.querySelectorAll('.fd-subcol-row input')
  __t.setValue(inputs[0], '单价')
  __t.setValue(inputs[1], 'price')
  return 'done'
})()`))
await sleep(400)
console.log('add col2:', await evalJs(`(() => {
  __t.click(__t.btn(document.querySelector('.fd-config'), '添加子列'))
  return 'clicked'
})()`))
await sleep(600)
console.log('edit col2:', await evalJs(`(async () => {
  const sub = document.querySelectorAll('.fd-subcol')[2]
  if (!sub) return 'col2 not found'
  const inputs = sub.querySelectorAll('.fd-subcol-row input')
  __t.setValue(inputs[0], '金额')
  __t.setValue(inputs[1], 'amount')
  await __t.pick(sub.querySelector('.ant-select'), '金额')
  return 'done'
})()`))
await sleep(400)
// 先填一个非法公式验证红字提示，再改正确
console.log('bad row formula:', await evalJs(`(() => {
  const sub = document.querySelectorAll('.fd-subcol')[2]
  const f = [...sub.querySelectorAll('input')].find(i => i.placeholder.includes('行内公式'))
  if (!f) return 'formula input not found'
  __t.setValue(f, 'quantity *')
  return f.value
})()`))
await sleep(500)
console.log('row formula err:', await evalJs(`(() => {
  const sub = document.querySelectorAll('.fd-subcol')[2]
  return sub.querySelector('.fd-field-error')?.textContent ?? 'no error shown'
})()`))
await shot('calc-formula-error')
console.log('fix row formula:', await evalJs(`(() => {
  const sub = document.querySelectorAll('.fd-subcol')[2]
  const f = [...sub.querySelectorAll('input')].find(i => i.placeholder.includes('行内公式'))
  __t.setValue(f, 'quantity * price')
  return f.value
})()`))
await sleep(500)

// 4. 加金额字段：总金额 total = SUM(detail.amount)
console.log('add money field:', await evalJs(`(() => {
  const w = [...document.querySelectorAll('.fd-widget')].find(w => w.textContent.trim() === '金额')
  if (!w) return 'widget not found'
  __t.click(w)
  return 'clicked'
})()`))
await sleep(800)
console.log('config total:', await evalJs(`(() => {
  const t = __t.cfgItem('标题'); if (!t) return 'title not found'
  __t.setValue(t.querySelector('input'), '总金额')
  const k = __t.cfgItem('编码'); __t.setValue(k.querySelector('input'), 'total')
  const c = __t.cfgItem('计算公式'); if (!c) return 'compute item not found'
  __t.setValue(c.querySelector('input'), 'SUM(detail.amount)')
  return 'done'
})()`))
await sleep(500)

// 5. 加金额字段：含税金额 total_tax = total * 1.06（计算字段引用计算字段）
console.log('add money field2:', await evalJs(`(() => {
  const w = [...document.querySelectorAll('.fd-widget')].find(w => w.textContent.trim() === '金额')
  __t.click(w)
  return 'clicked'
})()`))
await sleep(800)
console.log('config total_tax:', await evalJs(`(() => {
  const t = __t.cfgItem('标题'); __t.setValue(t.querySelector('input'), '含税金额')
  const k = __t.cfgItem('编码'); __t.setValue(k.querySelector('input'), 'total_tax')
  const c = __t.cfgItem('计算公式'); __t.setValue(c.querySelector('input'), 'total * 1.06')
  return 'done'
})()`))
await sleep(500)
console.log('canvas compute tags:', await evalJs(`[...document.querySelectorAll('.fd-field-meta')].filter(m => m.textContent.includes('自动计算')).length`))
await shot('calc-designer')

// 6. 预览：添加两行，填数量/单价
console.log('open preview:', await evalJs(`(() => {
  __t.click(__t.btn(document.querySelector('.fd-toolbar-right'), '预览'))
  return 'clicked'
})()`))
await sleep(1500)
console.log('add 2 rows:', await evalJs(`(async () => {
  const modal = document.querySelector('.ant-modal')
  const addBtn = __t.btn(modal, '添加一行')
  if (!addBtn) return 'add row btn not found'
  __t.click(addBtn)
  await new Promise(r => setTimeout(r, 400))
  __t.click(__t.btn(modal, '添加一行'))
  await new Promise(r => setTimeout(r, 400))
  return modal.querySelectorAll('.ant-table-tbody tr.ant-table-row').length + ' rows'
})()`))
await sleep(400)
console.log('fill rows:', await evalJs(`(async () => {
  const modal = document.querySelector('.ant-modal')
  const rows = modal.querySelectorAll('.ant-table-tbody tr.ant-table-row')
  const fill = async (row, qty, price) => {
    const inputs = row.querySelectorAll('input')
    __t.setValue(inputs[0], qty)
    await new Promise(r => setTimeout(r, 300))
    __t.setValue(inputs[1], price)
    await new Promise(r => setTimeout(r, 300))
  }
  await fill(rows[0], '2', '5')
  await fill(rows[1], '1', '3')
  return 'filled'
})()`))
await sleep(800)
console.log('preview values:', await evalJs(`(() => {
  const modal = document.querySelector('.ant-modal')
  const rows = [...modal.querySelectorAll('.ant-table-tbody tr.ant-table-row')]
  const rowVals = rows.map(r => [...r.querySelectorAll('input')].map(i => i.value))
  const item = (label) => [...modal.querySelectorAll('.ant-form-item')].find(f => f.querySelector('label')?.textContent.includes(label))
  return JSON.stringify({
    rows: rowVals,
    total: item('总金额')?.querySelector('input')?.value,
    totalDisabled: item('总金额')?.querySelector('input')?.disabled,
    totalTax: item('含税金额')?.querySelector('input')?.value,
    extra: item('总金额')?.querySelector('.ant-form-item-extra')?.textContent,
  })
})()`))
await shot('calc-preview')

// 7. 收尾：关预览、返回列表，不保存
await evalJs(`(() => {
  const cancel = __t.btn(document.querySelector('.ant-modal-footer'), '关闭')
  if (cancel) __t.click(cancel)
  return 'closed'
})()`)
await sleep(500)
await evalJs(`(() => {
  const back = __t.btn(document.querySelector('.fd-toolbar-left'), '返回列表')
  if (back) __t.click(back)
  return 'back'
})()`)
console.log('done, no save')
process.exit(0)
