import { useEffect, useRef, useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { api } from '../lib/api'
import { useStore } from '../store'
import ThemeToggle from './ThemeToggle'
import { Icon } from './ui'

export default function Auth({ mode: initialMode = 'login' }) {
  const authenticate = useStore((s) => s.authenticate)
  const navigate = useNavigate()
  const location = useLocation()
  const [mode, setMode] = useState(initialMode)
  const [f, setF] = useState({ identifier: '', username: '', email: '', display_name: '', phone: '', password: '' })
  const [photo, setPhoto] = useState(null)
  const fileRef = useRef()
  const preview = photo ? URL.createObjectURL(photo) : null
  useEffect(() => () => preview && URL.revokeObjectURL(preview), [preview])
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value })

  useEffect(() => {
    setMode(initialMode)
    setErr('')
  }, [initialMode])

  async function submit(e) {
    e.preventDefault()
    setErr('')
    setBusy(true)
    try {
      if (mode === 'login') {
        await authenticate('/auth/login', { identifier: f.identifier, password: f.password })
      } else {
        await authenticate('/auth/register', { username: f.username, email: f.email, display_name: f.display_name || undefined, phone: f.phone, password: f.password })
        if (photo) {
          try { useStore.getState().setMe(await api.upload('/users/me/avatar', photo)) }
          catch (upErr) { useStore.getState().toast({ kind: 'error', title: `Account created, but the photo failed: ${upErr.message}` }) }
        }
      }
      const from = location.state?.from?.pathname || '/chats'
      navigate(from, { replace: true })
    } catch (e2) {
      setErr(e2.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="relative flex min-h-full items-center justify-center bg-gradient-to-b from-wa-greenDark to-wa-green p-4 dark:from-wa-panel dark:to-wa-night">
      <ThemeToggle className="absolute right-3 top-3 !text-white hover:!bg-white/20" />
      <form onSubmit={submit} className="card w-full max-w-sm space-y-4 p-6 shadow-2xl">
        <div className="flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-wa-green text-white shadow-md">
            <Icon name="chat" className="h-6 w-6" fill="currentColor" />
          </div>
          <div>
            <h1 className="text-xl font-bold">ChatFlow</h1>
            <p className="text-xs text-slate-500">{mode === 'login' ? 'Welcome back' : 'Create your account'}</p>
          </div>
        </div>
        {mode === 'login' ? (
          <input className="input" placeholder="Username, email or phone number" value={f.identifier} onChange={set('identifier')} required autoFocus autoComplete="username" />
        ) : (
          <>
            <div className="flex items-center gap-4">
              <input ref={fileRef} type="file" hidden accept="image/jpeg,image/png,image/gif,image/webp"
                onChange={(e) => { const file = e.target.files[0]; e.target.value = ''; if (!file) return; if (file.size > 5 * 1024 * 1024) return setErr('Photo must be under 5 MB'); setErr(''); setPhoto(file) }} />
              <button type="button" onClick={() => fileRef.current.click()} className="group relative h-20 w-20 shrink-0 overflow-hidden rounded-full border-2 border-dashed border-slate-300 bg-wa-bg dark:border-slate-600 dark:bg-wa-night" aria-label="Choose profile photo">
                {preview ? <img src={preview} alt="Your profile photo" className="h-full w-full object-cover" /> : <Icon name="camera" className="mx-auto h-7 w-7 text-slate-400" />}
                <span className="absolute inset-x-0 bottom-0 bg-black/50 py-0.5 text-[10px] text-white">{preview ? 'Change' : 'Add photo'}</span>
              </button>
              <div className="min-w-0 flex-1 text-xs text-slate-500">
                <p className="font-medium text-slate-700 dark:text-slate-200">Profile photo</p>
                <p>Optional. JPG, PNG, GIF or WebP, up to 5 MB.</p>
                {photo && <button type="button" className="mt-1 text-red-500" onClick={() => setPhoto(null)}>Remove</button>}
              </div>
            </div>
            <input className="input" placeholder="Username (letters, numbers, _ .)" value={f.username} onChange={set('username')} required minLength={3} maxLength={32} autoFocus autoComplete="username" />
            <input className="input" type="email" placeholder="Email" value={f.email} onChange={set('email')} required autoComplete="email" />
            <input className="input" type="tel" inputMode="tel" placeholder="Phone number, e.g. +14155550123" value={f.phone} onChange={set('phone')} required title="Include your country code, e.g. +14155550123" maxLength={32} autoComplete="tel" />
            <input className="input" placeholder="Display name (optional)" value={f.display_name} onChange={set('display_name')} maxLength={64} />
          </>
        )}
        <input className="input" type="password" placeholder="Password (min 8 characters)" value={f.password} onChange={set('password')} required minLength={mode === 'login' ? 1 : 8} autoComplete={mode === 'login' ? 'current-password' : 'new-password'} />
        {err && <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600 dark:bg-red-950 dark:text-red-300">{err}</p>}
        <button className="btn-primary w-full" disabled={busy}>{busy ? 'Please wait…' : mode === 'login' ? 'Log in' : 'Sign up'}</button>
        <p className="text-center text-sm text-slate-500">
          {mode === 'login' ? 'New to ChatFlow? ' : 'Already have an account? '}
          <Link
            to={mode === 'login' ? '/register' : '/login'}
            className="font-medium text-wa-greenDark hover:underline dark:text-wa-green"
          >
            {mode === 'login' ? 'Create an account' : 'Log in'}
          </Link>
        </p>
      </form>
    </div>
  )
}

