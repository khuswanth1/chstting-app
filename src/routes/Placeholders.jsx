import { useEffect } from 'react'
import { Navigate, useNavigate, useParams } from 'react-router-dom'
import { useStore } from '../store'
import { Icon } from '../components/ui'

export function ChatRedirect() {
  const { chatId } = useParams()
  return <Navigate to={`/chats/${chatId}`} replace />
}

export function EmptyChatPage() {
  const wsOpen = useStore((s) => s.wsOpen)
  const activeChatId = useStore((s) => s.activeChatId)
  const openChat = useStore((s) => s.openChat)
  const setModal = useStore((s) => s.setModal)
  const navigate = useNavigate()

  useEffect(() => {
    if (activeChatId) openChat(null)
  }, [activeChatId, openChat])

  const actions = [
    { label: 'Send document', icon: 'file', onClick: () => setModal('sendDoc') },
    { label: 'Add contact', icon: 'userPlus', onClick: () => setModal('new') },
    { label: 'Ask ChatFlow AI', icon: 'sparkles', ai: true, onClick: () => useStore.getState().openAiChat().then((c) => c?.id && navigate(`/chats/${c.id}`)).catch(() => {}) },
  ]

  return (
    <div className="chat-bg flex flex-1 flex-col items-center justify-center gap-10 p-8 text-center">
      <div className="flex flex-wrap items-start justify-center gap-8 sm:gap-12">
        {actions.map((a) => (
          <button key={a.label} onClick={a.onClick} className="group flex w-28 flex-col items-center gap-3 rounded-xl p-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-wa-green">
            <span className={`flex h-14 w-14 items-center justify-center rounded-full transition group-hover:scale-110 sm:h-16 sm:w-16 ${a.ai ? 'bg-gradient-to-br from-violet-500 via-fuchsia-500 to-amber-400 text-white' : 'bg-black/10 text-slate-700 dark:bg-white/10 dark:text-slate-100'}`}>
              <Icon name={a.icon} className="h-7 w-7" />
            </span>
            <span className="text-sm font-medium text-slate-700 dark:text-slate-100">{a.label}</span>
          </button>
        ))}
      </div>
      <p className="max-w-sm text-xs text-slate-500">Select a chat from the list to start messaging. {wsOpen ? '' : 'Reconnecting…'}</p>
    </div>
  )
}

export function StatusPlaceholder() {
  const activeChatId = useStore((s) => s.activeChatId)
  const openChat = useStore((s) => s.openChat)

  useEffect(() => {
    if (activeChatId) openChat(null)
  }, [activeChatId, openChat])

  return (
    <div className="chat-bg flex flex-1 flex-col items-center justify-center gap-4 p-8 text-center text-slate-500">
      <span className="flex h-20 w-20 items-center justify-center rounded-full bg-emerald-500/15 text-emerald-600 dark:text-emerald-400">
        <Icon name="status" className="h-10 w-10" />
      </span>
      <h2 className="text-2xl font-light text-slate-700 dark:text-slate-200">Status Updates</h2>
      <p className="max-w-md text-sm text-slate-500 dark:text-slate-400">
        Click on a contact’s status in the list to view their 24-hour photo, video, or text updates.
      </p>
    </div>
  )
}

export function CallsPlaceholder() {
  const activeChatId = useStore((s) => s.activeChatId)
  const openChat = useStore((s) => s.openChat)

  useEffect(() => {
    if (activeChatId) openChat(null)
  }, [activeChatId, openChat])

  return (
    <div className="chat-bg flex flex-1 flex-col items-center justify-center gap-4 p-8 text-center text-slate-500">
      <span className="flex h-20 w-20 items-center justify-center rounded-full bg-blue-500/15 text-blue-600 dark:text-blue-400">
        <Icon name="phone" className="h-10 w-10" />
      </span>
      <h2 className="text-2xl font-light text-slate-700 dark:text-slate-200">Calls Log</h2>
      <p className="max-w-md text-sm text-slate-500 dark:text-slate-400">
        Review your voice and video call history, or start a new call from any conversation.
      </p>
    </div>
  )
}

export function SettingsPlaceholder() {
  const activeChatId = useStore((s) => s.activeChatId)
  const openChat = useStore((s) => s.openChat)

  useEffect(() => {
    if (activeChatId) openChat(null)
  }, [activeChatId, openChat])

  return (
    <div className="chat-bg flex flex-1 flex-col items-center justify-center gap-4 p-8 text-center text-slate-500">
      <span className="flex h-20 w-20 items-center justify-center rounded-full bg-slate-500/15 text-slate-600 dark:text-slate-400">
        <Icon name="settings" className="h-10 w-10" />
      </span>
      <h2 className="text-2xl font-light text-slate-700 dark:text-slate-200">Settings & Preferences</h2>
      <p className="max-w-md text-sm text-slate-500 dark:text-slate-400">
        Configure your profile, theme, notifications, privacy, and account security in the left panel.
      </p>
    </div>
  )
}
