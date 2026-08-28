import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Tag } from 'antd'
import {
  ArrowRight,
  CalendarClock,
  ClipboardList,
  FileCheck,
  ListChecks,
  Send,
  ShieldCheck,
  UserCog,
  Users,
  Workflow,
} from 'lucide-react'
import { fetchRoles, fetchUsers } from '@/api/system'
import { fetchInstances } from '@/api/approval'
import { useAuthStore } from '@/stores/auth'
import type { InstanceItem } from '@/mocks/approval'
import './Dashboard.css'

/* ---------------- 类型 ---------------- */

interface StatCard {
  title: string
  value: string
  sub: string
  icon: React.ReactNode
  /** pastel chip 配色（--chip-* 变量，三主题各一套） */
  chip: 'amber' | 'blue' | 'pink' | 'violet'
}

interface QuickLink {
  to: string
  icon: React.ReactNode
  color: string
  bg: string
  title: string
  desc: string
}

/** EF Admin 能力清单 */
const CAPABILITIES: { label: string; ready: boolean }[] = [
  { label: 'RBAC 权限体系（用户 / 角色 / 菜单）', ready: true },
  { label: '审批引擎（待办 / 已办 / 抄送 / 加签 / 回退）', ready: true },
  { label: '表单设计器（JSON Schema 驱动）', ready: true },
  { label: '流程设计器（审批人 / 条件分支 / 抄送）', ready: true },
  { label: '审计日志', ready: true },
  { label: '数据权限', ready: false },
]

const QUICK_LINKS: QuickLink[] = [
  {
    to: '/approval/launch',
    icon: <Send size={18} />,
    color: 'var(--color-primary)',
    bg: 'var(--color-primary-light)',
    title: '发起审批',
    desc: '选择审批模板，填写表单一键发起',
  },
  {
    to: '/approval/designer',
    icon: <Workflow size={18} />,
    color: 'var(--color-warning)',
    bg: 'var(--warning-light)',
    title: '流程设计',
    desc: '卡片式编排审批链路与条件分支',
  },
  {
    to: '/system/users',
    icon: <UserCog size={18} />,
    color: 'var(--color-success)',
    bg: 'var(--success-light)',
    title: '用户管理',
    desc: '维护组织用户与角色分配',
  },
]

/* ---------------- 页面 ---------------- */

export default function Dashboard() {
  const navigate = useNavigate()
  // 审批待办按真实姓名过滤（与网关注入下游的 X-User-Name 口径一致）
  const userName = useAuthStore((s) => s.realName || s.userName) || '张三'

  const [stats, setStats] = useState<StatCard[]>([])
  const [todoInstances, setTodoInstances] = useState<InstanceItem[]>([])

  useEffect(() => {
    // 统计卡：用户总数 / 角色数 / 待办审批数 / 本月新审批实例数
    Promise.all([
      fetchUsers({ current: 1, pageSize: 1 }),
      fetchRoles({ current: 1, pageSize: 1 }),
      fetchInstances('todo', userName),
      fetchInstances('mine', userName),
    ]).then(([users, roles, todo, mine]) => {
      const monthPrefix = new Date().toISOString().slice(0, 7) // YYYY-MM
      const monthCount = mine.data.filter((i) => i.createdAt.slice(0, 7) === monthPrefix).length
      setStats([
        {
          title: '用户总数',
          value: String(users.total),
          sub: '系统管理 · 用户管理',
          icon: <Users size={18} />,
          chip: 'blue',
        },
        {
          title: '角色数',
          value: String(roles.total),
          sub: '系统管理 · 角色权限',
          icon: <ShieldCheck size={18} />,
          chip: 'violet',
        },
        {
          title: '待办审批数',
          value: String(todo.total),
          sub: '分配给我的待处理任务',
          icon: <ListChecks size={18} />,
          chip: 'amber',
        },
        {
          title: '本月新审批实例',
          value: String(monthCount),
          sub: '我本月发起的审批',
          icon: <CalendarClock size={18} />,
          chip: 'pink',
        },
      ])
      setTodoInstances(todo.data.slice(0, 5))
    })
  }, [userName])

  return (
    <div className="dashboard">
      {/* 统计卡：彩色 pastel chip 图标（Bretford 风） */}
      <div className="stat-grid">
        {stats.map((s) => (
          <div key={s.title} className="core-card stat-card">
            <div className="stat-title">
              {s.title}
              <span className={`stat-chip stat-chip--${s.chip}`}>{s.icon}</span>
            </div>
            <div className="stat-value">{s.value}</div>
            <div className="stat-sub">
              <span className="stat-trend-flat">{s.sub}</span>
            </div>
          </div>
        ))}
      </div>

      <div className="dashboard-grid">
        {/* 待办审批 */}
        <div className="core-card dashboard-col-todo">
          <div className="card-head">
            <h3 className="core-card-title" style={{ margin: 0 }}>
              <FileCheck size={16} className="card-head-icon" />
              待办审批
            </h3>
            <Link to="/approval/center" className="card-head-link">
              去审批中心 →
            </Link>
          </div>
          <div className="todo-list">
            {todoInstances.length === 0 && (
              <div className="todo-empty">暂无待办审批，去「发起审批」创建一条试试</div>
            )}
            {todoInstances.map((i) => (
              <div
                key={i.id}
                className="todo-item todo-item--clickable"
                onClick={() => navigate('/approval/center')}
              >
                <span className="todo-icon todo-icon--approval">
                  <FileCheck size={15} />
                </span>
                <span className="todo-title">
                  <span className="todo-title-main">{i.title}</span>
                  <span className="todo-title-sub">
                    {i.initiator} 发起 · 当前节点 {i.currentNode}
                  </span>
                </span>
                <Tag color="orange" className="todo-tag">
                  {i.status}
                </Tag>
              </div>
            ))}
          </div>
        </div>

        {/* 快捷入口 */}
        <div className="core-card dashboard-col-quick">
          <h3 className="core-card-title">
            <ClipboardList size={16} className="card-head-icon" />
            快捷入口
          </h3>
          <div className="quick-list">
            {QUICK_LINKS.map((q) => (
              <Link key={q.to} to={q.to} className="quick-item">
                <span className="todo-icon" style={{ color: q.color, background: q.bg }}>
                  {q.icon}
                </span>
                <span className="quick-info">
                  <span className="quick-title">{q.title}</span>
                  <span className="quick-desc">{q.desc}</span>
                </span>
                <ArrowRight size={15} className="quick-arrow" />
              </Link>
            ))}
          </div>
        </div>

        {/* 框架介绍 */}
        <div className="core-card dashboard-col-intro">
          <h3 className="core-card-title">
            <ShieldCheck size={16} className="card-head-icon" />
            EF Admin 企业级管理框架
          </h3>
          <p className="intro-desc">
            开箱即用的企业后台基座：明暗双主题、schema 驱动的表格与表单、审批引擎与 RBAC
            权限体系内建，业务方只需关注自己的领域页面。
          </p>
          <div className="intro-caps">
            {CAPABILITIES.map((c) => (
              <span key={c.label} className={`intro-cap ${c.ready ? '' : 'intro-cap--planned'}`}>
                {c.label}
                {!c.ready && <em>（规划中）</em>}
              </span>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
