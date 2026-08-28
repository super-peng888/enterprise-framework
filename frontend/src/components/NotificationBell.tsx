import { useCallback, useEffect, useState } from 'react'
import { Badge, Button, Empty, Popover, Spin } from 'antd'
import { Bell, CircleAlert, FileCheck, Info, Send } from 'lucide-react'
import {
  fetchNotifications,
  fetchUnreadCount,
  markAllNotificationsRead,
  markNotificationRead,
} from '@/api/system'
import { useAuthStore } from '@/stores/auth'
import type { NotificationItem, NotificationType } from '@/mocks/system'
import './NotificationBell.css'

const TYPE_META: Record<NotificationType, { icon: React.ReactNode; color: string; bg: string }> = {
  审批: { icon: <FileCheck size={14} />, color: 'var(--color-primary)', bg: 'var(--color-primary-light)' },
  逾期: { icon: <CircleAlert size={14} />, color: 'var(--color-danger)', bg: 'var(--danger-light)' },
  系统: { icon: <Info size={14} />, color: 'var(--text-secondary)', bg: 'var(--neutral-light)' },
  // 审批抄送通知（后端 type='CC'）：青色 Send 图标，与进度链抄送徽标同色
  CC: { icon: <Send size={14} />, color: 'var(--color-info)', bg: 'var(--info-light)' },
}

/** 相对时间 */
function relativeTime(createdAt: string): string {
  const time = new Date(createdAt.replace(/\//g, '-')).getTime()
  if (Number.isNaN(time)) return createdAt
  const diff = Date.now() - time
  const minutes = Math.floor(diff / 60000)
  if (minutes < 1) return '刚刚'
  if (minutes < 60) return `${minutes} 分钟前`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours} 小时前`
  return `${Math.floor(hours / 24)} 天前`
}

const POLL_INTERVAL = 30_000
const DEFAULT_SIZE = 5
const FULL_SIZE = 50

/** Header 通知铃铛：未读红点轮询 + Popover 通知面板 */
export default function NotificationBell() {
  // 通知按真实姓名过滤（与网关注入下游的 X-User-Name 口径一致）
  const userName = useAuthStore((s) => s.realName || s.userName) || '张三'
  const [open, setOpen] = useState(false)
  const [unread, setUnread] = useState(0)
  const [list, setList] = useState<NotificationItem[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(false)
  const [showAll, setShowAll] = useState(false)

  const refreshCount = useCallback(() => {
    fetchUnreadCount(userName).then(setUnread)
  }, [userName])

  // 30s 轮询未读数
  useEffect(() => {
    refreshCount()
    const timer = setInterval(refreshCount, POLL_INTERVAL)
    return () => clearInterval(timer)
  }, [refreshCount])

  const loadList = useCallback(
    (size: number) => {
      setLoading(true)
      fetchNotifications({ userName, page: 1, size })
        .then((res) => {
          setList(res.data)
          setTotal(res.total)
        })
        .finally(() => setLoading(false))
    },
    [userName],
  )

  // 打开面板时刷新列表与未读数
  const handleOpenChange = (next: boolean) => {
    setOpen(next)
    if (next) {
      setShowAll(false)
      loadList(DEFAULT_SIZE)
      refreshCount()
    }
  }

  const handleRead = async (n: NotificationItem) => {
    if (n.read) return
    await markNotificationRead(n.id)
    setList((prev) => prev.map((item) => (item.id === n.id ? { ...item, read: true } : item)))
    setUnread((c) => Math.max(0, c - 1))
  }

  const handleReadAll = async () => {
    await markAllNotificationsRead(userName)
    setList((prev) => prev.map((item) => ({ ...item, read: true })))
    setUnread(0)
  }

  const handleShowAll = () => {
    setShowAll(true)
    loadList(FULL_SIZE)
  }

  const panel = (
    <div className="notify-panel">
      <div className="notify-panel-head">
        <span className="notify-panel-title">通知中心</span>
        <Button type="link" size="small" onClick={handleReadAll} disabled={unread === 0}>
          全部已读
        </Button>
      </div>
      <Spin spinning={loading}>
        {list.length === 0 && !loading ? (
          <Empty description="暂无通知" style={{ padding: '32px 0' }} image={Empty.PRESENTED_IMAGE_SIMPLE} />
        ) : (
          <div className={`notify-list ${showAll ? 'notify-list--all' : ''}`}>
            {list.map((n) => {
              const meta = TYPE_META[n.type] ?? TYPE_META['系统']
              return (
                <div
                  key={n.id}
                  className={`notify-item ${n.read ? '' : 'is-unread'}`}
                  onClick={() => handleRead(n)}
                >
                  <span className="notify-item-icon" style={{ color: meta.color, background: meta.bg }}>
                    {meta.icon}
                  </span>
                  <div className="notify-item-body">
                    <div className="notify-item-title">
                      {n.title}
                      {!n.read && <span className="notify-dot" />}
                    </div>
                    <div className="notify-item-content">{n.content}</div>
                    <div className="notify-item-time">{relativeTime(n.createdAt)}</div>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </Spin>
      {!showAll && total > DEFAULT_SIZE && (
        <div className="notify-panel-foot" onClick={handleShowAll}>
          查看全部（{total}）
        </div>
      )}
    </div>
  )

  return (
    <Popover
      content={panel}
      trigger="click"
      open={open}
      onOpenChange={handleOpenChange}
      placement="bottomRight"
      arrow={false}
    >
      <Badge count={unread} size="small" offset={[-6, 6]}>
        <button type="button" className="header-icon-btn" aria-label="通知">
          <Bell size={18} />
        </button>
      </Badge>
    </Popover>
  )
}
