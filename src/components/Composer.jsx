import { useEffect, useRef, useState } from 'react'
import { api } from '../lib/api'
import { sendWs, useStore } from '../store'
import { EMOJI_GROUPS, STICKERS } from '../lib/emoji'
import { Sticker } from './MessageBubble'
import { clock } from '../lib/format'
import { AI_USERNAME, AiComposerMenu } from './AiTools'
import { VideoNoteRecorder } from './VideoNote'
import { Icon } from './ui'

const ACCEPT = 'image/*,video/mp4,video/webm,video/quicktime,audio/*,.pdf,.txt,.csv,.docx,.xlsx,.pptx,.zip'

function EmojiPicker({ onPick, onSticker }) {
  const tabs = [...Object.keys(EMOJI_GROUPS), 'sticker']
  const [group, setGroup] = useState(tabs[0])
  const [base, setBase] = useState('😀')
  const [caption, setCaption] = useState('')
  return (
    <div className="pop absolute bottom-full left-0 z-20 mb-2 w-80 max-w-[calc(100vw-1.5rem)] overflow-hidden rounded-xl bg-white shadow-xl dark:bg-wa-panel">
      <div className="divider flex" role="tablist">{tabs.map((g) => (
        <button key={g} role="tab" aria-selected={g === group} aria-label={g === 'sticker' ? 'Stickers' : `Emoji ${g}`} onClick={() => setGroup(g)} className={`flex-1 py-2 text-lg ${g === group ? 'border-b-2 border-wa-green' : 'opacity-60'}`}>{g === 'sticker' ? '🏷️' : g}</button>
      ))}</div>
      {group !== 'sticker' ? (
        <div className="scroll-thin grid h-52 grid-cols-8 content-start gap-0.5 overflow-y-auto p-2">
          {EMOJI_GROUPS[group].map((e) => <button key={e} className="rounded p-1 text-xl hover:bg-black/10 dark:hover:bg-white/10" onClick={() => onPick(e)}>{e}</button>)}
        </div>
      ) : (
        <div className="scroll-thin h-72 overflow-y-auto p-2">
          <p className="mb-1 text-xs font-semibold uppercase text-slate-500">Create a sticker</p>
          <div className="mb-3 flex items-center gap-2">
            <div className="w-20 shrink-0"><Sticker body={caption.trim() ? `${base}\n${caption.trim()}` : base} small /></div>
            <div className="min-w-0 flex-1 space-y-1.5">
              <input className="input !py-1.5" placeholder="Caption (optional)" maxLength={24} value={caption} onChange={(e) => setCaption(e.target.value)} aria-label="Sticker caption" />
              <button className="btn-primary w-full !py-1.5" onClick={() => onSticker(base, caption.trim())}>Send sticker</button>
            </div>
          </div>
          <div className="mb-3 flex flex-wrap gap-0.5">{Object.values(EMOJI_GROUPS).flat().slice(0, 64).map((e) => (
            <button key={e} onClick={() => setBase(e)} aria-label={`Use ${e}`} className={`rounded p-0.5 text-lg ${e === base ? 'bg-wa-green/25' : 'hover:bg-black/10 dark:hover:bg-white/10'}`}>{e}</button>))}</div>
          <p className="mb-1 text-xs font-semibold uppercase text-slate-500">Stickers</p>
          <div className="grid grid-cols-3 gap-2">{STICKERS.map(([e, c]) => (
            <button key={e + c} onClick={() => onSticker(e, c)} aria-label={`Send ${c} sticker`} className="transition hover:scale-105"><Sticker body={`${e}\n${c}`} small /></button>))}</div>
        </div>
      )}
    </div>
  )
}

export default function Composer({ chat, replyTo, setReplyTo, editing, setEditing }) {
  const sendMessage = useStore((s) => s.sendMessage)
  const error = useStore((s) => s.error)
  const [text, setText] = useState('')
  const [files, setFiles] = useState([])
  const [emoji, setEmoji] = useState(false)
  const [busy, setBusy] = useState(false)
  const [rec, setRec] = useState(null) // {seconds}
  const [videoNote, setVideoNote] = useState(false)
  const [suggestions, setSuggestions] = useState([])
  const isBotChat = chat.peer?.username === AI_USERNAME
  const taRef = useRef()
  const fileRef = useRef()
  const typingRef = useRef({ last: 0, timer: null })
  const recRef = useRef(null)

  useEffect(() => {
    setText(editing ? editing.body : '')
    if (editing || replyTo) taRef.current?.focus()
  }, [editing, replyTo])

  useEffect(() => { setText(''); setFiles([]); setEmoji(false); setSuggestions([]) }, [chat.id])

  useEffect(() => {
    const ta = taRef.current
    if (ta) { ta.style.height = 'auto'; ta.style.height = Math.min(ta.scrollHeight, 140) + 'px' }
  }, [text])

  useEffect(() => () => { clearTimeout(typingRef.current.timer); recRef.current?.cancel?.() }, [])

  function typingPing() {
    const t = typingRef.current
    const now = Date.now()
    if (now - t.last > 2500) { sendWs({ type: 'typing', chat_id: chat.id, is_typing: true }); t.last = now }
    clearTimeout(t.timer)
    t.timer = setTimeout(() => { sendWs({ type: 'typing', chat_id: chat.id, is_typing: false }); t.last = 0 }, 3000)
  }

  async function submit() {
    if (busy) return
    if (editing) {
      if (!text.trim()) return
      try { await api.patch(`/messages/${editing.id}`, { body: text }); setEditing(null) } catch (e) { error(e) }
      return
    }
    if (!text.trim() && !files.length) return
    setBusy(true)
    try {
      await sendMessage(chat.id, { body: text, replyTo, files })
      setText(''); setFiles([]); setReplyTo(null); setEmoji(false)
      clearTimeout(typingRef.current.timer)
      sendWs({ type: 'typing', chat_id: chat.id, is_typing: false }); typingRef.current.last = 0
    } catch { /* toast shown by store */ } finally { setBusy(false) }
  }

  async function startRec() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      const mr = new MediaRecorder(stream)
      const chunks = []
      let seconds = 0
      let cancelled = false
      mr.ondataavailable = (e) => e.data.size && chunks.push(e.data)
      const tick = setInterval(() => { seconds += 1; setRec({ seconds }) }, 1000)
      mr.onstop = async () => {
        clearInterval(tick)
        stream.getTracks().forEach((t) => t.stop())
        setRec(null)
        recRef.current = null
        if (cancelled || !chunks.length) return
        const ext = mr.mimeType.includes('ogg') ? 'ogg' : 'webm'
        const file = new File(chunks, `voice-note.${ext}`, { type: mr.mimeType })
        setBusy(true)
        try { await sendMessage(chat.id, { voice: { file, duration: Math.max(1, seconds) }, replyTo }); setReplyTo(null) } catch { /* toasted */ } finally { setBusy(false) }
      }
      recRef.current = { stop: () => mr.stop(), cancel: () => { cancelled = true; mr.state !== 'inactive' && mr.stop() } }
      mr.start()
      setRec({ seconds: 0 })
    } catch { error(new Error('Microphone unavailable. Voice notes need HTTPS or localhost and mic permission.')) }
  }

  const canSend = text.trim() || files.length

  return (
    <div className="relative bg-wa-bg px-2 py-2 dark:bg-wa-panel">
      {(replyTo || editing) && (
        <div className="mb-2 flex items-center gap-2 rounded-lg border-l-4 border-wa-green bg-white px-3 py-2 text-sm dark:bg-wa-night">
          <Icon name={editing ? 'edit' : 'reply'} className="h-4 w-4 shrink-0 text-wa-green" />
          <span className="min-w-0 flex-1 truncate text-slate-600 dark:text-slate-300">{editing ? 'Editing message' : replyTo.body || `[${replyTo.type}]`}</span>
          <button className="icon-btn h-7 w-7" onClick={() => { setReplyTo(null); setEditing(null) }} aria-label="Cancel"><Icon name="x" className="h-4 w-4" /></button>
        </div>
      )}
      {suggestions.length > 0 && (
        <div className="mb-2 flex flex-wrap items-center gap-2" role="list" aria-label="Suggested replies">
          <Icon name="sparkles" className="h-4 w-4 text-wa-green" />
          {suggestions.map((sug) => (
            <button key={sug} role="listitem" className="rounded-full border border-wa-green/50 bg-white px-3 py-1 text-sm hover:bg-wa-green/10 dark:bg-wa-night" onClick={() => { setText(sug); setSuggestions([]); taRef.current?.focus() }}>{sug}</button>
          ))}
          <button className="icon-btn h-7 w-7" onClick={() => setSuggestions([])} aria-label="Dismiss suggestions"><Icon name="x" className="h-4 w-4" /></button>
        </div>
      )}
      {files.length > 0 && (
        <div className="mb-2 flex flex-wrap gap-2">
          {files.map((f, i) => (
            <span key={i} className="flex items-center gap-2 rounded-full bg-white px-3 py-1 text-xs shadow-sm dark:bg-wa-night">
              <Icon name={f.type.startsWith('image') ? 'image' : 'file'} className="h-4 w-4" />
              <span className="max-w-[10rem] truncate">{f.name}</span>
              <button onClick={() => setFiles(files.filter((_, j) => j !== i))} aria-label="Remove"><Icon name="x" className="h-3 w-3" /></button>
            </span>
          ))}
        </div>
      )}
      {rec ? (
        <div className="flex items-center gap-3 px-2">
          <button className="icon-btn text-red-500" onClick={() => recRef.current?.cancel()} aria-label="Cancel recording"><Icon name="trash" /></button>
          <span className="flex flex-1 items-center gap-2 text-sm"><span className="h-2.5 w-2.5 animate-pulse rounded-full bg-red-500" />Recording {clock(rec.seconds)}</span>
          <button className="btn-primary h-10 w-10 !rounded-full !p-0" onClick={() => recRef.current?.stop()} aria-label="Send voice note"><Icon name="send" className="h-5 w-5" /></button>
        </div>
      ) : (
        <div className="flex items-end gap-1">
          <div className="relative">
            <button className="icon-btn" onClick={() => setEmoji(!emoji)} aria-label="Emoji"><Icon name="smile" /></button>
            {emoji && <EmojiPicker onPick={(e) => { setText((t) => t + e); taRef.current?.focus() }} onSticker={async (e, c) => { setEmoji(false); try { await sendMessage(chat.id, { sticker: { emoji: e, caption: c }, replyTo }); setReplyTo(null) } catch { /* toasted */ } }} />}
          </div>
          <input ref={fileRef} type="file" multiple accept={ACCEPT} hidden onChange={(e) => { setFiles([...files, ...e.target.files].slice(0, 10)); e.target.value = '' }} />
          <button className="icon-btn" onClick={() => fileRef.current.click()} aria-label="Attach file" disabled={!!editing}><Icon name="paperclip" /></button>
          {!isBotChat && <AiComposerMenu chat={chat} text={text} onText={(t) => { setText(t); taRef.current?.focus() }} onSuggestions={(l) => setSuggestions(l)} />}
          <textarea ref={taRef} rows={1} value={text} placeholder="Type a message" aria-label="Message"
            className="max-h-36 min-h-[40px] flex-1 resize-none rounded-lg bg-white px-3 py-2 text-[15px] outline-none dark:bg-wa-night"
            onChange={(e) => { setText(e.target.value); if (!editing) typingPing() }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); submit() }
              if (e.key === 'Escape') { setReplyTo(null); setEditing(null) }
            }} maxLength={4000} />
          {canSend || editing
            ? <button className="btn-primary h-10 w-10 !rounded-full !p-0" onClick={submit} disabled={busy} aria-label="Send"><Icon name={editing ? 'check' : 'send'} className="h-5 w-5" /></button>
            : <><button className="icon-btn h-10 w-10" onClick={() => setVideoNote(true)} disabled={busy} aria-label="Record video message"><Icon name="video" /></button><button className="icon-btn h-10 w-10" onClick={startRec} disabled={busy} aria-label="Record voice note"><Icon name="mic" /></button></>}
        </div>
      )}
      {videoNote && <VideoNoteRecorder onClose={() => setVideoNote(false)} onSend={async (clip) => { await sendMessage(chat.id, { videoNote: clip, replyTo }); setReplyTo(null) }} />}
    </div>
  )
}
