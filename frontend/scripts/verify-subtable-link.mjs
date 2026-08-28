/**
 * CDP 端到端验证：明细子表 + 字段联动（visibleWhen）。
 * 流程：登录 admin → 表单中心 → 打开请假申请表设计器 → 加明细子表（明细名称 input + 金额 money）
 * → 给「事由」配 visibleWhen「请假类型 = 年假」→ 预览：加两行填值截图 → 校验报错截图
 * → 切换请假类型看事由显隐两张截图。全程不保存，退出设计器。
 * 用法：MSYS2_ARG_CONV_EXCL='*' node verify-subtable-link.mjs
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

// 页面内工具函数（原生 setter 设值 + antd Select 选择）
await send('Page.addScriptToEvaluateOnNewDocument', {
  source: `window.__t = {
    setValue(el, v) {
      const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype
      Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, v)
      el.dispatchEvent(new Event('input', { bubbles: true }))
    },
    click(el) { el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true })) },
    // antd 对两个汉字的纯文本按钮自动插空格（如「提 交」），匹配前先归一化空白
    // 注意：此处 \\s 是为了让注入到页面的源码拿到正则 \s（模板字符串里 \\s → \s）
    btn(scope, text) {
      return [...(scope ?? document).querySelectorAll('button')].find(
        (b) => b.textContent.replace(/\\s/g, '').includes(text),
      )
    },
    async pick(selectEl, text) {
      const trigger = selectEl.querySelector('.ant-select-selector') ?? selectEl.querySelector('.ant-select-content') ?? selectEl
      trigger.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }))
      await new Promise(r => setTimeout(r, 400))
      const opt = [...document.querySelectorAll('.ant-select-dropdown:not(.ant-select-dropdown-hidden) .ant-select-item-option')]
        .find(o => o.textContent.includes(text))
      if (!opt) throw new Error('option not found: ' + text)
      this.click(opt)
      await new Promise(r => setTimeout(r, 300))
    },
    hasReason() {
      return [...document.querySelectorAll('.ant-modal label')].some(l => l.textContent.includes('事由'))
    },
  }`,
})

await send('Page.navigate', { url: `${BASE}/approval/forms` })
await sleep(5000)
console.log('url =', await evalJs('location.href'))

// 1. 打开请假申请表设计器（点击行）
console.log('open designer:', await evalJs(`(() => {
  const row = [...document.querySelectorAll('.ant-table-row')].find(r => r.textContent.includes('请假申请'))
  if (!row) return 'row not found'
  __t.click(row.querySelector('td'))
  return 'clicked'
})()`))
await sleep(2000)
console.log('designer ready:', await evalJs(`!!document.querySelector('.fd-canvas-grid')`))

// 2. 加明细子表（点击面板控件，默认两列：明细 input + 金额 money）
console.log('add subTable:', await evalJs(`(() => {
  const w = [...document.querySelectorAll('.fd-widget')].find(w => w.textContent.includes('明细子表'))
  if (!w) return 'widget not found'
  __t.click(w)
  return 'clicked'
})()`))
await sleep(800)
// 第一列标题改为「明细名称」
console.log('rename col1:', await evalJs(`(() => {
  const card = document.querySelector('.fd-subcol')
  if (!card) return 'subcol editor not found'
  const input = card.querySelector('.fd-subcol-row input')
  __t.setValue(input, '明细名称')
  return card.querySelector('.fd-subcol-row input').value
})()`))
await sleep(500)
console.log('col count:', await evalJs(`document.querySelectorAll('.fd-subcol').length`))

// 3. 选中「事由」字段，配 visibleWhen：请假类型 = 年假
console.log('select reason:', await evalJs(`(() => {
  const card = [...document.querySelectorAll('.fd-field-card')].find(c => c.querySelector('.fd-field-title')?.textContent.includes('事由'))
  if (!card) return 'reason card not found'
  __t.click(card)
  return 'clicked'
})()`))
await sleep(800)
console.log('add rule:', await evalJs(`(() => {
  const block = document.querySelector('.fd-link-block')
  if (!block) return 'link block not found'
  __t.click(__t.btn(block, '添加规则'))
  return 'clicked'
})()`))
await sleep(600)
console.log('pick field:', await evalJs(`(async () => {
  const row = document.querySelector('.fd-link-rule')
  if (!row) return 'rule row not found'
  await __t.pick(row.querySelectorAll('.ant-select')[0], '请假类型')
  return 'picked'
})()`))
console.log('set value:', await evalJs(`(() => {
  const row = document.querySelector('.fd-link-rule')
  const input = row.querySelector('input.ant-input')
  __t.setValue(input, '年假')
  return input.value
})()`))
await sleep(500)
await shot('v-designer-config')

// 4. 预览：子表加两行填值
console.log('open preview:', await evalJs(`(() => {
  __t.click(__t.btn(document.querySelector('.fd-toolbar-right'), '预览'))
  return 'clicked'
})()`))
await sleep(1500)
console.log('subtable in preview:', await evalJs(`!!document.querySelector('.schema-form-subtable')`))
console.log('reason hidden initially:', await evalJs(`!__t.hasReason()`))

await evalJs(`(async () => {
  const addBtn = () => __t.btn(document.querySelector('.schema-form-subtable'), '添加一行')
  __t.click(addBtn()); await new Promise(r => setTimeout(r, 300))
  __t.click(addBtn()); await new Promise(r => setTimeout(r, 300))
  const rows = document.querySelectorAll('.schema-form-subtable tbody tr.ant-table-row')
  const fill = (tr, name, amount) => {
    const inputs = tr.querySelectorAll('input')
    __t.setValue(inputs[0], name)
    __t.setValue(inputs[1], amount)
  }
  fill(rows[0], '住宿费', '1200')
  fill(rows[1], '交通费', '300')
  return 'rows=' + rows.length
})()`).then((r) => console.log('fill rows:', r))
await sleep(500)
await shot('v-subtable-filled')

// 5. 联动：请假类型 = 年假 → 事由显示
console.log('pick 年假:', await evalJs(`(async () => {
  const item = [...document.querySelectorAll('.ant-modal .ant-form-item')].find(f => f.querySelector('label')?.textContent.includes('请假类型'))
  await __t.pick(item.querySelector('.ant-select'), '年假')
  return 'picked'
})()`))
await sleep(600)
console.log('reason visible after 年假:', await evalJs(`__t.hasReason()`))
await shot('v-link-visible')

// 6. 子表必填校验：清空第 2 行明细名称后提交 → 行号定位错误
console.log('validate:', await evalJs(`(async () => {
  const rows = document.querySelectorAll('.schema-form-subtable tbody tr.ant-table-row')
  __t.setValue(rows[1].querySelectorAll('input')[0], '')
  await new Promise(r => setTimeout(r, 300))
  const footer = document.querySelector('.ant-modal-footer')
  const ok = __t.btn(footer, '提交')
  if (!ok) return JSON.stringify({
    modals: document.querySelectorAll('.ant-modal').length,
    footer: !!footer,
    rows: rows.length,
    btns: [...(footer ?? document).querySelectorAll('button')].map((b) => [...b.textContent].map((c) => c.charCodeAt(0))),
    btnSrc: String(__t.btn).slice(0, 120),
  })
  __t.click(ok)
  await new Promise(r => setTimeout(r, 800))
  const errs = [...document.querySelectorAll('.ant-form-item-explain-error')].map(e => e.textContent)
  return JSON.stringify(errs)
})()`))
await shot('v-subtable-validation')

// 7. 联动：请假类型 = 事假 → 事由隐藏（并补回第 2 行值）
console.log('pick 事假:', await evalJs(`(async () => {
  const rows = document.querySelectorAll('.schema-form-subtable tbody tr.ant-table-row')
  __t.setValue(rows[1].querySelectorAll('input')[0], '交通费')
  const item = [...document.querySelectorAll('.ant-modal .ant-form-item')].find(f => f.querySelector('label')?.textContent.includes('请假类型'))
  await __t.pick(item.querySelector('.ant-select'), '事假')
  return 'picked'
})()`))
await sleep(600)
console.log('reason hidden after 事假:', await evalJs(`!__t.hasReason()`))
await shot('v-link-hidden')

// 8. 收尾：关预览、返回列表，不保存（演示种子不动）
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
