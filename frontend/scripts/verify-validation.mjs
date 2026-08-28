/**
 * CDP 端到端验证：表单校验层（validation）。
 * 流程：登录 admin → 表单中心 → 打开请假申请表设计器 → 加一个「单行文本」字段
 * → 配置面板「校验·格式」选「手机号」→ 预览：输错误格式提交 → 错误提示出现（截图）
 * → 改正确格式 → 提交后该字段错误消失（截图）。全程不保存，退出设计器。
 * 用法：MSYS2_ARG_CONV_EXCL='*' node verify-validation.mjs
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

// 2. 加单行文本字段（点击面板控件，自动选中）
console.log('add input:', await evalJs(`(() => {
  const w = [...document.querySelectorAll('.fd-widget')].find(w => w.textContent.includes('单行文本'))
  if (!w) return 'widget not found'
  __t.click(w)
  return 'clicked'
})()`))
await sleep(800)
// 改标题为「联系电话」，便于预览里定位
console.log('rename title:', await evalJs(`(() => {
  const panel = document.querySelector('.fd-config')
  const item = [...panel.querySelectorAll('.fd-form-item')].find(i => i.querySelector('.fd-form-label')?.textContent.trim() === '标题')
  if (!item) return 'title item not found'
  const input = item.querySelector('input')
  __t.setValue(input, '联系电话')
  return input.value
})()`))
await sleep(500)

// 3. 校验·格式 → 手机号
console.log('pick phone format:', await evalJs(`(async () => {
  const panel = document.querySelector('.fd-config')
  const item = [...panel.querySelectorAll('.fd-form-item')].find(i => i.querySelector('.fd-form-label')?.textContent.includes('校验 · 格式'))
  if (!item) return 'validation item not found'
  await __t.pick(item.querySelector('.ant-select'), '手机号')
  return 'picked'
})()`))
await sleep(600)
console.log('message placeholder:', await evalJs(`(() => {
  const panel = document.querySelector('.fd-config')
  const item = [...panel.querySelectorAll('.fd-form-item')].find(i => i.querySelector('.fd-form-label')?.textContent.includes('校验 · 格式'))
  const msgInput = [...item.querySelectorAll('input')].find(i => i.placeholder.includes('手机号'))
  return msgInput?.placeholder ?? 'default message input not found'
})()`))
await shot('v-validation-designer')

// 4. 预览：输错误格式提交 → 错误提示出现
console.log('open preview:', await evalJs(`(() => {
  __t.click(__t.btn(document.querySelector('.fd-toolbar-right'), '预览'))
  return 'clicked'
})()`))
await sleep(1500)
console.log('fill wrong phone + submit:', await evalJs(`(async () => {
  const item = [...document.querySelectorAll('.ant-modal .ant-form-item')].find(f => f.querySelector('label')?.textContent.includes('联系电话'))
  if (!item) return 'phone form item not found'
  __t.setValue(item.querySelector('input'), '123')
  await new Promise(r => setTimeout(r, 300))
  __t.click(__t.btn(document.querySelector('.ant-modal-footer'), '提交'))
  await new Promise(r => setTimeout(r, 900))
  const errs = [...document.querySelectorAll('.ant-modal .ant-form-item-explain-error')].map(e => e.textContent)
  return JSON.stringify(errs)
})()`))
await shot('v-validation-error')

// 5. 改正确格式 → 错误消失
console.log('fill correct phone + submit:', await evalJs(`(async () => {
  const item = [...document.querySelectorAll('.ant-modal .ant-form-item')].find(f => f.querySelector('label')?.textContent.includes('联系电话'))
  __t.setValue(item.querySelector('input'), '13812345678')
  await new Promise(r => setTimeout(r, 300))
  __t.click(__t.btn(document.querySelector('.ant-modal-footer'), '提交'))
  await new Promise(r => setTimeout(r, 900))
  const errs = [...document.querySelectorAll('.ant-modal .ant-form-item-explain-error')].map(e => e.textContent)
  const phoneErr = item.querySelector('.ant-form-item-explain-error')?.textContent ?? null
  const modalClosed = !document.querySelector('.ant-modal:not([style*="display"]) .ant-modal-content') || !document.querySelector('.ant-modal-wrap:not([style*="display: none"])')
  return JSON.stringify({ phoneErr, errs, modalOpen: !!document.querySelector('.ant-modal-wrap') && getComputedStyle(document.querySelector('.ant-modal-wrap')).display !== 'none' })
})()`))
await shot('v-validation-pass')

// 6. 收尾：关预览（若还开着）、返回列表，不保存
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
