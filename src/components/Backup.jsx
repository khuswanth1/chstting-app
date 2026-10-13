import { useMemo, useState } from 'react'
import { downloadBackup } from '../lib/download'
import { chatAvatar, chatTitle, fileSize, whenText } from '../lib/format'
import { useStore } from '../store'
import { AI_USERNAME } from './AiTools'
import { Avatar, Icon, Modal } from './ui'

const LAST_KEY = 'cf_last_backup'
const readLast = () => { try { return JSON.parse(localStorage.getItem(LAST_KEY) || '{}') } catch { return {} } }

/** Backups cover ONE person: a one-to-one chat with a real person (not groups, not the AI assistant). */
export const canBackUp = (chat) => chat?.type === 'direct' && !!chat.peer && chat.peer.username !== AI_USERNAME

/** Settings → Backup: pick a person, then back up your conversation with them. */
export default function BackupSection() {
  const chatsMap = useStore((s) => s.chats)
  const [q, setQ] = useState('')
  const [picked, setPicked] = useState(null)
  const [open, setOpen] = useState(false)
  const [last, setLast] = useState(readLast)

  const people = useMemo(
    () => Object.values(chatsMap).filter(canBackUp).sort((a, b) => chatTitle(a).localeCompare(chatTitle(b))),
    [chatsMap],
  )
  const shown = people.filter((c) => chatTitle(c).toLowerCase().includes(q.trim().toLowerCase()) || c.peer.username.includes(q.trim().toLowerCase()))
  const chat = picked != null ? chatsMap[picked] : null

  return (
    <div className="text-sm">
      <p className="mb-2 text-slate-500">Back up your conversation with <b>one person</b> at a time: every message, optionally the photos, videos, voice notes and files you shared, and your calls with them. Nothing from other chats or from your account is included.</p>
      <input className="input mb-2" placeholder="Search for a person" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search for a person" />
      {!people.length && <p className="rounded-lg bg-black/5 p-3 text-slate-500 dark:bg-white/5">You have no one-to-one chats yet.</p>}
      <ul className="scroll-thin max-h-52 overflow-y-auto rounded-lg border border-wa-line dark:border-wa-lineNight" role="radiogroup" aria-label="Person to back up">
        {shown.map((c) => (
          <li key={c.id}>
            <button role="radio" aria-checked={picked === c.id} onClick={() => setPicked(c.id)}
              className={`flex w-full items-center gap-3 px-3 py-2 text-left hover:bg-black/5 dark:hover:bg-white/5 ${picked === c.id ? 'bg-wa-green/10' : ''}`}>
              <Avatar src={chatAvatar(c)} name={chatTitle(c)} size={34} />
              <span className="min-w-0 flex-1"><span className="block truncate font-medium">{chatTitle(c)}</span>
                {last[c.id] && <span className="block text-xs text-slate-500">Last backup: {whenText(last[c.id])}</span>}</span>
              {picked === c.id && <span className="flex h-5 w-5 items-center justify-center rounded-full bg-wa-green text-white"><Icon name="check" className="h-3.5 w-3.5" /></span>}
            </button>
          </li>
        ))}
        {people.length > 0 && !shown.length && <li className="p-3 text-center text-slate-500">No match</li>}
      </ul>
      <button className="btn-primary mt-3" disabled={!chat} onClick={() => setOpen(true)}>
        <Icon name="down" className="h-4 w-4" />{chat ? `Back up chat with ${chatTitle(chat)}` : 'Choose a person'}
      </button>
      {open && chat && <BackupModal chat={chat} onClose={() => setOpen(false)} onDone={(iso) => setLast((l) => ({ ...l, [chat.id]: iso }))} />}
    </div>
  )
}

/** Button for the chat info panel of a one-to-one chat. */
export function BackupChatButton({ chat }) {
  const [open, setOpen] = useState(false)
  if (!canBackUp(chat)) return null
  return (
    <div className="divider px-4 py-2">
      <button className="btn-ghost w-full justify-start" onClick={() => setOpen(true)}><Icon name="down" className="h-4 w-4" />Back up this chat</button>
      {open && <BackupModal chat={chat} onClose={() => setOpen(false)} onDone={(iso) => { try { localStorage.setItem(LAST_KEY, JSON.stringify({ ...readLast(), [chat.id]: iso })) } catch { /* ignore */ } }} />}
    </div>
  )
}

export function BackupModal({ chat, onClose, onDone }) {
  const hiddenByLock = useStore((s) => s.lockedChats.includes(chat.id) && !s.unlockedChats.includes(chat.id))
  const [password, setPassword] = useState('')
  const [media, setMedia] = useState(true)
  const [state, setState] = useState({ busy: false, error: '', done: null })
  const name = chatTitle(chat)

  async function start(e) {
    e.preventDefault()
    setState({ busy: true, error: '', done: null })
    try {
      const { size, filename } = await downloadBackup({ chatId: chat.id, password, includeMedia: media })
      const now = new Date().toISOString()
      try { localStorage.setItem(LAST_KEY, JSON.stringify({ ...readLast(), [chat.id]: now })) } catch { /* ignore */ }
      onDone?.(now)
      setState({ busy: false, error: '', done: { size, filename } })
    } catch (err) {
      setState({ busy: false, error: err.message, done: null })
    }
  }

  return (
    <Modal title={`Back up chat with ${name}`} onClose={state.busy ? () => {} : onClose}>
      <div className="space-y-4 p-5 text-sm">
        {hiddenByLock ? (
          <>
            <p className="flex items-center gap-2 font-medium"><Icon name="lock" className="h-4 w-4 text-wa-green" />This chat is locked</p>
            <p className="text-slate-500">Open the chat and enter your PIN first, then back it up from its info panel.</p>
            <button className="btn-primary w-full" onClick={onClose}>OK</button>
          </>
        ) : state.done ? (
          <>
            <p className="flex items-center gap-2 font-medium text-wa-green"><Icon name="check" className="h-5 w-5" />Backup downloaded</p>
            <p className="break-all text-slate-500">{state.done.filename} · {fileSize(state.done.size)}</p>
            <p className="rounded-lg bg-amber-100 p-3 text-xs text-amber-900">This file contains your whole conversation with {name}. Store it somewhere private and don’t share it.</p>
            <button className="btn-primary w-full" onClick={onClose}>Done</button>
          </>
        ) : (
          <form onSubmit={start} className="space-y-3">
            <p className="text-slate-500">Only your conversation with <b>{name}</b> is backed up. Confirm your password to continue.</p>
            <label className="flex cursor-pointer items-center gap-3">
              <input type="checkbox" checked={media} onChange={(e) => setMedia(e.target.checked)} className="h-4 w-4 accent-wa-green" disabled={state.busy} />
              <span>Include photos, videos, voice notes and documents<span className="block text-xs text-slate-500">Makes the file bigger</span></span>
            </label>
            <input type="password" className="input" placeholder="Account password" autoComplete="current-password" autoFocus
              value={password} onChange={(e) => { setPassword(e.target.value); setState((s) => ({ ...s, error: '' })) }} aria-label="Account password" disabled={state.busy} />
            {state.error && <p role="alert" className="text-red-500">{state.error}</p>}
            <button className="btn-primary w-full" disabled={!password || state.busy}>{state.busy ? 'Preparing your backup…' : 'Create and download backup'}</button>
          </form>
        )}
      </div>
    </Modal>
  )
}
