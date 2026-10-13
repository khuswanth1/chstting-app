import { useLocation, useNavigate } from 'react-router-dom'
import { useStore } from '../store'
import ThemeToggle from './ThemeToggle'
import { Avatar, Icon } from './ui'

/** WhatsApp-Web-style slim navigation rail (desktop). Phones keep the tab bar inside the sidebar. */
export default function NavRail() {
  const me = useStore((s) => s.me)
  const setTab = useStore((s) => s.setTab)
  const setModal = useStore((s) => s.setModal)
  const chatUnread = useStore((s) => Object.values(s.chats).reduce((n, c) => n + (c.muted ? 0 : c.unread_count), 0))
  const statusDot = useStore((s) => s.feed.some((g) => g.user.id !== s.me.id && !g.all_viewed))
  const notifUnread = useStore((s) => s.notifications.unread)
  const chatView = useStore((s) => s.chatView)
  const setChatView = useStore((s) => s.setChatView)
  const archivedCount = useStore((s) => Object.values(s.chats).filter((c) => c.archived).length)
  const archivedUnread = useStore((s) => Object.values(s.chats).reduce((n, c) => n + (c.archived && !c.muted ? c.unread_count : 0), 0))
  const { pathname } = useLocation()
  const navigate = useNavigate()

  const section = pathname.startsWith('/media') ? 'media' : pathname.startsWith('/status') ? 'status' : pathname.startsWith('/calls') ? 'calls' : pathname.startsWith('/settings') ? 'settings' : 'chats'
  const go = (id) => { setTab(id); if (id === 'chats') setChatView('all'); navigate(`/${id}`) }
  const showArchived = () => { setTab('chats'); navigate('/chats'); setChatView('archived') }
  const inArchived = section === 'chats' && chatView === 'archived'

  const Item = ({ id, icon, label, badge, dot, active = section === id && !inArchived, onClick = () => go(id) }) => (
    <button onClick={onClick} aria-label={label} title={label} aria-current={active ? 'page' : undefined}
      className={`relative flex h-11 w-11 shrink-0 items-center justify-center rounded-full transition [@media(max-height:820px)]:h-9 [@media(max-height:820px)]:w-9 ${active ? 'bg-black/10 text-slate-800 dark:bg-white/15 dark:text-white' : 'text-slate-500 hover:bg-black/5 dark:text-slate-300 dark:hover:bg-white/10'}`}>
      <Icon name={icon} className="h-6 w-6" />
      {badge > 0 && <span className="absolute -right-1 -top-1 min-w-[20px] rounded-full bg-wa-green px-1 text-center text-[11px] font-bold leading-5 text-white">{badge > 99 ? '99+' : badge}</span>}
      {dot && <span className="absolute right-0.5 top-0.5 h-2.5 w-2.5 rounded-full bg-wa-green ring-2 ring-wa-bg dark:ring-wa-panel" />}
    </button>
  )

  return (
    <nav aria-label="Main" className="scroll-thin hidden h-full min-h-0 w-[64px] shrink-0 flex-col items-center gap-1 overflow-y-auto overflow-x-hidden border-r border-wa-line bg-wa-bg py-3 dark:border-wa-lineNight dark:bg-wa-panel md:flex [@media(max-height:820px)]:gap-0.5 [@media(max-height:820px)]:py-2">
      <button onClick={() => go('chats')} aria-label="ChatFlow home" className="mb-3 flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-wa-green text-white [@media(max-height:820px)]:mb-1 [@media(max-height:820px)]:h-9 [@media(max-height:820px)]:w-9"><Icon name="chat" className="h-6 w-6" fill="currentColor" /></button>
      <Item id="chats" icon="chat" label="Chats" badge={chatUnread} />
      <Item id="archived" icon="archive" label={`Archived chats${archivedCount ? ` (${archivedCount})` : ''}`} badge={archivedUnread} active={inArchived} onClick={showArchived} />
      <Item id="calls" icon="phone" label="Calls" />
      <Item id="status" icon="status" label="Status" dot={statusDot} />
      <button onClick={() => setModal('group')} aria-label="New group" title="New group" className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-slate-500 transition hover:bg-black/5 dark:text-slate-300 dark:hover:bg-white/10 [@media(max-height:820px)]:h-9 [@media(max-height:820px)]:w-9"><Icon name="users" className="h-6 w-6" /></button>
      <div className="my-2 w-8 shrink-0 border-t border-slate-300 dark:border-slate-600 [@media(max-height:820px)]:my-1" />
      <button onClick={() => useStore.getState().openAiChat().then((c) => c?.id && navigate(`/chats/${c.id}`)).catch(() => {})} aria-label="Ask ChatFlow AI" title="Ask ChatFlow AI"
        className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-violet-500 via-fuchsia-500 to-amber-400 text-white shadow transition hover:scale-105 [@media(max-height:820px)]:h-9 [@media(max-height:820px)]:w-9"><Icon name="sparkles" className="h-5 w-5" /></button>

      <div className="mt-auto flex shrink-0 flex-col items-center gap-1 pt-2 [@media(max-height:820px)]:gap-0.5">
        <Item id="media" icon="image" label="Media, links and docs" />
        <button onClick={() => setModal('notifs')} aria-label={`Notifications${notifUnread ? `, ${notifUnread} unread` : ''}`} title="Notifications" className="icon-btn relative h-11 w-11 [@media(max-height:820px)]:h-9 [@media(max-height:820px)]:w-9">
          <Icon name="bell" className="h-6 w-6" />{notifUnread > 0 && <span className="absolute right-0 top-0 min-w-[18px] rounded-full bg-red-500 px-1 text-center text-[10px] font-bold leading-[18px] text-white">{notifUnread}</span>}
        </button>
        <ThemeToggle className="!h-11 !w-11 [@media(max-height:820px)]:!h-9 [@media(max-height:820px)]:!w-9" />
        <Item id="settings" icon="settings" label="Settings" />
        <button onClick={() => go('settings')} aria-label="My profile" title="My profile" className="mt-1 shrink-0 rounded-full ring-2 ring-transparent transition hover:ring-wa-green"><Avatar src={me.avatar_url} name={me.display_name} size={36} /></button>
      </div>
    </nav>
  )
}
