/**
 * 计算公式：手写递归下降表达式解析器（不引入第三方依赖）。
 *
 * 语法：
 *   expr   := term (('+'|'-') term)*
 *   term   := unary (('*'|'/'|'%') unary)*
 *   unary  := '-' unary | factor
 *   factor := 数字字面量 | 标识符 | 标识符 '.' 标识符 | 函数名 '(' expr ')' | '(' expr ')'
 *
 * 函数：SUM / AVG / MIN / MAX / COUNT（大小写不敏感），参数必须是点路径「子表key.列key」。
 * 求值上下文：
 *   - 顶层字段公式：scope = 表单 values，标识符直接取 values[key]；
 *   - 行内公式：scope = 当前行对象，标识符先查行、再查顶层 values；
 *   - 点路径 a.b 永远查顶层 values：values[a] 应为行对象数组，pluck 每行的 b 列聚合。
 * 容错：任何解析/求值错误、除以零、引用不存在一律返回 null（渲染为空，不炸表单）；
 * 聚合遇非数组/取不到按空数组处理（SUM→0，COUNT→0，AVG/MIN/MAX→null）。
 * 防循环：求值带 visited 集合，计算字段互相引用成环时返回 null。
 */

/* ---------------- 词法分析 ---------------- */

type Token =
  | { t: 'num'; v: number }
  | { t: 'ident'; v: string }
  | { t: 'op'; v: string } // + - * / % ( ) .

const OPS = '+-*/%().'

/** 词法分析：跳过空白；数字、标识符、运算符之外的字符直接报错 */
function tokenize(src: string): Token[] {
  const tokens: Token[] = []
  let i = 0
  while (i < src.length) {
    const ch = src[i]
    if (ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r') {
      i++
      continue
    }
    // 数字字面量：支持 1.06、.5；「1.2.3」等多小数点视为格式错误
    if (/[0-9]/.test(ch) || (ch === '.' && /[0-9]/.test(src[i + 1] ?? ''))) {
      let j = i
      while (j < src.length && /[0-9.]/.test(src[j])) j++
      const text = src.slice(i, j)
      const v = Number(text)
      if (Number.isNaN(v)) throw new Error(`数字「${text}」格式有误`)
      tokens.push({ t: 'num', v })
      i = j
      continue
    }
    if (/[A-Za-z_]/.test(ch)) {
      let j = i
      while (j < src.length && /[A-Za-z0-9_]/.test(src[j])) j++
      tokens.push({ t: 'ident', v: src.slice(i, j) })
      i = j
      continue
    }
    if (OPS.includes(ch)) {
      tokens.push({ t: 'op', v: ch })
      i++
      continue
    }
    throw new Error(`无法识别的字符「${ch}」`)
  }
  return tokens
}

/* ---------------- 语法分析（递归下降） ---------------- */

type Ast =
  | { k: 'num'; v: number }
  | { k: 'ref'; name: string } // 标识符引用（字段编码 / 行内列 key）
  | { k: 'path'; table: string; col: string } // 点路径 子表.列
  | { k: 'call'; fn: string; arg: Ast } // 聚合函数调用
  | { k: 'neg'; e: Ast } // 一元负号
  | { k: 'bin'; op: string; l: Ast; r: Ast }

/** 聚合函数白名单（统一转大写比较） */
const AGG_FUNCS = ['SUM', 'AVG', 'MIN', 'MAX', 'COUNT']

class Parser {
  pos = 0

  constructor(private tokens: Token[]) {}

  private peek(): Token | undefined {
    return this.tokens[this.pos]
  }

  /** 期望一个运算符 token，否则报错 */
  private expectOp(op: string): void {
    const tok = this.peek()
    if (!tok || tok.t !== 'op' || tok.v !== op) {
      throw new Error(op === ')' ? '缺少右括号「)」' : `此处应为「${op}」`)
    }
    this.pos++
  }

  parseExpr(): Ast {
    let left = this.parseTerm()
    for (;;) {
      const tok = this.peek()
      if (tok?.t === 'op' && (tok.v === '+' || tok.v === '-')) {
        this.pos++
        left = { k: 'bin', op: tok.v, l: left, r: this.parseTerm() }
      } else {
        return left
      }
    }
  }

  private parseTerm(): Ast {
    let left = this.parseUnary()
    for (;;) {
      const tok = this.peek()
      if (tok?.t === 'op' && (tok.v === '*' || tok.v === '/' || tok.v === '%')) {
        this.pos++
        left = { k: 'bin', op: tok.v, l: left, r: this.parseUnary() }
      } else {
        return left
      }
    }
  }

  private parseUnary(): Ast {
    const tok = this.peek()
    if (tok?.t === 'op' && tok.v === '-') {
      this.pos++
      return { k: 'neg', e: this.parseUnary() }
    }
    return this.parseFactor()
  }

  private parseFactor(): Ast {
    const tok = this.peek()
    if (!tok) throw new Error('公式不完整')
    if (tok.t === 'num') {
      this.pos++
      return { k: 'num', v: tok.v }
    }
    if (tok.t === 'op' && tok.v === '(') {
      this.pos++
      const e = this.parseExpr()
      this.expectOp(')')
      return e
    }
    if (tok.t === 'ident') {
      this.pos++
      const name = tok.v
      const next = this.peek()
      // 点路径：标识符 '.' 标识符
      if (next?.t === 'op' && next.v === '.') {
        this.pos++
        const col = this.peek()
        if (col?.t !== 'ident') throw new Error('「.」后应为列编码')
        this.pos++
        return { k: 'path', table: name, col: col.v }
      }
      // 函数调用：函数名 '(' expr ')'
      if (next?.t === 'op' && next.v === '(') {
        const fn = name.toUpperCase()
        if (!AGG_FUNCS.includes(fn)) {
          throw new Error(`未知函数「${name}」（支持 SUM / AVG / MIN / MAX / COUNT）`)
        }
        this.pos++
        const arg = this.parseExpr()
        this.expectOp(')')
        if (arg.k !== 'path') {
          throw new Error(`函数 ${fn} 的参数必须是「子表.列」，如 SUM(detail.amount)`)
        }
        return { k: 'call', fn, arg }
      }
      return { k: 'ref', name }
    }
    throw new Error(`「${tok.t === 'op' ? tok.v : ''}」处应为数字或字段编码`)
  }
}

/** 解析公式为 AST；语法错误抛中文文案的 Error */
function parse(formula: string): Ast {
  const tokens = tokenize(formula)
  if (!tokens.length) throw new Error('公式不能为空')
  const p = new Parser(tokens)
  const ast = p.parseExpr()
  if (p.pos < tokens.length) throw new Error('公式末尾有多余的内容')
  return ast
}

/* ---------------- 求值 ---------------- */

/** 值转数字：数字直接用，数字字符串解析，其余（dayjs 对象 / 文本 / 空）为 null */
function toNum(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number(v)
    return Number.isFinite(n) ? n : null
  }
  return null
}

interface EvalCtx {
  /** 行内公式时为当前行对象；顶层公式时与 top 相同 */
  scope: Record<string, unknown>
  /** 顶层表单 values（点路径只查这里） */
  top: Record<string, unknown>
  /** 其他计算字段的公式表（key → 公式），值缺失时递归求值用 */
  formulas?: Record<string, string>
  /** 防循环：正在求值链上的字段 key */
  visited: Set<string>
}

/** 聚合：SUM/AVG/MIN/MAX 只看数值项（空集 SUM→0，其余→null）；COUNT 统计非空行数 */
function aggregate(fn: string, list: unknown[]): number | null {
  if (fn === 'COUNT') return list.length
  const nums = list.map(toNum).filter((n): n is number => n !== null)
  switch (fn) {
    case 'SUM':
      return nums.reduce((a, b) => a + b, 0)
    case 'AVG':
      return nums.length ? nums.reduce((a, b) => a + b, 0) / nums.length : null
    case 'MIN':
      return nums.length ? Math.min(...nums) : null
    case 'MAX':
      return nums.length ? Math.max(...nums) : null
    default:
      return null
  }
}

/** AST 求值；点路径节点返回数组（供聚合函数消费），标量语境下为 null */
function evalAst(node: Ast, ctx: EvalCtx): number | unknown[] | null {
  switch (node.k) {
    case 'num':
      return node.v
    case 'ref': {
      // 先查行 scope，再查顶层 values
      const raw = node.name in ctx.scope ? ctx.scope[node.name] : ctx.top[node.name]
      const n = toNum(raw)
      if (n !== null) return n
      // 值缺失且本身是计算字段：递归求值；visited 命中说明成环，返回 null
      const f = ctx.formulas?.[node.name]
      if (f && !ctx.visited.has(node.name)) {
        ctx.visited.add(node.name)
        return evalFormula(f, ctx.scope, ctx.top, ctx.formulas, ctx.visited)
      }
      return null
    }
    case 'path': {
      const rows = ctx.top[node.table]
      if (!Array.isArray(rows)) return []
      return rows
        .map((r) => (r && typeof r === 'object' ? (r as Record<string, unknown>)[node.col] : undefined))
        .filter((v) => v !== undefined && v !== null && v !== '')
    }
    case 'call': {
      const arg = evalAst(node.arg, ctx)
      return Array.isArray(arg) ? aggregate(node.fn, arg) : null
    }
    case 'neg': {
      const v = evalAst(node.e, ctx)
      return typeof v === 'number' ? -v : null
    }
    case 'bin': {
      const l = evalAst(node.l, ctx)
      const r = evalAst(node.r, ctx)
      if (typeof l !== 'number' || typeof r !== 'number') return null
      // 除以零（含取模）返回 null
      if ((node.op === '/' || node.op === '%') && r === 0) return null
      switch (node.op) {
        case '+':
          return l + r
        case '-':
          return l - r
        case '*':
          return l * r
        case '/':
          return l / r
        case '%':
          return l % r
        default:
          return null
      }
    }
  }
}

/* ---------------- 对外接口 ---------------- */

/**
 * 公式求值：返回数值；解析/求值失败、引用缺失、除以零、循环引用均返回 null。
 * @param formula 公式文本
 * @param scope 标识符优先查找的作用域（行内公式传当前行对象；顶层公式传表单 values）
 * @param topValues 顶层表单 values（点路径永远查这里）
 * @param formulas 其他计算字段的公式表（可选），用于值缺失时递归求值
 * @param visited 防循环集合，调用方传入公式所属字段的 key 作为初始值
 */
export function evalFormula(
  formula: string,
  scope: Record<string, unknown>,
  topValues: Record<string, unknown>,
  formulas?: Record<string, string>,
  visited: Set<string> = new Set(),
): number | null {
  try {
    const v = evalAst(parse(formula), { scope, top: topValues, formulas, visited })
    return typeof v === 'number' && Number.isFinite(v) ? v : null
  } catch {
    return null
  }
}

/** 仅校验语法：返回中文错误文案，null 表示合法（空公式视为合法 = 未配置）；不校验字段是否存在 */
export function validateFormula(formula: string): string | null {
  if (!formula?.trim()) return null
  try {
    parse(formula)
    return null
  } catch (e) {
    return e instanceof Error ? e.message : '公式无效'
  }
}
