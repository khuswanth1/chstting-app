import { useEffect, useRef, useState } from 'react'
import { api } from '../lib/api'
import { clearPin, hasPin, setPin, validPin, verifyPin } from '../lib/chatlock'
import { chatAvatar, chatTitle } from '../lib/format'
import { useStore } from '../store'
import { AI_USERNAME } from './AiTools'
import { Avatar, Icon, Modal } from './ui'

/** Only one-to-one chats with a real person can be locked (not groups, not the AI assistant). */
export const isLockable = (chat) => chat?.type === 'direct' && chat.peer?.username !== AI_USERNAME

const digits = (fn) => (e) => fn(e.target.value.replace(/\D/g, ''))
const field = 'input text-center tracking-[0.4em]'

/** Wraps a chat: shows a PIN prompt instead of the conversation while the chat is locked. */
export function ChatLockGate({ chatId, children }) {
  const locked = useStore((s) => s.lockedChats.includes(chatId) && !s.unlockedChats.includes(chatId))
  const relock = useStore((s) => s.relockChat)

  // lock again when leaving the chat or hiding the tab
  useEffect(() => {
    const hide = () => document.visibilityState === 'hidden' && relock(chatId)
    document.addEventListener('visibilitychange', hide)
    return () => { document.removeEventListener('visibilitychange', hide); relock(chatId) }
  }, [chatId, relock])

  return locked ? <UnlockPanel chatId={chatId} /> : children
}

function UnlockPanel({ chatId }) {
  const chat = useStore((s) => s.chats[chatId])
  const me = useStore((s) => s.me)
  const unlock = useStore((s) => s.unlockChat)
  const removeAllLocks = useStore((s) => s.removeAllChatLocks)
  const toast = useStore((s) => s.toast)
  const [pin, setPinValue] = useState('')
  const [error, setError] = useState('')
  const [fails, setFails] = useState(0)
  const [waitUntil, setWaitUntil] = useState(0)
  const [, tick] = useState(0)
  const [reset, setReset] = useState(false)
  const [password, setPassword] = useState('')
  const ref = useRef()
  useEffect(() => { ref.current?.focus() }, [reset])
  useEffect(() => { if (!waitUntil) return; const t = setInterval(() => tick((n) => n + 1), 500); return () => clearInterval(t) }, [waitUntil])
  const waiting = Math.max(0, Math.ceil((waitUntil - Date.now()) / 1000))

  async function submit(e) {
    e.preventDefault()
    if (waiting > 0) return
    if (await verifyPin(pin)) return unlock(chatId)
    const n = fails + 1
    setFails(n); setPinValue(''); setError('Wrong PIN')
    if (n >= 3) setWaitUntil(Date.now() + Math.min(60, 5 * 2 ** (n - 3)) * 1000)
  }

  // Forgot PIN: re-enter the account password. This removes the PIN and ALL chat locks (it never reveals the PIN).
  async function resetWithPassword(e) {
    e.preventDefault()
    try {
      await api.post('/auth/login', { identifier: me.username, password })
      clearPin(); removeAllLocks()
      toast({ kind: 'info', title: 'Chat lock reset. All chats are unlocked.' })
    } catch (err) { setError(err.status === 401 ? 'Wrong password' : err.message) }
  }

  if (!chat) return null
  return (
    <div className="chat-bg flex min-w-0 flex-1 flex-col items-center justify-center gap-4 p-6 text-center" role="region" aria-label="Locked chat">
      <Avatar src={chatAvatar(chat)} name={chatTitle(chat)} size={80} />
      <div><h2 className="flex items-center justify-center gap-2 text-xl font-semibold"><Icon name="lock" className="h-5 w-5 text-wa-green" />{chatTitle(chat)}</h2>
        <p className="text-sm text-slate-500">This chat is locked. {reset ? 'Enter your account password to reset the chat lock.' : 'Enter your PIN to open it.'}</p></div>
      {!reset ? (
        <form onSubmit={submit} className="w-full max-w-xs space-y-3">
          <input ref={ref} type="password" inputMode="numeric" autoComplete="off" maxLength={8} value={pin} aria-label="PIN" placeholder="••••" className={`${field} text-2xl`}
            onChange={digits((v) => { setPinValue(v); setError('') })} />
          {error && <p role="alert" className="text-sm text-red-500">{waiting > 0 ? `Too many attempts. Try again in ${waiting}s` : error}</p>}
          <button className="btn-primary w-full" disabled={!validPin(pin) || waiting > 0}>Unlock chat</button>
          <button type="button" className="text-sm text-slate-500 underline" onClick={() => { setReset(true); setError('') }}>Forgot PIN?</button>
        </form>
      ) : (
        <form onSubmit={resetWithPassword} className="w-full max-w-xs space-y-3">
          <input ref={ref} type="password" autoComplete="current-password" value={password} aria-label="Account password" placeholder="Account password" className="input"
            onChange={(e) => { setPassword(e.target.value); setError('') }} />
          {error && <p role="alert" className="text-sm text-red-500">{error}</p>}
          <button className="btn-primary w-full" disabled={!password}>Reset chat lock</button>
          <button type="button" className="text-sm text-slate-500 underline" onClick={() => { setReset(false); setError('') }}>Back</button>
        </form>
      )}
    </div>
  )
}

/** Checkbox in chat info: lock / unlock this chat (one-to-one chats only). */
export function LockToggle({ chat }) {
  const locked = useStore((s) => s.lockedChats.includes(chat.id))
  const lockChat = useStore((s) => s.lockChat)
  const removeChatLock = useStore((s) => s.removeChatLock)
  const toast = useStore((s) => s.toast)
  const [form, setForm] = useState(null) // 'create' | 'remove'
  const [pin, setPinValue] = useState('')
  const [pin2, setPin2] = useState('')
  const [error, setError] = useState('')
  if (!isLockable(chat)) return null

  const close = () => { setForm(null); setPinValue(''); setPin2(''); setError('') }
  const onToggle = () => {
    if (locked) return setForm('remove')
    if (hasPin()) { lockChat(chat.id); toast({ kind: 'info', title: 'Chat locked. It will ask for your PIN next time.' }) } else setForm('create')
  }
  async function create(e) {
    e.preventDefault()
    if (!validPin(pin)) return setError('Use 4 to 8 digits')
    if (pin !== pin2) return setError('The two PINs do not match')
    await setPin(pin)
    lockChat(chat.id); close()
    toast({ kind: 'info', title: 'Chat locked. It will ask for your PIN next time.' })
  }
  async function remove(e) {
    e.preventDefault()
    if (!(await verifyPin(pin))) return setError('Wrong PIN')
    removeChatLock(chat.id); close()
    toast({ kind: 'info', title: 'Chat unlocked' })
  }

  return (
    <div className="divider px-4 py-2">
      <label className="flex cursor-pointer items-start gap-3 py-1 text-sm">
        <input type="checkbox" checked={locked} onChange={onToggle} className="mt-0.5 h-4 w-4 shrink-0 accent-wa-green" />
        <span className="flex-1"><span className="flex items-center gap-1.5 font-medium"><Icon name="lock" className="h-4 w-4" />Lock this chat</span>
          <span className="block text-xs text-slate-500">Needs your PIN to open. Hides its messages in the chat list, search and notifications on this device.</span></span>
      </label>
      {form === 'create' && (
        <form onSubmit={create} className="mt-2 space-y-2">
          <p className="text-xs text-slate-500">Create a PIN for locked chats (4–8 digits). You will use it for every locked chat.</p>
          <input className={field} type="password" inputMode="numeric" maxLength={8} placeholder="New PIN" value={pin} onChange={digits((v) => { setPinValue(v); setError('') })} aria-label="New PIN" autoFocus />
          <input className={field} type="password" inputMode="numeric" maxLength={8} placeholder="Repeat PIN" value={pin2} onChange={digits((v) => { setPin2(v); setError('') })} aria-label="Repeat PIN" />
          {error && <p role="alert" className="text-sm text-red-500">{error}</p>}
          <div className="flex gap-2"><button className="btn-primary flex-1" disabled={!validPin(pin) || !validPin(pin2)}>Set PIN and lock</button><button type="button" className="btn-ghost" onClick={close}>Cancel</button></div>
        </form>
      )}
      {form === 'remove' && (
        <form onSubmit={remove} className="mt-2 space-y-2">
          <input className={field} type="password" inputMode="numeric" maxLength={8} placeholder="Enter PIN to unlock this chat" value={pin} onChange={digits((v) => { setPinValue(v); setError('') })} aria-label="PIN" autoFocus />
          {error && <p role="alert" className="text-sm text-red-500">{error}</p>}
          <div className="flex gap-2"><button className="btn-primary flex-1" disabled={!validPin(pin)}>Remove lock</button><button type="button" className="btn-ghost" onClick={close}>Cancel</button></div>
        </form>
      )}
    </div>
  )
}

/** ⋮ menu → Chat lock: change the PIN, or remove every lock. */
export function ChatLockModal({ onClose }) {
  const count = useStore((s) => s.lockedChats.length)
  const removeAll = useStore((s) => s.removeAllChatLocks)
  const toast = useStore((s) => s.toast)
  const [mode, setMode] = useState('menu') // menu | change | remove
  const [current, setCurrent] = useState('')
  const [pin, setPinValue] = useState('')
  const [pin2, setPin2] = useState('')
  const [error, setError] = useState('')
  const enabled = hasPin()
  const back = () => { setMode('menu'); setCurrent(''); setPinValue(''); setPin2(''); setError('') }

  async function change(e) {
    e.preventDefault()
    if (!(await verifyPin(current))) return setError('Current PIN is wrong')
    if (!validPin(pin)) return setError('Use 4 to 8 digits')
    if (pin !== pin2) return setError('The two PINs do not match')
    await setPin(pin); back(); toast({ kind: 'info', title: 'PIN changed' })
  }
  async function removeEverything(e) {
    e.preventDefault()
    if (!(await verifyPin(current))) return setError('PIN is wrong')
    clearPin(); removeAll(); back(); toast({ kind: 'info', title: 'All chat locks removed' })
  }

  return (
    <Modal title="Chat lock" onClose={onClose}>
      <div className="space-y-4 p-5 text-sm">
        <p className="text-slate-500">Lock an individual one-to-one chat behind a PIN. Open a chat, tap its name, and tick <b>Lock this chat</b>. Groups and ChatFlow AI can’t be locked. Locks apply on this device only and hide content on screen; they are not encryption.</p>
        {!enabled ? <p className="rounded-lg bg-black/5 p-3 dark:bg-white/5">No chat lock PIN yet. You’ll be asked to create one the first time you lock a chat.</p> : (
          <>
            <p className="flex items-center gap-2 font-medium"><Icon name="lock" className="h-4 w-4 text-wa-green" />{count} locked chat{count === 1 ? '' : 's'}</p>
            {mode === 'menu' && (
              <div className="flex gap-2">
                <button className="btn-ghost flex-1 border border-slate-300 dark:border-slate-600" onClick={() => setMode('change')}>Change PIN</button>
                <button className="btn-ghost flex-1 border border-red-300 text-red-500 dark:border-red-900" onClick={() => setMode('remove')}>Remove all locks</button>
              </div>
            )}
            {mode === 'change' && (
              <form onSubmit={change} className="space-y-2">
                <input className={field} type="password" inputMode="numeric" maxLength={8} placeholder="Current PIN" value={current} onChange={digits((v) => { setCurrent(v); setError('') })} aria-label="Current PIN" autoFocus />
                <input className={field} type="password" inputMode="numeric" maxLength={8} placeholder="New PIN" value={pin} onChange={digits((v) => { setPinValue(v); setError('') })} aria-label="New PIN" />
                <input className={field} type="password" inputMode="numeric" maxLength={8} placeholder="Repeat new PIN" value={pin2} onChange={digits((v) => { setPin2(v); setError('') })} aria-label="Repeat new PIN" />
                {error && <p role="alert" className="text-red-500">{error}</p>}
                <div className="flex gap-2"><button className="btn-primary flex-1" disabled={!validPin(current) || !validPin(pin) || !validPin(pin2)}>Save new PIN</button><button type="button" className="btn-ghost" onClick={back}>Cancel</button></div>
              </form>
            )}
            {mode === 'remove' && (
              <form onSubmit={removeEverything} className="space-y-2">
                <input className={field} type="password" inputMode="numeric" maxLength={8} placeholder="Enter your PIN" value={current} onChange={digits((v) => { setCurrent(v); setError('') })} aria-label="PIN" autoFocus />
                {error && <p role="alert" className="text-red-500">{error}</p>}
                <div className="flex gap-2"><button className="btn-primary flex-1" disabled={!validPin(current)}>Remove PIN and all locks</button><button type="button" className="btn-ghost" onClick={back}>Cancel</button></div>
              </form>
            )}
          </>
        )}
      </div>
    </Modal>
  )
}
