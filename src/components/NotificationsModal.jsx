import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { api } from '../lib/api'
import { useStore } from '../store'
import { desktopPermission, desktopSupported, requestDesktopPermission } from '../lib/alerts'
import { listTime } from '../lib/format'
import { Icon, Modal } from './ui'

const ICONS = { 'group.added': 'users', 'status.reaction': 'status', 'call.missed': 'phone' }

export default function NotificationsModal({ onClose }) {
  const { items, unread } = useStore((s) => s.notifications)
  const setTab = useStore((s) => s.setTab)
  const navigate = useNavigate()

  useEffect(() => {
    if (!unread) return
    api.post('/notifications/read').then(() => useStore.setState((s) => ({
      notifications: { items: s.notifications.items.map((n) => ({ ...n, read: true })), unread: 0 },
    }))).catch(() => {})
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  function open(n) {
    onClose()
    if (n.data?.chat_id) {
      navigate(`/chats/${n.data.chat_id}`)
    } else if (n.type === 'status.reaction') {
      setTab('status')
      navigate('/status')
    }
  }

  return (
    <Modal title="Notifications" onClose={onClose}>
      {desktopSupported() && desktopPermission() === 'default' && (
        <div className="divider flex items-center gap-3 bg-wa-green/10 px-4 py-3 text-sm">
          <span className="flex-1">Get browser notifications for new messages while ChatFlow is in the background.</span>
          <button className="btn-primary !py-1.5" onClick={() => requestDesktopPermission().then(() => onClose())}>Enable</button>
        </div>
      )}
      {desktopSupported() && desktopPermission() === 'denied' && <p className="divider px-4 py-2 text-xs text-slate-500">Browser notifications are blocked. Allow them in your browser’s site settings.</p>}
      {items.length === 0 && <p className="p-8 text-center text-sm text-slate-500">You’re all caught up.</p>}
      <ul>{items.map((n) => (
        <li key={n.id}><button onClick={() => open(n)} className={`flex w-full items-start gap-3 px-4 py-3 text-left hover:bg-black/5 dark:hover:bg-white/5 ${n.read ? '' : 'bg-wa-green/5'}`}>
          <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-wa-green/15 text-wa-green"><Icon name={ICONS[n.type] || 'bell'} className="h-4 w-4" /></span>
          <span className="min-w-0 flex-1"><span className="block truncate font-medium">{n.title}</span><span className="block text-sm text-slate-500">{n.body}</span></span>
          <span className="text-xs text-slate-400">{listTime(n.created_at)}</span>
        </button></li>))}</ul>
    </Modal>
  )
}
