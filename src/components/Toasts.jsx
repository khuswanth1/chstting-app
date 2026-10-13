import { useNavigate } from 'react-router-dom'
import { useStore } from '../store'
import { Icon } from './ui'

export default function Toasts() {
  const toasts = useStore((s) => s.toasts)
  const dismiss = useStore((s) => s.dismissToast)
  const navigate = useNavigate()

  return (
    <div className="pointer-events-none fixed inset-x-0 top-3 z-[70] flex flex-col items-center gap-2 px-3" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} role={t.kind === 'error' ? 'alert' : 'status'}
          className={`pop pointer-events-auto flex w-full max-w-sm items-start gap-3 rounded-xl px-4 py-3 shadow-xl ${t.kind === 'error' ? 'bg-red-600 text-white' : 'bg-white text-slate-800 dark:bg-wa-panel dark:text-slate-100'}`}>
          <button className="min-w-0 flex-1 text-left" onClick={() => { if (t.chatId) navigate(`/chats/${t.chatId}`); dismiss(t.id) }}>
            <span className="block truncate text-sm font-semibold">{t.title}</span>
            {t.body && <span className="block truncate text-sm opacity-80">{t.body}</span>}
          </button>
          <button onClick={() => dismiss(t.id)} aria-label="Dismiss"><Icon name="x" className="h-4 w-4" /></button>
        </div>
      ))}
    </div>
  )
}

