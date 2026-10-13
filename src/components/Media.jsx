import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api, mediaUrl } from '../lib/api'
import { downloadFile } from '../lib/download'
import { chatTitle, clock, fileSize, whenText } from '../lib/format'
import { useStore } from '../store'
import { Icon, Modal, Spinner } from './ui'

const TABS = [['media', 'Media'], ['docs', 'Docs'], ['links', 'Links'], ['audio', 'Voice']]

/** Fetches one gallery tab page by page (newest first). */
function useGallery(kind, chatId) {
  const [state, setState] = useState({ items: [], cursor: null, hasMore: false, loading: true, error: '' })
  const qs = (extra = '') => `/media?kind=${kind}&limit=36${chatId ? `&chat_id=${chatId}` : ''}${extra}`
  useEffect(() => {
    let live = true
    setState({ items: [], cursor: null, hasMore: false, loading: true, error: '' })
    api.get(qs()).then((r) => live && setState({ items: r.items, cursor: r.next_before_id, hasMore: r.has_more, loading: false, error: '' }))
      .catch((e) => live && setState((s) => ({ ...s, loading: false, error: e.message })))
    return () => { live = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind, chatId])
  const more = useCallback(async () => {
    setState((s) => ({ ...s, loading: true }))
    try {
      const r = await api.get(qs(`&before_id=${state.cursor}`))
      setState((s) => ({ items: [...s.items, ...r.items], cursor: r.next_before_id, hasMore: r.has_more, loading: false, error: '' }))
    } catch (e) { setState((s) => ({ ...s, loading: false, error: e.message })) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.cursor, kind, chatId])
  const locked = useStore((s) => s.lockedChats)
  const items = chatId ? state.items : state.items.filter((i) => !locked.includes(i.chat_id)) // all-chats view hides locked chats
  return { ...state, items, more }
}

function Lightbox({ items, index, onIndex, onClose, onShow }) {
  const it = items[index]
  const error = useStore((s) => s.error)
  useEffect(() => {
    const h = (e) => {
      if (e.key === 'Escape') onClose()
      if (e.key === 'ArrowRight' && index < items.length - 1) onIndex(index + 1)
      if (e.key === 'ArrowLeft' && index > 0) onIndex(index - 1)
    }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [index, items.length, onClose, onIndex])
  if (!it) return null
  const url = mediaUrl(it.url)
  const btn = 'icon-btn !text-white hover:!bg-white/20'
  return (
    <div className="fixed inset-0 z-[65] flex flex-col bg-black/95 text-white" role="dialog" aria-label="Media viewer">
      <div className="flex items-center gap-2 px-3 py-2">
        <div className="min-w-0 flex-1 text-sm"><p className="truncate font-medium">{it.filename}</p><p className="text-xs opacity-70">{whenText(it.created_at)} · {index + 1} / {items.length}</p></div>
        <button className={btn} onClick={() => downloadFile(it.url, it.filename).catch(error)} aria-label="Download"><Icon name="down" /></button>
        <button className={btn} onClick={() => onShow(it)} aria-label="Show in chat"><Icon name="chat" /></button>
        <button className={btn} onClick={onClose} aria-label="Close"><Icon name="x" /></button>
      </div>
      <div className="relative flex min-h-0 flex-1 items-center justify-center p-2">
        {it.kind === 'image' ? <img src={url} alt={it.filename} className="max-h-full max-w-full object-contain" />
          : <video key={it.id} src={url} controls autoPlay playsInline className={`max-h-full max-w-full ${it.video_note ? 'aspect-square rounded-full object-cover' : ''}`} />}
        {index > 0 && <button className={`${btn} absolute left-2 top-1/2 -translate-y-1/2 bg-black/40`} onClick={() => onIndex(index - 1)} aria-label="Previous"><Icon name="back" /></button>}
        {index < items.length - 1 && <button className={`${btn} absolute right-2 top-1/2 -translate-y-1/2 bg-black/40`} onClick={() => onIndex(index + 1)} aria-label="Next"><Icon name="back" className="h-5 w-5 rotate-180" /></button>}
      </div>
    </div>
  )
}

function ChatLabel({ item, chatId, onClose }) {
  const chat = useStore((s) => s.chats[item.chat_id])
  if (chatId || !chat) return null
  return <span className="block truncate text-xs text-wa-green">{chatTitle(chat)}</span>
}

/** Media / Docs / Links / Voice for one chat, or for all chats when chatId is omitted. */
export function MediaGallery({ chatId, onNavigate }) {
  const [tab, setTab] = useState('media')
  const [counts, setCounts] = useState(null)
  const [viewer, setViewer] = useState(null)
  const g = useGallery(tab, chatId)
  const navigate = useNavigate()
  const error = useStore((s) => s.error)

  useEffect(() => { api.get(`/media/summary${chatId ? `?chat_id=${chatId}` : ''}`).then(setCounts).catch(() => {}) }, [chatId])
  const show = (it) => { setViewer(null); onNavigate?.(); navigate(`/chats/${it.chat_id}`) }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="divider flex" role="tablist">
        {TABS.map(([id, label]) => (
          <button key={id} role="tab" aria-selected={tab === id} onClick={() => setTab(id)}
            className={`flex-1 py-2.5 text-sm ${tab === id ? 'border-b-2 border-wa-green font-medium text-wa-green' : 'text-slate-500'}`}>
            {label}{counts ? <span className="ml-1 text-xs opacity-70">{counts[id]}</span> : null}
          </button>
        ))}
      </div>
      <div className="scroll-thin min-h-0 flex-1 overflow-y-auto">
        {g.error && <p role="alert" className="m-3 rounded bg-red-50 p-2 text-sm text-red-600 dark:bg-red-950 dark:text-red-300">{g.error}</p>}
        {!g.loading && !g.error && g.items.length === 0 && (
          <p className="p-10 text-center text-sm text-slate-500">{{ media: 'No photos or videos yet', docs: 'No documents yet', links: 'No links yet', audio: 'No voice notes yet' }[tab]}</p>
        )}

        {tab === 'media' && (
          <div className="grid grid-cols-3 gap-1 p-1 sm:grid-cols-4">
            {g.items.map((it, i) => (
              <button key={it.id} onClick={() => setViewer(i)} className="group relative aspect-square overflow-hidden bg-black/10" aria-label={`Open ${it.filename}`}>
                {it.kind === 'image'
                  ? <img src={mediaUrl(it.url)} alt="" loading="lazy" className="h-full w-full object-cover transition group-hover:scale-105" />
                  : <video src={mediaUrl(it.url)} preload="metadata" muted className="h-full w-full object-cover" />}
                {it.kind === 'video' && <span className="absolute inset-0 flex items-center justify-center bg-black/20"><span className="rounded-full bg-black/55 p-2 text-white"><Icon name="play" className="h-4 w-4" fill="currentColor" /></span></span>}
                {it.kind === 'video' && it.duration != null && <span className="absolute bottom-1 right-1 rounded bg-black/60 px-1 text-[10px] text-white">{clock(it.duration)}</span>}
              </button>
            ))}
          </div>
        )}

        {tab === 'docs' && g.items.map((it) => (
          <div key={it.id} className="flex items-center gap-3 px-4 py-2.5 hover:bg-black/5 dark:hover:bg-white/5">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-wa-green/15 text-wa-green"><Icon name="file" /></span>
            <span className="min-w-0 flex-1"><span className="block truncate text-sm font-medium">{it.filename}</span>
              <ChatLabel item={it} chatId={chatId} /><span className="block text-xs text-slate-500">{fileSize(it.size)} · {whenText(it.created_at)}</span></span>
            <button className="icon-btn" onClick={() => downloadFile(it.url, it.filename).catch(error)} aria-label={`Download ${it.filename}`}><Icon name="down" /></button>
            <button className="icon-btn" onClick={() => show(it)} aria-label="Show in chat"><Icon name="chat" className="h-4 w-4" /></button>
          </div>
        ))}

        {tab === 'links' && g.items.map((it) => {
          let host = it.url
          try { host = new URL(it.url).hostname } catch { /* keep raw */ }
          return (
            <div key={it.id} className="flex items-center gap-3 px-4 py-2.5 hover:bg-black/5 dark:hover:bg-white/5">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-sky-500/15 text-sky-500"><Icon name="link" /></span>
              <span className="min-w-0 flex-1">
                <a href={it.url} target="_blank" rel="noopener noreferrer nofollow" className="block truncate text-sm font-medium text-sky-600 hover:underline dark:text-sky-400">{host}</a>
                <span className="block truncate text-xs text-slate-500">{it.url}</span>
                <ChatLabel item={it} chatId={chatId} /><span className="block text-xs text-slate-500">{whenText(it.created_at)}</span>
              </span>
              <button className="icon-btn" onClick={() => show(it)} aria-label="Show in chat"><Icon name="chat" className="h-4 w-4" /></button>
            </div>
          )
        })}

        {tab === 'audio' && g.items.map((it) => (
          <div key={it.id} className="flex items-center gap-3 px-4 py-2.5">
            <Icon name="mic" className="h-5 w-5 shrink-0 text-wa-green" />
            <span className="min-w-0 flex-1"><audio src={mediaUrl(it.url)} controls preload="none" className="h-9 w-full" />
              <ChatLabel item={it} chatId={chatId} /><span className="block text-xs text-slate-500">{it.duration != null ? `${clock(it.duration)} · ` : ''}{whenText(it.created_at)}</span></span>
            <button className="icon-btn" onClick={() => show(it)} aria-label="Show in chat"><Icon name="chat" className="h-4 w-4" /></button>
          </div>
        ))}

        {g.loading && <div className="py-6"><Spinner /></div>}
        {g.hasMore && !g.loading && <div className="p-3 text-center"><button className="btn-ghost border border-slate-300 dark:border-slate-600" onClick={g.more}>Load more</button></div>}
      </div>
      {viewer != null && <Lightbox items={g.items} index={viewer} onIndex={setViewer} onClose={() => setViewer(null)} onShow={show} />}
    </div>
  )
}

export function MediaModal({ chatId, onClose }) {
  return (
    <Modal title="Media, links and docs" onClose={onClose} wide>
      <div className="flex h-[70vh] flex-col"><MediaGallery chatId={chatId} onNavigate={onClose} /></div>
    </Modal>
  )
}

/** Row in chat info: a few thumbnails and counts; opens the full gallery. */
export function MediaPreview({ chatId }) {
  const [open, setOpen] = useState(false)
  const [data, setData] = useState(null)
  useEffect(() => {
    let live = true
    Promise.all([api.get(`/media?kind=media&limit=6&chat_id=${chatId}`), api.get(`/media/summary?chat_id=${chatId}`)])
      .then(([m, c]) => live && setData({ items: m.items, counts: c })).catch(() => {})
    return () => { live = false }
  }, [chatId])
  const total = data ? data.counts.media + data.counts.docs + data.counts.links + data.counts.audio : 0
  return (
    <div className="divider px-4 py-3">
      <button className="flex w-full items-center justify-between text-sm" onClick={() => setOpen(true)} aria-haspopup="dialog">
        <span className="font-medium">Media, links and docs</span>
        <span className="flex items-center gap-1 text-slate-500">{total}<Icon name="back" className="h-4 w-4 rotate-180" /></span>
      </button>
      {data && data.items.length > 0 && (
        <div className="mt-2 flex gap-1 overflow-hidden">
          {data.items.map((it) => (
            <button key={it.id} onClick={() => setOpen(true)} className="relative h-16 w-16 shrink-0 overflow-hidden rounded-md bg-black/10" aria-label={`Open ${it.filename}`}>
              {it.kind === 'image' ? <img src={mediaUrl(it.url)} alt="" loading="lazy" className="h-full w-full object-cover" /> : <video src={mediaUrl(it.url)} preload="metadata" muted className="h-full w-full object-cover" />}
            </button>
          ))}
        </div>
      )}
      {open && <MediaModal chatId={chatId} onClose={() => setOpen(false)} />}
    </div>
  )
}

/** Full-pane gallery across all chats (opened from the left rail). */
export function MediaPage() {
  const activeChatId = useStore((s) => s.activeChatId)
  const openChat = useStore((s) => s.openChat)
  useEffect(() => { if (activeChatId) openChat(null) }, [activeChatId, openChat])
  return (
    <div className="flex min-w-0 flex-1 flex-col bg-white dark:bg-wa-night">
      <header className="divider bg-wa-bg px-4 py-3.5 dark:bg-wa-panel"><h1 className="text-lg font-semibold">Media, links and docs</h1><p className="text-xs text-slate-500">From all your chats</p></header>
      <MediaGallery />
    </div>
  )
}
