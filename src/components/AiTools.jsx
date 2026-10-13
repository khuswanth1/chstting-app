import { useEffect, useRef, useState } from 'react'
import { api } from '../lib/api'
import { useStore } from '../store'
import { Icon, Modal, Spinner } from './ui'

export const AI_USERNAME = 'chatflow_ai'
export const LANGUAGES = ['English', 'Spanish', 'French', 'German', 'Portuguese', 'Italian', 'Hindi', 'Telugu', 'Tamil', 'Arabic', 'Chinese', 'Japanese', 'Korean', 'Russian', 'Turkish', 'Indonesian']

export function getAiLanguage() {
  try {
    const saved = localStorage.getItem('cf_ai_lang')
    if (saved) return saved
  } catch { /* storage unavailable */ }
  try {
    const name = new Intl.DisplayNames(['en'], { type: 'language' }).of((navigator.language || 'en').split('-')[0])
    if (LANGUAGES.includes(name)) return name
  } catch { /* ignore */ }
  return 'English'
}
export function setAiLanguage(lang) { try { localStorage.setItem('cf_ai_lang', lang) } catch { /* ignore */ } }

function useOutsideClose(ref, onClose) {
  useEffect(() => {
    const h = (e) => !ref.current?.contains(e.target) && onClose()
    document.addEventListener('mousedown', h)
    return () => document.removeEventListener('mousedown', h)
  }, [ref, onClose])
}

const TONES = [['fix', 'Fix spelling & grammar'], ['friendly', 'Make it friendly'], ['professional', 'Make it professional'], ['casual', 'Make it casual'], ['shorter', 'Make it shorter'], ['longer', 'Add more detail']]

/** ✨ button in the composer: improve / translate the draft, or get reply suggestions. */
export function AiComposerMenu({ chat, text, onText, onSuggestions }) {
  const error = useStore((s) => s.error)
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState('')
  const [lang, setLang] = useState(getAiLanguage)
  const ref = useRef()
  useOutsideClose(ref, () => setOpen(false))
  const hasText = !!text.trim()

  async function run(label, fn) {
    setBusy(label); setOpen(false)
    try { await fn() } catch (e) { error(e) } finally { setBusy('') }
  }
  const item = 'flex w-full items-center gap-2 px-4 py-2 text-left text-sm hover:bg-black/5 disabled:opacity-40 dark:hover:bg-white/10'

  return (
    <div className="relative" ref={ref}>
      <button className={`icon-btn ${busy ? 'animate-pulse text-wa-green' : ''}`} onClick={() => setOpen(!open)} aria-label="AI tools" aria-haspopup="menu" aria-expanded={open} title={busy ? `${busy}…` : 'AI tools'}>
        <Icon name="sparkles" />
      </button>
      {open && (
        <div className="pop absolute bottom-full left-0 z-20 mb-2 w-64 overflow-hidden rounded-xl bg-white py-1 shadow-xl dark:bg-wa-panel" role="menu">
          <p className="px-4 pb-1 pt-2 text-xs font-semibold uppercase text-wa-green">ChatFlow AI</p>
          <button className={item} onClick={() => run('Suggesting replies', async () => onSuggestions((await api.post('/ai/smart-replies', { chat_id: chat.id })).suggestions))}>
            <Icon name="chat" className="h-4 w-4" />Suggest replies
          </button>
          <p className="px-4 pb-1 pt-2 text-xs font-semibold uppercase text-slate-500">Improve my message</p>
          {!hasText && <p className="px-4 pb-1 text-xs text-slate-500">Type a message first</p>}
          {TONES.map(([tone, label]) => (
            <button key={tone} className={item} disabled={!hasText} onClick={() => run('Rewriting', async () => onText((await api.post('/ai/rewrite', { text, tone })).text))}>
              <Icon name="edit" className="h-4 w-4" />{label}
            </button>
          ))}
          <div className="divider mt-1" />
          <div className="flex items-center gap-2 px-4 py-2">
            <select className="input !w-auto !py-1 text-xs" value={lang} onChange={(e) => { setLang(e.target.value); setAiLanguage(e.target.value) }} aria-label="Translate to">
              {LANGUAGES.map((l) => <option key={l}>{l}</option>)}
            </select>
            <button className="btn-ghost !px-2 !py-1 text-xs" disabled={!hasText} onClick={() => run('Translating', async () => onText((await api.post('/ai/translate', { text, language: lang })).text))}>Translate draft</button>
          </div>
          <p className="px-4 pb-2 text-[11px] text-slate-500">Your text is sent to the AI model only when you pick an option.</p>
        </div>
      )}
    </div>
  )
}

/** Header button for the open chat: summarize everything or only what I haven't read. */
export function AiHeaderMenu({ chatId, unread }) {
  const [open, setOpen] = useState(false)
  const [summary, setSummary] = useState(null) // { onlyUnread }
  const ref = useRef()
  useOutsideClose(ref, () => setOpen(false))
  const item = 'flex w-full items-center gap-2 px-4 py-2 text-left text-sm hover:bg-black/5 dark:hover:bg-white/10'
  return (
    <div className="relative" ref={ref}>
      <button className="icon-btn" onClick={() => setOpen(!open)} aria-label="AI tools for this chat" aria-haspopup="menu"><Icon name="sparkles" /></button>
      {open && (
        <div className="pop absolute right-0 top-full z-20 mt-1 w-56 overflow-hidden rounded-xl bg-white py-1 text-slate-800 shadow-xl dark:bg-wa-panel dark:text-slate-100" role="menu">
          <button className={item} onClick={() => { setOpen(false); setSummary({ onlyUnread: false }) }}>Summarize this chat</button>
          <button className={item} onClick={() => { setOpen(false); setSummary({ onlyUnread: true }) }}>Catch me up (unread){unread ? ` · ${unread}` : ''}</button>
        </div>
      )}
      {summary && <SummaryModal chatId={chatId} onlyUnread={summary.onlyUnread} onClose={() => setSummary(null)} />}
    </div>
  )
}

function SummaryModal({ chatId, onlyUnread, onClose }) {
  const [state, setState] = useState({ loading: true })
  useEffect(() => {
    let live = true
    api.post('/ai/summarize', { chat_id: chatId, only_unread: onlyUnread, limit: 60 })
      .then((r) => live && setState({ data: r }))
      .catch((e) => live && setState({ error: e.message }))
    return () => { live = false }
  }, [chatId, onlyUnread])
  const lines = (state.data?.summary || '').split('\n').map((l) => l.replace(/^[-*•]\s*/, '').trim()).filter(Boolean)
  return (
    <Modal title={onlyUnread ? 'Catch up' : 'Chat summary'} onClose={onClose}>
      <div className="space-y-3 p-5">
        {state.loading && <div className="py-6 text-center text-sm text-slate-500"><Spinner /><p className="mt-3">Reading the conversation…</p></div>}
        {state.error && <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-600 dark:bg-red-950 dark:text-red-300">{state.error}</p>}
        {state.data && (
          <>
            <ul className="list-disc space-y-1.5 pl-5 text-[15px]">{lines.map((l, i) => <li key={i}>{l}</li>)}</ul>
            <p className="text-xs text-slate-500">Based on {state.data.messages} message{state.data.messages === 1 ? '' : 's'}. AI summaries can contain mistakes.</p>
          </>
        )}
      </div>
    </Modal>
  )
}

/** Translation shown under a message bubble. */
export function TranslationBlock({ state, onClose }) {
  if (!state) return null
  return (
    <div className="mt-1 rounded border-l-4 border-sky-500 bg-black/5 px-2 py-1 text-sm dark:bg-white/10">
      <div className="flex items-center gap-1 text-[11px] font-semibold uppercase text-sky-600 dark:text-sky-300">
        <span>🌐 {state.language}</span><button className="ml-auto" onClick={onClose} aria-label="Hide translation"><Icon name="x" className="h-3 w-3" /></button>
      </div>
      {state.loading ? <span className="text-slate-500">Translating…</span> : state.error ? <span className="text-red-500">{state.error}</span> : <p className="whitespace-pre-wrap break-words">{state.text}</p>}
    </div>
  )
}

/** Checkbox: keep ChatFlow AI fixed at the very top of the chat list. */
export function AiTopCheckbox({ className = '' }) {
  const on = useStore((s) => s.aiAtTop)
  const set = useStore((s) => s.setAiAtTop)
  return (
    <label className={`flex cursor-pointer items-start gap-3 py-1 text-sm ${className}`}>
      <input type="checkbox" checked={on} onChange={(e) => set(e.target.checked)} className="mt-0.5 h-4 w-4 shrink-0 accent-wa-green" />
      <span>Keep ChatFlow AI at the top<span className="block text-xs text-slate-500">Fixed above all other chats, even pinned ones</span></span>
    </label>
  )
}

export function AiSettings() {
  const [st, setSt] = useState(null)
  const [lang, setLang] = useState(getAiLanguage)
  const openAiChat = useStore((s) => s.openAiChat)
  useEffect(() => { api.get('/ai/status').then(setSt).catch(() => setSt({ enabled: false })) }, [])
  return (
    <div className="text-sm">
      {!st ? <Spinner /> : !st.enabled ? <p className="text-slate-500">AI features are turned off on this server (AI_ENABLED=false).</p> : (
        <>
          <p className="mb-2 flex items-center gap-2"><span className={`h-2.5 w-2.5 rounded-full ${st.reachable ? 'bg-wa-green' : 'bg-red-500'}`} />
            {st.reachable ? `Connected · model ${st.model}` : 'AI model server not reachable'}</p>
          {!st.reachable && <p className="mb-2 rounded bg-amber-100 p-2 text-xs text-amber-900">Install Ollama (free, runs locally), then run <code>ollama pull {st.model}</code>. Details are in the README.</p>}
          <button className="btn-ghost mb-2 border border-slate-300 dark:border-slate-600" onClick={openAiChat}><Icon name="sparkles" className="h-4 w-4" />Chat with ChatFlow AI</button>
        </>
      )}
      <AiTopCheckbox />
      <label className="flex items-center justify-between gap-3 py-1">Translate messages to
        <select className="input !w-auto" value={lang} onChange={(e) => { setLang(e.target.value); setAiLanguage(e.target.value) }}>{LANGUAGES.map((l) => <option key={l}>{l}</option>)}</select>
      </label>
      <p className="mt-2 text-xs text-slate-500">Chat text is sent to the AI model only when you use an AI feature or message ChatFlow AI. AI never sends messages or takes actions for you.</p>
    </div>
  )
}
