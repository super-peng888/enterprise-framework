/**
 * CDP 补充验证：数字系 min/max 已有真正的 rules validator（fiber 探针已确认挂载）。
 * 本脚本验证其真实触发路径：默认值 10 + max 5（初始值不经 InputNumber blur 收敛，
 * 是最小侵入的可复现越界路径）→ 预览直接提交 → 出现「数字不能大于 5」。不保存。
 * 用法：MSYS2_ARG_CONV_EXCL='*' node verify-validation-numrange.mjs
 */
import { writeFileSync } from 'node:fs'
const CDP = 'http://127.0.0.1:9223'
const BASE = 'http://localhost:5175'
const API = 'http://localhost:8090'
const OUT = new URL('./out/', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')
const token = (await (await fetch(`${API}/api/system/auth/login`, {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:'admin',password:'123456'})})).json())?.data?.token
const list = await (await fetch(`${CDP}/json/list`)).json()
let target = list.filter((t) => t.type === 'page').pop()
try { const c = await fetch(`${CDP}/json/new?about:blank`, { method: 'PUT' }); if (c.ok) target = await c.json() } catch {}
const ws = new WebSocket(target.webSocketDebuggerUrl)
let seq = 0; const pending = new Map()
const send = (m, p = {}) => new Promise((res) => { const id = ++seq; pending.set(id, res); ws.send(JSON.stringify({ id, method: m, params: p })) })
ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m.result ?? m.error); pending.delete(m.id) } }
await new Promise((r) => (ws.onopen = r))
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const evalJs = async (expression) => { const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }); if (r?.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails).slice(0,400)); return r?.result?.value }
const shot = async (name) => { const s = await send('Page.captureScreenshot', { format: 'png' }); writeFileSync(`${OUT}${name}.png`, Buffer.from(s.data, 'base64')); console.log('saved', name) }
await send('Page.enable')
await send('Emulation.setDeviceMetricsOverride', { width: 1680, height: 1400, deviceScaleFactor: 1, mobile: false })
const seed = JSON.stringify(JSON.stringify({ state: { token, userName: 'admin', realName: 'admin' }, version: 0 }))
await send('Page.addScriptToEvaluateOnNewDocument', { source: `try{localStorage.setItem('ef-auth', ${seed});}catch(e){}
window.__t = {
  setValue(el, v) { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, v); el.dispatchEvent(new Event('input', { bubbles: true })) },
  click(el) { el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true })) },
  btn(scope, text) { return [...(scope ?? document).querySelectorAll('button')].find((b) => b.textContent.replace(/\\s/g, '').includes(text)) },
}` })
await send('Page.navigate', { url: `${BASE}/approval/forms` })
await sleep(5000)
console.log('open designer:', await evalJs(`(() => { const row = [...document.querySelectorAll('.ant-table-row')].find(r => r.textContent.includes('请假申请')); if(!row) return 'row not found'; __t.click(row.querySelector('td')); return 'clicked' })()`))
await sleep(2000)
console.log('add number:', await evalJs(`(() => { const w = [...document.querySelectorAll('.fd-widget')].find(w => w.textContent.trim() === '数字'); __t.click(w); return 'clicked' })()`))
await sleep(800)
console.log('set minmax + default:', await evalJs(`(async () => {
  const panel = document.querySelector('.fd-config')
  const mm = [...panel.querySelectorAll('.fd-form-item')].find(i => i.querySelector('.fd-form-label')?.textContent.includes('最小 / 最大值'))
  const [minEl, maxEl] = mm.querySelectorAll('input')
  __t.setValue(minEl, '1'); minEl.dispatchEvent(new Event('blur', { bubbles: true }))
  await new Promise(r => setTimeout(r, 300))
  __t.setValue(maxEl, '5'); maxEl.dispatchEvent(new Event('blur', { bubbles: true }))
  await new Promise(r => setTimeout(r, 300))
  const dv = [...panel.querySelectorAll('.fd-form-item')].find(i => i.querySelector('.fd-form-label')?.textContent.trim() === '默认值')
  const dvEl = dv.querySelector('input')
  __t.setValue(dvEl, '10'); dvEl.dispatchEvent(new Event('blur', { bubbles: true }))
  await new Promise(r => setTimeout(r, 300))
  return mm.querySelectorAll('input')[0].value + '/' + mm.querySelectorAll('input')[1].value + ' dv=' + dv.querySelector('input').value
})()`))
await sleep(500)
console.log('open preview:', await evalJs(`(() => { const b = __t.btn(document.querySelector('.fd-toolbar-right'), '预览'); if (!b) return 'btn not found'; __t.click(b); return 'clicked' })()`))
await sleep(2500)
console.log('submit with default 10:', await evalJs(`(async () => {
  const ok = __t.btn(document.querySelector('.ant-modal-footer'), '提交')
  if (!ok) return 'submit btn not found, footer=' + JSON.stringify([...document.querySelectorAll('.ant-modal-footer button')].map(b => b.textContent))
  __t.click(ok)
  await new Promise(r => setTimeout(r, 900))
  return JSON.stringify([...document.querySelectorAll('.ant-modal .ant-form-item-explain-error')].map(e => e.textContent))
})()`))
await shot('v-numrange-error')
await evalJs(`(() => {
  const cancel = __t.btn(document.querySelector('.ant-modal-footer'), '关闭')
  if (cancel) __t.click(cancel)
  const back = __t.btn(document.querySelector('.fd-toolbar-left'), '返回列表')
  if (back) __t.click(back)
  return 'done'
})()`)
console.log('done, no save')
process.exit(0)
