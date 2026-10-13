import { useEffect } from 'react'
import { mediaUrl } from '../lib/api'

const P = {
  search: <><circle cx="11" cy="11" r="8" /><path d="m21 21-4.3-4.3" /></>,
  send: <><path d="m22 2-7 20-4-9-9-4z" /><path d="M22 2 11 13" /></>,
  paperclip: <path d="m21.4 11.1-9.2 9.2a6 6 0 0 1-8.5-8.5l9.2-9.2a4 4 0 0 1 5.7 5.7l-9.2 9.2a2 2 0 0 1-2.8-2.8l8.5-8.5" />,
  smile: <><circle cx="12" cy="12" r="10" /><path d="M8 14s1.5 2 4 2 4-2 4-2M9 9h.01M15 9h.01" /></>,
  mic: <><path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3z" /><path d="M19 10v2a7 7 0 0 1-14 0v-2M12 19v3" /></>,
  micOff: <><path d="m2 2 20 20" /><path d="M9 9v3a3 3 0 0 0 5.1 2.1M15 9.3V5a3 3 0 0 0-5.9-.7M19 10v2a7 7 0 0 1-.9 3.4M5 10v2a7 7 0 0 0 11 5.7M12 19v3" /></>,
  phone: <path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1 1 .4 1.9.7 2.8a2 2 0 0 1-.5 2.1L8.1 9.9a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.8.6 2.8.7a2 2 0 0 1 1.7 2z" />,
  video: <><path d="m23 7-7 5 7 5V7z" /><rect x="1" y="5" width="15" height="14" rx="2" /></>,
  videoOff: <><path d="m2 2 20 20" /><path d="M16 16v1a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h2m5.7 0H14a2 2 0 0 1 2 2v3.3l1 1L23 7v10" /></>,
  more: <><circle cx="12" cy="5" r="1" /><circle cx="12" cy="12" r="1" /><circle cx="12" cy="19" r="1" /></>,
  x: <path d="M18 6 6 18M6 6l12 12" />,
  back: <path d="M19 12H5M12 19l-7-7 7-7" />,
  plus: <path d="M12 5v14M5 12h14" />,
  chat: <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />,
  status: <><circle cx="12" cy="12" r="9" strokeDasharray="3.2 3" /><circle cx="12" cy="12" r="3" /></>,
  settings: <><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" /></>,
  bell: <><path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" /><path d="M13.7 21a2 2 0 0 1-3.4 0" /></>,
  check: <path d="M20 6 9 17l-5-5" />,
  users: <><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M23 21v-2a4 4 0 0 0-3-3.9M16 3.1a4 4 0 0 1 0 7.8" /></>,
  user: <><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" /><circle cx="12" cy="7" r="4" /></>,
  reply: <><path d="M9 17 4 12l5-5" /><path d="M20 18v-2a4 4 0 0 0-4-4H4" /></>,
  forward: <><path d="m15 17 5-5-5-5" /><path d="M4 18v-2a4 4 0 0 1 4-4h12" /></>,
  trash: <path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6" />,
  edit: <><path d="M12 20h9" /><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z" /></>,
  file: <><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><path d="M14 2v6h6" /></>,
  image: <><rect x="3" y="3" width="18" height="18" rx="2" /><circle cx="8.5" cy="8.5" r="1.5" /><path d="m21 15-5-5L5 21" /></>,
  logout: <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9" />,
  camera: <><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" /><circle cx="12" cy="13" r="4" /></>,
  down: <path d="m6 9 6 6 6-6" />,
  copy: <><rect x="9" y="9" width="13" height="13" rx="2" /><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" /></>,
  block: <><circle cx="12" cy="12" r="10" /><path d="m4.9 4.9 14.2 14.2" /></>,
  play: <path d="M6 4l14 8-14 8z" />,
  stop: <rect x="6" y="6" width="12" height="12" rx="1" />,
  sun: <><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" /></>,
  moon: <path d="M21 12.8A9 9 0 1 1 11.2 3 7 7 0 0 0 21 12.8z" />,
  eye: <><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8S1 12 1 12z" /><circle cx="12" cy="12" r="3" /></>,
  link: <><path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7" /><path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7" /></>,
  volume: <><path d="M11 5 6 9H2v6h4l5 4V5z" /><path d="M15.5 8.5a5 5 0 0 1 0 7M19 5a9 9 0 0 1 0 14" /></>,
  volumeOff: <><path d="M11 5 6 9H2v6h4l5 4V5z" /><path d="m22 9-6 6M16 9l6 6" /></>,
  userPlus: <><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M19 8v6M22 11h-6" /></>,
  star: <path d="M12 2l3.1 6.3 6.9 1-5 4.9 1.2 6.8-6.2-3.3-6.2 3.3L7 14.2 2 9.3l6.9-1z" />,
  archive: <><path d="M21 8v13H3V8" /><path d="M1 3h22v5H1z" /><path d="M10 12h4" /></>,
  checkSquare: <><path d="m9 11 3 3L22 4" /><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" /></>,
  readAll: <><path d="M18 6 7 17l-5-5" /><path d="m22 10-7.5 7.5L13 16" /></>,
  lock: <><rect x="3" y="11" width="18" height="11" rx="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" /></>,
  pushpin: <path d="M12 17v5M9 3h6l-1 7 3 3H7l3-3z" />,
  sparkles: <><path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z" /><path d="M19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8zM5 3l.6 1.4L7 5l-1.4.6L5 7l-.6-1.4L3 5l1.4-.6z" /></>,
  pin: <><path d="M12 22s8-6.6 8-13a8 8 0 1 0-16 0c0 6.4 8 13 8 13z" /><circle cx="12" cy="9" r="3" /></>,
}

export function Icon({ name, className = '', fill }) {
  // callers often pass only a colour class; without a size the svg would stretch to fill its parent
  const sized = /(^|\s)(size|h|w)-/.test(className) ? className : `h-5 w-5 ${className}`.trim()
  return (
    <svg viewBox="0 0 24 24" className={sized} fill={fill || 'none'} stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {P[name]}
    </svg>
  )
}

const COLORS = ['#e57373', '#f06292', '#ba68c8', '#7986cb', '#4fc3f7', '#4db6ac', '#81c784', '#ffb74d', '#a1887f', '#90a4ae']

export function Avatar({ src, name = '?', size = 40, online, group, className = '' }) {
  const hash = [...name].reduce((a, c) => a + c.charCodeAt(0), 0)
  const url = mediaUrl(src)
  if (name === 'ChatFlow AI') {
    return (
      <div className={`relative shrink-0 ${className}`} style={{ width: size, height: size }}>
        <div className="flex h-full w-full items-center justify-center rounded-full bg-gradient-to-br from-violet-500 via-fuchsia-500 to-amber-400 text-white"><Icon name="sparkles" className="h-1/2 w-1/2" /></div>
      </div>
    )
  }
  return (
    <div className={`relative shrink-0 ${className}`} style={{ width: size, height: size }}>
      {url ? (
        <img src={url} alt="" className="h-full w-full rounded-full object-cover" loading="lazy" />
      ) : (
        <div className="flex h-full w-full items-center justify-center rounded-full font-semibold text-white" style={{ background: COLORS[hash % COLORS.length], fontSize: size * 0.4 }}>
          {group ? <Icon name="users" className="h-1/2 w-1/2" /> : (name.trim()[0] || '?').toUpperCase()}
        </div>
      )}
      {online && <span className="absolute bottom-0 right-0 h-3 w-3 rounded-full border-2 border-white bg-wa-green dark:border-wa-night" />}
    </div>
  )
}

export function Modal({ title, onClose, children, wide }) {
  useEffect(() => {
    const h = (e) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [onClose])
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-0 sm:items-center sm:p-4" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div role="dialog" aria-label={title} className={`pop card flex max-h-[90vh] w-full flex-col overflow-hidden rounded-b-none sm:rounded-b-xl ${wide ? 'sm:max-w-xl' : 'sm:max-w-md'}`}>
        <div className="divider flex items-center justify-between px-4 py-3">
          <h2 className="text-base font-semibold">{title}</h2>
          <button className="icon-btn" onClick={onClose} aria-label="Close"><Icon name="x" /></button>
        </div>
        <div className="scroll-thin min-h-0 flex-1 overflow-y-auto">{children}</div>
      </div>
    </div>
  )
}

export function Tick({ status }) {
  if (!status) return null
  const color = status === 'read' ? 'text-sky-500' : 'text-slate-400 dark:text-slate-400'
  return (
    <svg viewBox="0 0 18 12" className={`inline h-3 w-4 ${color}`} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-label={status}>
      {status === 'sent' ? <path d="m4 6.5 3 3L14 2" /> : <><path d="m1 6.500 3 3L11 2" /><path d="m7 9.500 1 .5L16 2" /></>}
    </svg>
  )
}

export function Spinner() {
  return <div className="mx-auto h-6 w-6 animate-spin rounded-full border-2 border-wa-green border-t-transparent" />
}

export function Empty({ icon = 'chat', title, children }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 p-8 text-center text-slate-500">
      <Icon name={icon} className="h-10 w-10 opacity-40" />
      <p className="font-medium">{title}</p>
      {children && <p className="text-sm">{children}</p>}
    </div>
  )
}

export function Toggle({ checked, onChange, label, hint }) {
  return (
    <label className="flex cursor-pointer items-center justify-between gap-4 py-2">
      <span><span className="block text-sm">{label}</span>{hint && <span className="block text-xs text-slate-500">{hint}</span>}</span>
      <input type="checkbox" role="switch" className="peer sr-only" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span className="relative h-6 w-11 shrink-0 rounded-full bg-slate-300 transition peer-checked:bg-wa-green peer-focus-visible:ring-2 dark:bg-slate-600">
        <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all ${checked ? 'left-[22px]' : 'left-0.5'}`} />
      </span>
    </label>
  )
}
