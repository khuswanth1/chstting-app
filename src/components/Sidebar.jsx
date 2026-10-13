import { useEffect, useMemo, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { api } from '../lib/api'
import { useStore } from '../store'
import { chatAvatar, chatTitle, listTime, previewText } from '../lib/format'
import { AI_USERNAME } from './AiTools'
import CallsTab from './CallsTab'
import { ChatLockModal } from './ChatLock'
import { NewChatModal, NewGroupModal, SendDocumentModal } from './Modals'
import NotificationsModal from './NotificationsModal'
import SettingsTab from './SettingsTab'
import { StarredModal } from './StarredModal'
import StatusTab from './StatusTab'
import ThemeToggle from './ThemeToggle'
import { Avatar, Icon, Tick } from './ui'

function ChatRow({ chat, active, onClick, selecting, selected }) {
  const aiAtTop = useStore((s) => s.aiAtTop)
  const fixedAtTop = aiAtTop && chat.peer?.username === AI_USERNAME
  const locked = useStore((s) => s.lockedChats.includes(chat.id))
  const me = useStore((s) => s.me)
  const typing = useStore((s) => s.typing[chat.id])
  const lm = chat.last_message
  const mine = lm && lm.sender_id === me.id
  const isTyping = (typing || []).some((i) => i !== me.id)
  const unread = chat.unread_count
  const sender = lm && chat.type === 'group' && !mine && lm.type !== 'system' && lm.sender_id
    ? `${chat.members.find((m) => m.user.id === lm.sender_id)?.user.display_name.split(' ')[0] || ''}: ` : ''
  return (
    <li>
      <button onClick={onClick} className={`flex w-full items-stretch gap-3 px-3 text-left transition hover:bg-black/5 dark:hover:bg-white/5 ${active || selected ? 'bg-black/10 dark:bg-white/10' : ''}`} aria-pressed={selecting ? !!selected : undefined}>
        {selecting && <span className="flex items-center"><span className={`flex h-5 w-5 items-center justify-center rounded border-2 ${selected ? 'border-wa-green bg-wa-green text-white' : 'border-slate-400'}`}>{selected && <Icon name="check" className="h-3.5 w-3.5" />}</span></span>}
        <span className="flex items-center py-3">
          <Avatar src={chatAvatar(chat)} name={chatTitle(chat)} size={48} group={chat.type === 'group'} online={chat.type === 'direct' && chat.peer?.is_online} />
        </span>
        {/* middle column grows and truncates; right column keeps its natural width, so every row lines up */}
        <span className="divider flex min-h-[72px] min-w-0 flex-1 items-center gap-3">
          <span className="flex min-w-0 flex-1 flex-col gap-0.5">
            <span className="truncate font-medium">{chatTitle(chat)}</span>
            <span className="flex min-w-0 items-center gap-1 text-sm text-slate-500">
              {locked ? <span className="flex items-center gap-1 italic"><Icon name="lock" className="h-3.5 w-3.5" />Locked chat</span> : isTyping ? <span className="text-wa-green">typing…</span> : lm ? <>
                {mine && !lm.deleted && lm.type !== 'system' && <Tick status={lm.status} />}
                <span className="truncate">{sender}{previewText(lm)}</span></> : <span className="truncate italic opacity-70">No messages yet</span>}
            </span>
          </span>
          <span className="flex shrink-0 flex-col items-end justify-center gap-1.5 self-stretch py-3">
            <span className={`text-xs ${unread ? 'font-semibold text-wa-green' : 'text-slate-500'}`}>{lm ? listTime(lm.created_at) : ' '}</span>
            <span className="flex h-5 items-center gap-1.5">
              {chat.muted && <Icon name="bell" className="h-3.5 w-3.5 opacity-50" />}
              {(chat.pinned || fixedAtTop) && <Icon name="pushpin" className="h-3.5 w-3.5 opacity-60" />}
              {unread > 0 && <span className="min-w-[20px] rounded-full bg-wa-green px-1.5 text-center text-xs font-semibold leading-5 text-white" aria-label={`${unread} unread`}>{unread > 99 ? '99+' : unread}</span>}
            </span>
          </span>
        </span>
      </button>
    </li>
  )
}

function SelectionBar({ chats }) {
  const selected = useStore((s) => s.selected)
  const stop = useStore((s) => s.stopSelecting)
  const setChatPrefs = useStore((s) => s.setChatPrefs)
  const markRead = useStore((s) => s.markRead)
  const picked = chats.filter((c) => selected.includes(c.id))
  const all = (key) => picked.length > 0 && picked.every((c) => c[key])
  const toast = useStore((s) => s.toast)
  // buttons stay clickable; with nothing selected they say what to do instead of silently doing nothing
  const act = (fn) => () => (picked.length ? fn() : toast({ kind: 'info', title: 'Select one or more chats first', duration: 2500 }))
  const run = async (prefs) => { await setChatPrefs(picked.map((c) => c.id), prefs); stop() }
  const btn = `icon-btn ${picked.length ? '' : 'opacity-50'}`
  return (
    <div className="flex items-center gap-1 bg-wa-green/10 px-2 py-2" role="toolbar" aria-label="Chat actions">
      <button className={btn} onClick={stop} aria-label="Cancel selection"><Icon name="x" /></button>
      <span className="flex-1 text-sm font-medium">{picked.length} selected</span>
      <button className={btn} onClick={act(() => run({ pinned: !all('pinned') }))} aria-label={all('pinned') ? 'Unpin' : 'Pin'} title={all('pinned') ? 'Unpin' : 'Pin'}><Icon name="pushpin" /></button>
      <button className={btn} onClick={act(() => run({ muted: !all('muted') }))} aria-label={all('muted') ? 'Unmute' : 'Mute'} title={all('muted') ? 'Unmute' : 'Mute'}><Icon name="bell" /></button>
      <button className={btn} onClick={act(() => { picked.forEach((c) => c.unread_count > 0 && markRead(c.id)); stop() })} aria-label="Mark as read" title="Mark as read"><Icon name="readAll" /></button>
      <button className={btn} onClick={act(() => run({ archived: !all('archived') }))} aria-label={all('archived') ? 'Unarchive' : 'Archive'} title={all('archived') ? 'Unarchive' : 'Archive'}><Icon name="archive" /></button>
    </div>
  )
}

function ChatsTab() {
  const chatsMap = useStore((s) => s.chats)
  const activeChatId = useStore((s) => s.activeChatId)
  const openDirect = useStore((s) => s.openDirect)
  const error = useStore((s) => s.error)
  const view = useStore((s) => s.chatView)
  const setView = useStore((s) => s.setChatView)
  const selecting = useStore((s) => s.selecting)
  const selected = useStore((s) => s.selected)
  const toggleSelected = useStore((s) => s.toggleSelected)
  const navigate = useNavigate()
  const [q, setQ] = useState('')
  const [msgHits, setMsgHits] = useState([])
  const [userHits, setUserHits] = useState([])

  const lockedChats = useStore((s) => s.lockedChats)
  const aiAtTop = useStore((s) => s.aiAtTop)
  // ChatFlow AI fixed first (if enabled), then pinned chats, then newest activity
  const chats = useMemo(() => {
    const isAi = (c) => aiAtTop && c.peer?.username === AI_USERNAME
    return Object.values(chatsMap).sort((a, b) => (isAi(b) - isAi(a)) || (b.pinned - a.pinned) || (a.last_message_at < b.last_message_at ? 1 : -1))
  }, [chatsMap, aiAtTop])
  const archived = useMemo(() => chats.filter((c) => c.archived), [chats])
  const term = q.trim().toLowerCase()
  const base = view === 'archived' ? archived : chats.filter((c) => !c.archived)
  const filtered = term ? chats.filter((c) => chatTitle(c).toLowerCase().includes(term) || c.peer?.username.includes(term)) : base
  const archivedUnread = archived.reduce((n, c) => n + (c.muted ? 0 : c.unread_count), 0)

  useEffect(() => {
    if (term.length < 2) { setMsgHits([]); setUserHits([]); return }
    let live = true
    const t = setTimeout(async () => {
      try {
        const [m, u] = await Promise.all([api.get(`/search/messages?q=${encodeURIComponent(term)}&limit=15`), api.get(`/users/search?q=${encodeURIComponent(term)}&limit=8`)])
        if (live) { setMsgHits(m); setUserHits(u) }
      } catch { /* ignore */ }
    }, 300)
    return () => { live = false; clearTimeout(t) }
  }, [term])

  const direct = userHits.filter((u) => !chats.some((c) => c.peer?.id === u.id))
  return (
    <>
      {selecting ? <SelectionBar chats={chats} /> : view === 'archived' ? (
        <div className="flex items-center gap-2 px-2 py-2">
          <button className="icon-btn" onClick={() => setView('all')} aria-label="Back to chats"><Icon name="back" /></button>
          <h2 className="font-semibold">Archived</h2>
        </div>
      ) : null}
      <div className="px-3 py-2">
        <div className="relative">
          <Icon name="search" className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
          <input className="w-full rounded-lg bg-wa-bg py-2 pl-9 pr-8 text-sm outline-none dark:bg-wa-panel" placeholder="Search chats, people, phone or messages" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search" />
          {q && <button className="absolute right-2 top-2" onClick={() => setQ('')} aria-label="Clear search"><Icon name="x" className="h-4 w-4" /></button>}
        </div>
      </div>
      <div className="scroll-thin min-h-0 flex-1 overflow-y-auto">
        {!term && view === 'all' && archived.length > 0 && !selecting && (
          <button className="flex w-full items-center gap-4 px-3 py-3 text-left hover:bg-black/5 dark:hover:bg-white/5" onClick={() => setView('archived')}>
            <span className="flex h-12 w-12 items-center justify-center text-wa-green"><Icon name="archive" className="h-6 w-6" /></span>
            <span className="flex-1 font-medium">Archived</span>
            {archivedUnread > 0 && <span className="rounded-full bg-wa-green px-1.5 text-xs font-semibold leading-5 text-white">{archivedUnread}</span>}
            <span className="text-xs text-slate-500">{archived.length}</span>
          </button>
        )}
        <ul>{filtered.map((c) => (
          <ChatRow key={c.id} chat={c} active={!selecting && String(c.id) === String(activeChatId)} selecting={selecting} selected={selected.includes(c.id)}
            onClick={() => (selecting ? toggleSelected(c.id) : navigate(`/chats/${c.id}`))} />
        ))}</ul>
        {view === 'archived' && !term && archived.length === 0 && <p className="p-8 text-center text-sm text-slate-500">No archived chats.<br />Archived chats stay out of your main list.</p>}
        {view === 'all' && !chats.length && !term && <p className="p-8 text-center text-sm text-slate-500">No chats yet. Tap <b>+</b> to start one.</p>}
        {term && direct.length > 0 && <>
          <h3 className="px-4 pb-1 pt-3 text-xs font-semibold uppercase text-wa-green">People</h3>
          <ul>{direct.map((u) => (
            <li key={u.id}><button className="flex w-full items-center gap-3 px-4 py-2 text-left hover:bg-black/5 dark:hover:bg-white/5" onClick={() => openDirect(u.id).then((c) => { setQ(''); if (c?.id) navigate(`/chats/${c.id}`) }).catch(error)}>
              <Avatar src={u.avatar_url} name={u.display_name} /><span><span className="block font-medium">{u.display_name}</span><span className="text-xs text-slate-500">@{u.username}</span></span></button></li>))}</ul></>}
        {term && msgHits.length > 0 && <>
          <h3 className="px-4 pb-1 pt-3 text-xs font-semibold uppercase text-wa-green">Messages</h3>
          <ul>{msgHits.filter((m) => !lockedChats.includes(m.chat_id)).map((m) => { const c = chatsMap[m.chat_id]; return c && (
            <li key={m.id}><button className="block w-full px-4 py-2 text-left hover:bg-black/5 dark:hover:bg-white/5" onClick={() => { navigate(`/chats/${c.id}`); setQ('') }}>
              <span className="block truncate text-sm font-medium">{chatTitle(c)}</span><span className="block truncate text-sm text-slate-500">{m.body}</span></button></li>) })}</ul></>}
        {term && !filtered.length && !direct.length && !msgHits.length && <p className="p-8 text-center text-sm text-slate-500">Nothing found for “{q}”</p>}
      </div>
    </>
  )
}

/** The ⋮ menu next to "+": WhatsApp-style chat list actions. */
function ChatsMenu() {
  const [open, setOpen] = useState(false)
  const ref = useRef()
  const navigate = useNavigate()
  const setModal = useStore((s) => s.setModal)
  const setView = useStore((s) => s.setChatView)
  const startSelecting = useStore((s) => s.startSelecting)
  const markAllRead = useStore((s) => s.markAllRead)
  const logout = useStore((s) => s.logout)
  const unread = useStore((s) => Object.values(s.chats).reduce((n, c) => n + c.unread_count, 0))
  const archivedCount = useStore((s) => Object.values(s.chats).filter((c) => c.archived).length)

  useEffect(() => {
    if (!open) return
    const h = (e) => { if (!ref.current?.contains(e.target)) setOpen(false) }
    const k = (e) => e.key === 'Escape' && setOpen(false)
    document.addEventListener('mousedown', h)
    window.addEventListener('keydown', k)
    return () => { document.removeEventListener('mousedown', h); window.removeEventListener('keydown', k) }
  }, [open])

  const go = (fn) => () => { setOpen(false); fn() }
  const item = 'flex w-full items-center gap-4 px-5 py-2.5 text-left text-[15px] hover:bg-black/5 disabled:opacity-40 dark:hover:bg-white/10'
  return (
    <div className="relative" ref={ref}>
      <button className={`icon-btn ${open ? 'bg-black/10 dark:bg-white/10' : ''}`} onClick={() => setOpen(!open)} aria-label="Menu" aria-haspopup="menu" aria-expanded={open}><Icon name="more" /></button>
      {open && (
        <div role="menu" className="pop absolute right-0 top-full z-30 mt-1 w-64 overflow-hidden rounded-xl bg-white py-2 text-slate-800 shadow-2xl ring-1 ring-black/5 dark:bg-wa-panel dark:text-slate-100 dark:ring-white/10">
          <button role="menuitem" className={item} onClick={go(() => setModal('group'))}><Icon name="users" className="h-5 w-5" />New group</button>
          <button role="menuitem" className={item} onClick={go(() => { navigate('/chats'); setView('archived') })}><Icon name="archive" className="h-5 w-5" />Archived{archivedCount > 0 && <span className="ml-auto text-xs text-slate-500">{archivedCount}</span>}</button>
          <button role="menuitem" className={item} onClick={go(() => setModal('starred'))}><Icon name="star" className="h-5 w-5" />Starred messages</button>
          <button role="menuitem" className={item} onClick={go(() => { navigate('/chats'); startSelecting() })}><Icon name="checkSquare" className="h-5 w-5" />Select chats</button>
          <button role="menuitem" className={item} disabled={!unread} onClick={go(markAllRead)}><Icon name="readAll" className="h-5 w-5" />Mark all as read</button>
          <div className="my-1.5 border-t border-wa-line dark:border-wa-lineNight" />
          <button role="menuitem" className={item} onClick={go(() => setModal('chatlock'))}><Icon name="lock" className="h-5 w-5" />Chat lock</button>
          <button role="menuitem" className={item} onClick={go(() => { logout(); navigate('/login') })}><Icon name="logout" className="h-5 w-5" />Log out</button>
        </div>
      )}
    </div>
  )
}

export default function Sidebar() {
  const me = useStore((s) => s.me)
  const tab = useStore((s) => s.tab)
  const setTab = useStore((s) => s.setTab)
  const unread = useStore((s) => s.notifications.unread)
  const wsOpen = useStore((s) => s.wsOpen)
  const chatUnread = useStore((s) => Object.values(s.chats).reduce((n, c) => n + (c.muted ? 0 : c.unread_count), 0))
  const statusDot = useStore((s) => s.feed.some((g) => g.user.id !== s.me.id && !g.all_viewed))
  const modal = useStore((s) => s.modal)
  const setModal = useStore((s) => s.setModal)
  const location = useLocation()
  const navigate = useNavigate()

  const activeTab = useMemo(() => {
    if (location.pathname.startsWith('/status')) return 'status'
    if (location.pathname.startsWith('/calls')) return 'calls'
    if (location.pathname.startsWith('/settings')) return 'settings'
    return 'chats'
  }, [location.pathname])

  useEffect(() => {
    if (tab !== activeTab) setTab(activeTab)
  }, [activeTab, tab, setTab])

  const tabs = [
    ['chats', 'chat', 'Chats', chatUnread, '/chats'],
    ['status', 'status', 'Status', statusDot ? 1 : 0, '/status'],
    ['calls', 'phone', 'Calls', 0, '/calls'],
    ['settings', 'settings', 'Settings', 0, '/settings'],
  ]

  return (
    <aside className="flex h-full w-full flex-col border-r border-wa-line bg-white dark:border-wa-lineNight dark:bg-wa-night md:w-[clamp(300px,32vw,440px)] md:shrink-0">
      <header className="flex items-center gap-2 bg-wa-bg px-3 py-2.5 dark:bg-wa-panel">
        <button className="md:hidden" onClick={() => { setTab('settings'); navigate('/settings') }} aria-label="My profile"><Avatar src={me.avatar_url} name={me.display_name} /></button>
        <button onClick={() => { setTab('chats'); navigate('/chats') }} className="flex-1 text-left text-lg font-bold text-wa-greenDark dark:text-wa-green"><span className="md:hidden">ChatFlow</span><span className="hidden capitalize md:inline">{activeTab}</span></button>
        <button className="icon-btn relative md:hidden" onClick={() => setModal('notifs')} aria-label={`Notifications${unread ? `, ${unread} unread` : ''}`}>
          <Icon name="bell" />{unread > 0 && <span className="absolute right-0.5 top-0.5 min-w-[16px] rounded-full bg-red-500 px-1 text-[10px] font-bold leading-4 text-white">{unread}</span>}
        </button>
        <button className="icon-btn text-fuchsia-500 md:hidden" onClick={() => useStore.getState().openAiChat().then((c) => { if (c?.id) navigate(`/chats/${c.id}`) })} aria-label="Ask ChatFlow AI" title="Ask ChatFlow AI"><Icon name="sparkles" /></button>
        <ThemeToggle className="md:hidden" />
        <button className="icon-btn" onClick={() => setModal('new')} aria-label="New chat"><Icon name="plus" /></button>
        <ChatsMenu />
      </header>
      {!wsOpen && <div role="status" className="bg-amber-100 px-3 py-1 text-center text-xs text-amber-800">Connecting… messages will sync when you’re back online</div>}
      <nav className="divider flex md:hidden" aria-label="Sections">
        {tabs.map(([id, icon, label, badge, path]) => (
          <button key={id} onClick={() => { setTab(id); navigate(path) }} aria-current={activeTab === id} className={`relative flex flex-1 flex-col items-center gap-0.5 py-2 text-[11px] ${activeTab === id ? 'border-b-2 border-wa-green text-wa-green' : 'text-slate-500'}`}>
            <Icon name={icon} className="h-5 w-5" />{label}
            {badge > 0 && <span className="absolute right-[22%] top-1 h-2 w-2 rounded-full bg-wa-green" />}
          </button>
        ))}
      </nav>
      {activeTab === 'chats' && <ChatsTab />}
      {activeTab === 'status' && <StatusTab />}
      {activeTab === 'calls' && <CallsTab />}
      {activeTab === 'settings' && <SettingsTab />}
      {modal === 'new' && <NewChatModal onClose={() => setModal(null)} onGroup={() => setModal('group')} />}
      {modal === 'group' && <NewGroupModal onClose={() => setModal(null)} />}
      {modal === 'starred' && <StarredModal onClose={() => setModal(null)} />}
      {modal === 'chatlock' && <ChatLockModal onClose={() => setModal(null)} />}
      {modal === 'sendDoc' && <SendDocumentModal onClose={() => setModal(null)} />}
      {modal === 'notifs' && <NotificationsModal onClose={() => setModal(null)} />}
    </aside>
  )
}

