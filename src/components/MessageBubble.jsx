import { memo, useEffect, useRef, useState } from 'react'
import { api, mediaUrl } from '../lib/api'
import { useStore } from '../store'
import { clock, fileSize, timeOf } from '../lib/format'
import { QUICK_REACTIONS } from '../lib/emoji'
import { TranslationBlock, getAiLanguage } from './AiTools'
import { VideoNotePlayer } from './VideoNote'
import { Icon, Tick } from './ui'

const URL_RE = /(https?:\/\/[^\s<]+)/g

function Linkified({ text }) {
  return text.split(URL_RE).map((part, i) =>
    /^https?:\/\//.test(part)
      ? <a key={i} href={part} target="_blank" rel="noopener noreferrer nofollow" className="text-sky-600 underline dark:text-sky-400 break-all">{part}</a>
      : <span key={i}>{part}</span>)
}

export function Sticker({ body, small }) {
  const [emoji, caption] = body.split('\n')
  const hue = [...emoji].reduce((a, c) => a + c.codePointAt(0), 0) % 360
  return (
    <div className={`rounded-3xl text-center shadow-md ${small ? 'p-1.5' : 'p-3'}`}
      style={{ background: `linear-gradient(135deg, hsl(${hue} 90% 93%), hsl(${(hue + 45) % 360} 85% 84%))` }}>
      <div className={`${small ? 'text-3xl' : 'text-7xl'} leading-none drop-shadow`} role="img" aria-label="sticker">{emoji}</div>
      {caption && <div className={`mt-1 rounded-full bg-white/85 font-extrabold uppercase tracking-wide text-slate-800 ${small ? 'px-1.5 text-[9px]' : 'px-3 py-0.5 text-sm'}`}>{caption}</div>}
    </div>
  )
}

function Media({ m }) {
  const a = m.attachments[0]
  if (!a) return null
  if (m.type === 'videonote') return <VideoNotePlayer attachment={a} />
  const url = mediaUrl(a.url)
  if (a.kind === 'image') {
    return <a href={url} target="_blank" rel="noopener noreferrer"><img src={url} alt={a.filename} loading="lazy" className="mb-1 max-h-72 w-full rounded-lg object-cover" /></a>
  }
  if (a.kind === 'video') return <video src={url} controls preload="metadata" className="mb-1 max-h-72 w-full rounded-lg bg-black" />
  if (a.kind === 'audio') {
    return (
      <div className="flex items-center gap-2 py-1">
        <Icon name="mic" className="h-5 w-5 shrink-0 text-wa-green" />
        <audio src={url} controls preload="metadata" className="h-9 w-48 max-w-full" />
        {a.duration != null && <span className="text-xs text-slate-500">{clock(a.duration)}</span>}
      </div>
    )
  }
  return (
    <a href={url} target="_blank" rel="noopener noreferrer" download={a.filename} className="mb-1 flex items-center gap-3 rounded-lg bg-black/5 p-3 dark:bg-white/10">
      <Icon name="file" className="h-8 w-8 shrink-0 text-wa-green" />
      <span className="min-w-0"><span className="block truncate text-sm font-medium">{a.filename}</span><span className="text-xs text-slate-500">{fileSize(a.size)}</span></span>
    </a>
  )
}

function Menu({ m, mine, onClose, onReply, onForward, onEdit, onTranslate, myReaction }) {
  const starred = useStore((s) => !!s.starredIds[m.id])
  const toggleStar = useStore((s) => s.toggleStar)
  const ref = useRef()
  const error = useStore((s) => s.error)
  useEffect(() => {
    const h = (e) => !ref.current?.contains(e.target) && onClose()
    document.addEventListener('mousedown', h)
    return () => document.removeEventListener('mousedown', h)
  }, [onClose])
  const run = (fn) => async () => { onClose(); try { await fn() } catch (e) { error(e) } }
  const item = 'flex w-full items-center gap-3 px-4 py-2 text-left text-sm hover:bg-black/5 dark:hover:bg-white/10'
  return (
    <div ref={ref} className={`pop absolute top-6 z-20 w-52 overflow-hidden rounded-xl bg-white py-1 text-slate-800 shadow-xl dark:bg-wa-panel dark:text-slate-100 ${mine ? 'right-0' : 'left-0'}`} role="menu">
      <div className="flex justify-around px-2 py-1.5">
        {QUICK_REACTIONS.map((e) => (
          <button key={e} className={`rounded-full p-1 text-xl transition hover:scale-125 ${myReaction === e ? 'bg-wa-green/20' : ''}`}
            onClick={run(() => (myReaction === e ? api.del(`/messages/${m.id}/reaction`) : api.put(`/messages/${m.id}/reaction`, { emoji: e })))}>{e}</button>
        ))}
      </div>
      {m.type !== 'system' && <button className={item} onClick={() => { onClose(); toggleStar(m.id) }}><Icon name="star" className="h-4 w-4" fill={starred ? 'currentColor' : 'none'} />{starred ? 'Unstar' : 'Star'}</button>}
      <button className={item} onClick={() => { onClose(); onReply() }}><Icon name="reply" className="h-4 w-4" />Reply</button>
      {m.body && m.type === 'text' && <button className={item} onClick={() => { onClose(); onTranslate() }}><Icon name="sparkles" className="h-4 w-4" />Translate</button>}
      {m.body && <button className={item} onClick={run(() => navigator.clipboard.writeText(m.body))}><Icon name="copy" className="h-4 w-4" />Copy</button>}
      <button className={item} onClick={() => { onClose(); onForward() }}><Icon name="forward" className="h-4 w-4" />Forward</button>
      {mine && m.type === 'text' && <button className={item} onClick={() => { onClose(); onEdit() }}><Icon name="edit" className="h-4 w-4" />Edit</button>}
      <button className={item} onClick={run(() => api.del(`/messages/${m.id}?scope=me`))}><Icon name="trash" className="h-4 w-4" />Delete for me</button>
      {mine && <button className={`${item} text-red-500`} onClick={run(() => api.del(`/messages/${m.id}?scope=everyone`))}><Icon name="trash" className="h-4 w-4" />Delete for everyone</button>}
    </div>
  )
}

function MessageBubble({ m, mine, senderName, groupChat, meId, onReply, onForward, onEdit, onJumpTo }) {
  const [menu, setMenu] = useState(false)
  const [tr, setTr] = useState(null)
  const starred = useStore((s) => !!s.starredIds[m.id])
  const error = useStore((s) => s.error)
  const translate = async () => {
    const language = getAiLanguage()
    setTr({ language, loading: true })
    try { setTr({ language, text: (await api.post('/ai/translate', { message_id: m.id, language })).text }) }
    catch (e) { setTr({ language, error: e.message }) }
  }

  if (m.type === 'system') {
    return <div className="my-2 flex justify-center"><span className="rounded-lg bg-white/80 px-3 py-1 text-xs text-slate-500 shadow-sm dark:bg-wa-panel/80">{m.body}</span></div>
  }

  const counts = {}
  m.reactions.forEach((r) => { counts[r.emoji] = (counts[r.emoji] || 0) + 1 })
  const myReaction = m.reactions.find((r) => r.user_id === meId)?.emoji

  return (
    <div className={`group flex ${mine ? 'justify-end' : 'justify-start'} ${m.reactions.length ? 'mb-4' : 'mb-1'}`} id={`msg-${m.id}`}>
      <div className={`relative max-w-[85%] rounded-lg px-2.5 py-1.5 text-[15px] sm:max-w-[65%] ${(m.type === 'sticker' || m.type === 'videonote') && !m.deleted ? 'bg-transparent' : `shadow-sm ${mine ? 'bg-wa-out dark:bg-wa-outNight' : 'bg-white dark:bg-wa-inNight'}`}`}>
        {!m.deleted && (
          <button className={`absolute top-0.5 z-10 rounded-full bg-inherit p-0.5 opacity-0 transition focus:opacity-100 group-hover:opacity-100 ${mine ? 'right-1' : 'right-1'}`} onClick={() => setMenu(true)} aria-label="Message options" aria-haspopup="menu">
            <Icon name="down" className="h-4 w-4 text-slate-500" />
          </button>
        )}
        {menu && <Menu m={m} mine={mine} myReaction={myReaction} onClose={() => setMenu(false)} onReply={onReply} onForward={onForward} onEdit={onEdit} onTranslate={translate} />}

        {groupChat && !mine && <p className="mb-0.5 text-xs font-semibold text-teal-700 dark:text-teal-300">{senderName}</p>}
        {m.forwarded && !m.deleted && <p className="mb-0.5 flex items-center gap-1 text-xs italic text-slate-500"><Icon name="forward" className="h-3 w-3" />Forwarded</p>}
        {m.status_ref && !m.deleted && (
          <div className="mb-1 flex items-center gap-2 rounded border-l-4 border-purple-500 bg-black/5 px-2 py-1 text-xs dark:bg-white/10">
            <Icon name="status" className="h-4 w-4 shrink-0 text-purple-500" />
            <span className="min-w-0">
              <span className="block font-semibold text-purple-600 dark:text-purple-300">{mine ? 'You replied to a status' : 'Replied to your status'}</span>
              <span className="block truncate text-slate-600 dark:text-slate-300">{m.status_ref.body || { image: '📷 Photo', video: '🎥 Video' }[m.status_ref.type] || 'Status'}</span>
            </span>
          </div>
        )}
        {m.reply_to && !m.deleted && (
          <button onClick={() => onJumpTo(m.reply_to.id)} className="mb-1 block w-full rounded border-l-4 border-wa-green bg-black/5 px-2 py-1 text-left text-xs dark:bg-white/10">
            <span className="block truncate text-slate-600 dark:text-slate-300">{m.reply_to.deleted ? 'Deleted message' : m.reply_to.body || `[${m.reply_to.type}]`}</span>
          </button>
        )}

        {m.deleted ? (
          <p className="flex items-center gap-1 italic text-slate-500"><Icon name="block" className="h-4 w-4" />{mine ? 'You deleted this message' : 'This message was deleted'}</p>
        ) : (
          <>
            <Media m={m} />
            {m.type === 'sticker' && <Sticker body={m.body} />}
            {m.type !== 'sticker' && m.body && <p className="whitespace-pre-wrap break-words pr-12"><Linkified text={m.body} /></p>}
          </>
        )}

        <TranslationBlock state={tr} onClose={() => setTr(null)} />

        <span className="float-right -mb-0.5 ml-2 mt-1 flex items-center gap-1 text-[11px] leading-none text-slate-500 dark:text-slate-400">
          {starred && !m.deleted && <Icon name="star" className="h-3 w-3 text-amber-500" fill="currentColor" />}
          {m.edited_at && !m.deleted && <span>edited</span>}
          {timeOf(m.created_at)}
          {mine && !m.deleted && <Tick status={m.status} />}
        </span>
        <span className="clear-both block" />

        {m.reactions.length > 0 && (
          <div className={`absolute -bottom-3.5 flex gap-1 ${mine ? 'right-2' : 'left-2'}`}>
            {Object.entries(counts).map(([emoji, n]) => (
              <button key={emoji} title={m.reactions.filter((r) => r.emoji === emoji).length + ' reaction(s)'}
                onClick={() => (myReaction === emoji ? api.del(`/messages/${m.id}/reaction`) : api.put(`/messages/${m.id}/reaction`, { emoji })).catch(error)}
                className={`rounded-full border bg-white px-1.5 py-0.5 text-xs shadow dark:bg-wa-panel ${myReaction === emoji ? 'border-wa-green' : 'border-transparent'}`}>
                {emoji}{n > 1 && <span className="ml-0.5">{n}</span>}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

export default memo(MessageBubble)
