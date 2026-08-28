/** 读取流程设计器画布中所有节点和边的连接关系 */
const loginRes = await fetch('http://localhost:8090/api/system/auth/login', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ username: 'zhangsan', password: '123456' }),
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
const seed = JSON.stringify(JSON.stringify({ state: { token, userName: 'zhangsan', realName: '张三' }, version: 0 }))
await send('Page.addScriptToEvaluateOnNewDocument', {
  source: `try{localStorage.setItem('ef-auth', ${seed})}catch(e){}`,
})
await send('Page.navigate', { url: 'http://localhost:5175/approval/designer' })
await new Promise((r) => setTimeout(r, 12000))

const evalJs = async (expression) =>
  (await send('Runtime.evaluate', { expression, returnByValue: true }))?.result?.value

// 从 React Flow 内部 store 读 nodes/edges（xyflow 把 store 挂在 DOM 节点上不可达，
// 改为读窗口里 React 渲染的边 DOM + 节点 DOM 对照）
const info = await evalJs(`(() => {
  const nodes = [...document.querySelectorAll('.react-flow__node')].map(n => ({
    id: n.getAttribute('data-id'),
    type: n.className.match(/react-flow__node-(\\w+)/)?.[1],
    text: (n.textContent || '').slice(0, 30).replace(/\\s+/g, ' '),
  }))
  const edges = [...document.querySelectorAll('.react-flow__edge')].map(e => {
    const id = e.getAttribute('data-id') || ''
    return id
  })
  return JSON.stringify({ nodes, edges }, null, 1)
})()`)
console.log(info)
process.exit(0)
