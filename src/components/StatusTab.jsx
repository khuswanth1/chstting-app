import { useEffect, useRef, useState } from 'react'
import { api, mediaUrl } from '../lib/api'
import { useStore } from '../store'
import { downloadFile } from '../lib/download'
import { timeOf, whenText } from '../lib/format'
import { Avatar, Empty, Icon, Modal } from './ui'

const COLORS = ['#128C7E', '#6D28D9', '#0E7490', '#BE123C', '#B45309', '#1D4ED8', '#374151']
const REACTIONS = ['❤️', '😂', '😮', '😢', '👍', '🔥']

function StatusComposer({ onClose }) {
  const { loadFeed, error } = useStore.getState()
  const [mode, setMode] = useState('text')
  const [body, setBody] = useState('')
  const [color, setColor] = useState(COLORS[0])
  const [file, setFile] = useState(null)
  const [music, setMusic] = useState(null)
  const [busy, setBusy] = useState(false)
  const fileRef = useRef()
  const musicRef = useRef()
  const preview = file ? URL.createObjectURL(file) : null
  useEffect(() => () => preview && URL.revokeObjectURL(preview), [preview])

  async function post() {
    setBusy(true)
    try {
      const song = music ? await api.upload('/uploads', music) : null
      const music_attachment_id = song?.id ?? null
      if (mode === 'text') await api.post('/statuses', { type: 'text', body, bg_color: color, music_attachment_id })
      else {
        const att = await api.upload('/uploads', file)
        await api.post('/statuses', { type: att.kind, body: body || null, attachment_id: att.id, music_attachment_id })
      }
      await loadFeed(); onClose()
    } catch (e) { error(e) } finally { setBusy(false) }
  }

  return (
    <Modal title="New status" onClose={onClose}>
      <div className="flex gap-2 p-3">
        <button className={mode === 'text' ? 'btn-primary' : 'btn-ghost'} onClick={() => { setMode('text'); setFile(null) }}>Text</button>
        <button className={mode === 'media' ? 'btn-primary' : 'btn-ghost'} onClick={() => { setMode('media'); fileRef.current.click() }}><Icon name="camera" className="h-4 w-4" />Photo / video</button>
        <input ref={fileRef} type="file" hidden accept="image/jpeg,image/png,image/gif,image/webp,video/mp4,video/webm" onChange={(e) => { const f = e.target.files[0]; if (f) { setFile(f); setMode('media') } e.target.value = '' }} />
      </div>
      {mode === 'text' ? (
        <div className="mx-auto flex aspect-[9/16] max-h-72 items-center justify-center rounded-xl p-4" style={{ background: color }}>
          <textarea value={body} onChange={(e) => setBody(e.target.value)} maxLength={700} placeholder="Type a status" aria-label="Status text" className="h-full w-full resize-none bg-transparent text-center text-xl font-medium text-white placeholder-white/60 outline-none" />
        </div>
      ) : (
        <div className="mx-auto flex aspect-[9/16] max-h-72 items-center justify-center overflow-hidden rounded-xl bg-black">
          {!file ? <button className="text-white/70" onClick={() => fileRef.current.click()}>Choose a photo or video</button>
            : file.type.startsWith('video') ? <video src={preview} className="h-full w-full object-contain" controls /> : <img src={preview} alt="Preview" className="h-full w-full object-contain" />}
        </div>
      )}
      {mode === 'text' ? (
        <div className="flex gap-2 p-3">{COLORS.map((c) => <button key={c} onClick={() => setColor(c)} aria-label={`Background ${c}`} className={`h-7 w-7 rounded-full ring-offset-2 dark:ring-offset-wa-panel ${c === color ? 'ring-2 ring-wa-green' : ''}`} style={{ background: c }} />)}</div>
      ) : <div className="p-3"><input className="input" placeholder="Add a caption" value={body} onChange={(e) => setBody(e.target.value)} maxLength={700} /></div>}
      <div className="px-3 pb-3">
        <input ref={musicRef} type="file" hidden accept="audio/mpeg,audio/ogg,audio/wav,audio/mp4,.mp3,.ogg,.wav,.m4a" onChange={(e) => { const f = e.target.files[0]; if (f) setMusic(f); e.target.value = '' }} />
        {music ? (
          <div className="flex items-center gap-2 rounded-lg bg-wa-green/10 px-3 py-2 text-sm"><Icon name="mic" className="h-4 w-4 shrink-0 text-wa-green" /><span className="min-w-0 flex-1 truncate">{music.name}</span>
            <button onClick={() => setMusic(null)} aria-label="Remove music"><Icon name="x" className="h-4 w-4" /></button></div>
        ) : <button className="btn-ghost w-full border border-dashed border-slate-300 dark:border-slate-600" onClick={() => musicRef.current.click()}>♪ Add music (mp3, m4a, ogg, wav)</button>}
      </div>
      <div className="p-3 pt-0"><button className="btn-primary w-full" disabled={busy || (mode === 'text' ? !body.trim() : !file)} onClick={post}>{busy ? 'Posting…' : 'Post status (visible for 24h)'}</button></div>
    </Modal>
  )
}

function Viewer({ group, onClose }) {
  const me = useStore((s) => s.me)
  const { loadFeed, error, toast } = useStore.getState()
  const mine = group.user.id === me.id
  const startAt = Math.max(0, group.statuses.findIndex((s) => !s.viewed))
  const [idx, setIdx] = useState(mine ? 0 : startAt)
  const [progress, setProgress] = useState(0)
  const [paused, setPaused] = useState(false)
  const [viewers, setViewers] = useState(null)
  const [list, setList] = useState(group.statuses)
  const [reply, setReply] = useState('')
  const [sending, setSending] = useState(false)
  const [typing, setTyping] = useState(false)
  const [muted, setMuted] = useState(false)
  const audioRef = useRef()
  const s = list[idx]
  const next = () => (idx < list.length - 1 ? (setIdx(idx + 1), setProgress(0)) : onClose())
  const prev = () => (idx > 0 ? (setIdx(idx - 1), setProgress(0)) : setProgress(0))

  useEffect(() => { if (!mine) api.post(`/statuses/${s.id}/view`).then(loadFeed).catch(() => {}) }, [s.id]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (paused || typing || s.type === 'video' || viewers) return
    const t = setInterval(() => setProgress((p) => p + 100 / (s.music_url ? 150 : 50)), 100) // 5s, or 15s with music
    return () => clearInterval(t)
  }, [s.id, paused, viewers, typing])
  useEffect(() => { if (progress >= 100) next() }) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const h = (e) => {
      if (e.key === 'Escape') { if (e.target.tagName === 'INPUT') e.target.blur(); else onClose(); return }
      if (e.target.tagName === 'INPUT') return
      if (e.key === 'ArrowRight') next()
      if (e.key === 'ArrowLeft') prev()
    }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  })

  const react = async (emoji) => { try { await api.post(`/statuses/${s.id}/react`, { emoji }); toast({ kind: 'info', title: `Reacted ${emoji}` }); setList(list.map((x, i) => (i === idx ? { ...x, my_reaction: emoji } : x))) } catch (e) { error(e) } }
  const sendReply = async (e) => {
    e.preventDefault()
    if (!reply.trim() || sending) return
    setSending(true)
    try {
      await api.post(`/statuses/${s.id}/reply`, { body: reply.trim() })
      setReply(''); setTyping(false)
      toast({ kind: 'info', title: `Reply sent to ${group.user.display_name}` })
    } catch (er) { error(er) } finally { setSending(false) }
  }
  useEffect(() => {
    const a = audioRef.current
    if (!a) return
    const hold = paused || typing || !!viewers
    hold ? a.pause() : a.play().catch(() => {})
  }, [paused, typing, viewers, s.id])
  const save = (url, name) => downloadFile(url, name).catch(error)
  const showViewers = async () => { try { setViewers(await api.get(`/statuses/${s.id}/viewers`)) } catch (e) { error(e) } }
  const del = async () => {
    try { await api.del(`/statuses/${s.id}`); await loadFeed(); const rest = list.filter((x) => x.id !== s.id); if (!rest.length) onClose(); else { setList(rest); setIdx(Math.min(idx, rest.length - 1)); setViewers(null) } } catch (e) { error(e) }
  }

  return (
    <div className="fixed inset-0 z-[55] bg-neutral-900 text-white" role="dialog" aria-label="Status viewer">
      <div className="relative mx-auto flex h-full w-full max-w-[min(460px,calc(100dvh*9/16))] flex-col overflow-hidden bg-black">
      <div className="absolute inset-x-0 top-0 z-10 bg-gradient-to-b from-black/70 to-transparent p-3">
        <div className="flex gap-1">{list.map((x, i) => <div key={x.id} className="h-1 flex-1 overflow-hidden rounded bg-white/30"><div className="h-full bg-white" style={{ width: i < idx ? '100%' : i === idx ? `${s.type === 'video' ? 0 : Math.min(progress, 100)}%` : '0%' }} /></div>)}</div>
        <div className="mt-3 flex items-center gap-3">
          <Avatar src={group.user.avatar_url} name={group.user.display_name} size={36} />
          <div className="flex-1"><p className="text-sm font-medium">{mine ? 'My status' : group.user.display_name}</p><p className="text-xs opacity-80">{timeOf(s.created_at)}</p></div>
          {s.media_url && <button className="icon-btn text-white" onClick={() => save(s.media_url, `status-${s.id}.${s.media_url.split('.').pop()}`)} aria-label="Download status"><Icon name="down" className="rotate-0" /></button>}
          {mine && <button className="icon-btn text-white" onClick={del} aria-label="Delete status"><Icon name="trash" /></button>}
          <button className="icon-btn text-white" onClick={onClose} aria-label="Close"><Icon name="x" /></button>
        </div>
      </div>
      {s.music_url && (
        <>
          <audio key={s.id} ref={audioRef} src={mediaUrl(s.music_url)} autoPlay loop muted={muted} />
          <div className="absolute inset-x-3 top-[4.75rem] z-10 flex items-center gap-2 rounded-full bg-black/55 px-3 py-1.5 text-xs backdrop-blur">
            <span aria-hidden>♪</span><span className="min-w-0 flex-1 truncate">{s.music_title}</span>
            <button onClick={() => setMuted(!muted)} aria-label={muted ? 'Unmute music' : 'Mute music'} aria-pressed={muted}><Icon name={muted ? 'micOff' : 'mic'} className="h-4 w-4" /></button>
            <button onClick={() => save(s.music_url, s.music_title)} aria-label="Download music"><Icon name="down" className="h-4 w-4" /></button>
          </div>
        </>
      )}
      <div className="relative flex flex-1 items-center justify-center" onMouseDown={() => setPaused(true)} onMouseUp={() => setPaused(false)} onTouchStart={() => setPaused(true)} onTouchEnd={() => setPaused(false)}>
        <button className="absolute inset-y-0 left-0 z-[5] w-1/3" onClick={prev} aria-label="Previous" />
        <button className="absolute inset-y-0 right-0 z-[5] w-1/3" onClick={next} aria-label="Next" />
        {s.type === 'text' && <div className="flex h-full w-full items-center justify-center p-6" style={{ background: s.bg_color }}><p className="max-w-full whitespace-pre-wrap break-words text-center text-2xl font-medium">{s.body}</p></div>}
        {s.type === 'image' && <img src={mediaUrl(s.media_url)} alt={s.body || 'Status'} className="h-full w-full object-contain" />}
        {s.type === 'video' && <video key={s.id} src={mediaUrl(s.media_url)} autoPlay playsInline className="h-full w-full object-contain" onEnded={next} onTimeUpdate={(e) => setProgress((e.target.currentTime / (e.target.duration || 1)) * 100)} />}
        {s.type !== 'text' && s.body && <p className="absolute inset-x-0 bottom-4 bg-black/50 p-3 text-center">{s.body}</p>}
      </div>
      <div className="z-10 p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
        {mine ? <button className="mx-auto flex items-center gap-2 text-sm" onClick={showViewers}><Icon name="eye" className="h-4 w-4" />{s.view_count} view{s.view_count === 1 ? '' : 's'}</button>
          : <>
            <div className="mb-2 flex justify-center gap-1">{REACTIONS.map((e) => <button key={e} onClick={() => react(e)} aria-label={`React ${e}`} className={`rounded-full p-1 text-xl transition hover:scale-125 ${s.my_reaction === e ? 'bg-white/25' : ''}`}>{e}</button>)}</div>
            <form onSubmit={sendReply} className="flex items-center gap-2">
              <input value={reply} onChange={(e) => setReply(e.target.value)} onFocus={() => setTyping(true)} onBlur={() => setTyping(!!reply)}
                maxLength={2000} placeholder={`Reply to ${group.user.display_name}…`} aria-label="Reply to status"
                className="min-w-0 flex-1 rounded-full bg-white/15 px-4 py-2.5 text-sm text-white placeholder-white/60 outline-none focus:bg-white/25" />
              <button type="submit" disabled={!reply.trim() || sending} aria-label="Send reply" className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-wa-green disabled:opacity-40"><Icon name="send" className="h-5 w-5" /></button>
            </form>
          </>}
      </div>
      {viewers && (
        <Modal title={`Viewed by ${viewers.length}`} onClose={() => setViewers(null)}>
          {!viewers.length && <p className="p-6 text-center text-sm text-slate-500">No views yet</p>}
          <ul className="text-slate-800 dark:text-slate-100">{viewers.map((v) => (
            <li key={v.user.id} className="flex items-center gap-3 px-4 py-2"><Avatar src={v.user.avatar_url} name={v.user.display_name} /><span className="flex-1"><span className="block font-medium">{v.user.display_name}</span><span className="text-xs text-slate-500">{whenText(v.viewed_at)}</span></span><span className="text-xl">{v.reaction}</span></li>))}</ul>
        </Modal>
      )}
      </div>
    </div>
  )
}

export default function StatusTab() {
  const feed = useStore((s) => s.feed)
  const me = useStore((s) => s.me)
  const loadFeed = useStore((s) => s.loadFeed)
  const [composer, setComposer] = useState(false)
  const [view, setView] = useState(null)
  useEffect(() => { loadFeed() }, [loadFeed])

  const mine = feed.find((g) => g.user.id === me.id)
  const others = feed.filter((g) => g.user.id !== me.id)
  const ring = (g) => (g.all_viewed ? 'ring-slate-300 dark:ring-slate-600' : 'ring-wa-green')

  return (
    <div className="scroll-thin min-h-0 flex-1 overflow-y-auto">
      <div className="flex items-center gap-3 px-3 py-3">
        <button onClick={() => (mine ? setView(mine) : setComposer(true))} className={`rounded-full ${mine ? `p-0.5 ring-2 ${ring(mine)}` : ''}`} aria-label="My status"><Avatar src={me.avatar_url} name={me.display_name} size={48} /></button>
        <div className="min-w-0 flex-1"><p className="font-medium">My status</p><p className="text-sm text-slate-500">{mine ? `${mine.statuses.length} update${mine.statuses.length > 1 ? 's' : ''} · ${whenText(mine.latest_at)}` : 'Tap to add a status update'}</p></div>
        <button className="icon-btn bg-wa-green/15 text-wa-green" onClick={() => setComposer(true)} aria-label="Add status"><Icon name="plus" /></button>
      </div>
      <h3 className="px-4 pb-1 pt-2 text-xs font-semibold uppercase text-slate-500">Recent updates</h3>
      {!others.length && <Empty icon="status" title="No updates from contacts">Add contacts or chat with people to see their status here. Updates disappear after 24 hours.</Empty>}
      <ul>{others.map((g) => (
        <li key={g.user.id}><button className="flex w-full items-center gap-3 px-3 py-2.5 text-left hover:bg-black/5 dark:hover:bg-white/5" onClick={() => setView(g)}>
          <span className={`rounded-full p-0.5 ring-2 ${ring(g)}`}><Avatar src={g.user.avatar_url} name={g.user.display_name} size={46} /></span>
          <span><span className="block font-medium">{g.user.display_name}</span><span className="text-sm text-slate-500">{whenText(g.latest_at)}</span></span>
        </button></li>))}</ul>
      {composer && <StatusComposer onClose={() => setComposer(false)} />}
      {view && <Viewer group={view} onClose={() => { setView(null); loadFeed() }} />}
    </div>
  )
}
