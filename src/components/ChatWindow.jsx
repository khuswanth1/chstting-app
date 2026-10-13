import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useStore } from '../store'
import { startCall } from '../lib/call'
import { chatAvatar, chatTitle, dayLabel, presenceText, sameDay } from '../lib/format'
import { joinGroupCall, startGroupCall } from '../lib/groupcall'
import { AI_USERNAME, AiHeaderMenu } from './AiTools'
import Composer from './Composer'
import { GroupCallBanner } from './GroupCall'
import MessageBubble from './MessageBubble'
import { ChatInfoModal, ForwardModal } from './Modals'
import { Avatar, Icon, Spinner } from './ui'

function TypingDots() {
  return <span className="inline-flex gap-0.5 align-middle">{[0, 1, 2].map((i) => <span key={i} className="dot inline-block h-1.5 w-1.5 rounded-full bg-wa-green" style={{ animationDelay: `${i * 0.15}s` }} />)}</span>
}

export default function ChatWindow({ chatId, onBack }) {
  const chat = useStore((s) => s.chats[chatId])
  const box = useStore((s) => s.messages[chatId])
  const me = useStore((s) => s.me)
  const typingIds = useStore((s) => s.typing[chatId])
  const room = useStore((s) => s.groupRooms[chatId])
  const loadMessages = useStore((s) => s.loadMessages)
  const [replyTo, setReplyTo] = useState(null)
  const [editing, setEditing] = useState(null)
  const [forward, setForward] = useState(null)
  const [info, setInfo] = useState(false)
  const scroller = useRef()
  const prev = useRef({ chat: null, first: null, last: null, height: 0, top: 0, atBottom: true })

  const items = box?.items || []
  const group = chat?.type === 'group'

  useEffect(() => { setReplyTo(null); setEditing(null) }, [chatId])

  useLayoutEffect(() => {
    const el = scroller.current
    if (!el) return
    const p = prev.current
    const first = items[0]?.id, last = items[items.length - 1]?.id
    if (p.chat !== chatId) el.scrollTop = el.scrollHeight
    else if (p.first !== first && p.last === last) el.scrollTop = el.scrollHeight - p.height + p.top
    else if (p.last !== last && (p.atBottom || items[items.length - 1]?.sender_id === me.id)) el.scrollTop = el.scrollHeight
    prev.current = { ...p, chat: chatId, first, last, height: el.scrollHeight }
  })

  const onScroll = (e) => {
    const el = e.currentTarget
    prev.current.top = el.scrollTop
    prev.current.height = el.scrollHeight
    prev.current.atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 80
    if (el.scrollTop < 120 && box?.hasMore && !box.loading) loadMessages(chatId, true)
  }

  const jumpTo = useCallback((id) => {
    const el = document.getElementById(`msg-${id}`)
    if (!el) return
    el.scrollIntoView({ block: 'center', behavior: 'smooth' })
    el.firstChild.classList.add('ring-2', 'ring-wa-green')
    setTimeout(() => el.firstChild.classList.remove('ring-2', 'ring-wa-green'), 1200)
  }, [])

  const names = useMemo(() => Object.fromEntries((chat?.members || []).map((m) => [m.user.id, m.user.display_name])), [chat?.members])

  if (!chat) return null
  const peer = chat.peer
  const isBot = peer?.username === AI_USERNAME
  const typingNames = (typingIds || []).filter((i) => i !== me.id).map((i) => (group ? names[i] : null))
  const subtitle = typingNames.length
    ? <span className="text-wa-green">{group ? `${typingNames.join(', ')} typing` : 'typing'} <TypingDots /></span>
    : group ? chat.members.map((m) => (m.user.id === me.id ? 'You' : m.user.display_name)).join(', ') : isBot ? 'AI assistant · always on' : presenceText(peer)

  return (
    <div className="flex h-full min-w-0 flex-1 flex-col">
      <header className="flex items-center gap-2 bg-wa-bg px-2 py-2 dark:bg-wa-panel">
        <button className="icon-btn md:hidden" onClick={onBack} aria-label="Back to chats"><Icon name="back" /></button>
        <button className="flex min-w-0 flex-1 items-center gap-3 rounded-lg p-1 text-left" onClick={() => setInfo(true)}>
          <Avatar src={chatAvatar(chat)} name={chatTitle(chat)} group={group} online={!group && peer?.is_online} />
          <span className="min-w-0"><span className="block truncate font-medium">{chatTitle(chat)}</span><span className="block truncate text-xs text-slate-500">{subtitle}</span></span>
        </button>
        {group && <>
          <button className="icon-btn" onClick={() => (room ? joinGroupCall(chat.id) : startGroupCall(chat.id, 'video'))} aria-label={room ? 'Join group call' : 'Start group video call'}><Icon name="video" /></button>
          <button className="icon-btn" onClick={() => (room ? joinGroupCall(chat.id) : startGroupCall(chat.id, 'audio'))} aria-label={room ? 'Join group call' : 'Start group voice call'}><Icon name="phone" /></button>
        </>}
        <button className={`icon-btn ${chat.pinned ? 'bg-wa-green/15 text-wa-green' : ''}`} onClick={() => useStore.getState().togglePin(chat.id)}
          aria-label={chat.pinned ? 'Unpin chat' : 'Pin chat'} aria-pressed={!!chat.pinned} title={chat.pinned ? 'Unpin chat' : 'Pin chat to the top'}>
          <Icon name="pushpin" fill={chat.pinned ? 'currentColor' : 'none'} />
        </button>
        {!isBot && <AiHeaderMenu chatId={chat.id} unread={chat.unread_count} />}
        {!group && peer && !isBot && <>
          <button className="icon-btn" onClick={() => startCall(peer, 'video', chat.id)} aria-label="Video call"><Icon name="video" /></button>
          <button className="icon-btn" onClick={() => startCall(peer, 'audio', chat.id)} aria-label="Voice call"><Icon name="phone" /></button>
        </>}
        <button className="icon-btn" onClick={() => setInfo(true)} aria-label="Chat info"><Icon name="more" /></button>
      </header>

      {group && <GroupCallBanner chatId={chatId} />}

      <div ref={scroller} onScroll={onScroll} className="chat-bg scroll-thin min-h-0 flex-1 overflow-y-auto px-3 py-3 sm:px-[6%]">
        {box?.loading && <div className="py-2"><Spinner /></div>}
        {!box?.hasMore && box?.loaded && items.length === 0 && <p className="mx-auto mt-10 w-fit rounded-lg bg-white/80 px-4 py-2 text-sm text-slate-500 dark:bg-wa-panel/80">No messages yet. Say hello 👋</p>}
        {items.map((m, i) => (
          <div key={m.id}>
            {(i === 0 || !sameDay(items[i - 1].created_at, m.created_at)) && (
              <div className="my-3 flex justify-center"><span className="rounded-lg bg-white/90 px-3 py-1 text-xs text-slate-500 shadow-sm dark:bg-wa-panel/90">{dayLabel(m.created_at)}</span></div>
            )}
            <MessageBubble m={m} mine={m.sender_id === me.id} meId={me.id} groupChat={group} senderName={names[m.sender_id] || 'Former member'}
              onReply={() => { setEditing(null); setReplyTo(m) }} onEdit={() => { setReplyTo(null); setEditing(m) }}
              onForward={() => setForward([m.id])} onJumpTo={jumpTo} />
          </div>
        ))}
      </div>

      <Composer chat={chat} replyTo={replyTo} setReplyTo={setReplyTo} editing={editing} setEditing={setEditing} />
      {forward && <ForwardModal messageIds={forward} onClose={() => setForward(null)} />}
      {info && <ChatInfoModal chatId={chatId} onClose={() => setInfo(false)} />}
    </div>
  )
}
