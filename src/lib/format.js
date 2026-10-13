export const timeOf = (iso) =>
  iso ? new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : ''

const startOfDay = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()

export function dayLabel(iso) {
  const d = new Date(iso)
  const diff = Math.round((startOfDay(new Date()) - startOfDay(d)) / 86400000)
  if (diff === 0) return 'Today'
  if (diff === 1) return 'Yesterday'
  if (diff < 7) return d.toLocaleDateString([], { weekday: 'long' })
  return d.toLocaleDateString([], { day: 'numeric', month: 'short', year: 'numeric' })
}

export const sameDay = (a, b) => startOfDay(new Date(a)) === startOfDay(new Date(b))

export function listTime(iso) {
  if (!iso) return ''
  const d = new Date(iso)
  const diff = Math.round((startOfDay(new Date()) - startOfDay(d)) / 86400000)
  if (diff === 0) return timeOf(iso)
  if (diff === 1) return 'Yesterday'
  if (diff < 7) return d.toLocaleDateString([], { weekday: 'short' })
  return d.toLocaleDateString([], { day: '2-digit', month: '2-digit', year: '2-digit' })
}

export function presenceText(u) {
  if (!u) return ''
  if (u.is_online) return 'online'
  if (!u.last_seen) return ''
  return `last seen ${dayLabel(u.last_seen).toLowerCase()} at ${timeOf(u.last_seen)}`
}

export function fileSize(n) {
  if (n < 1024) return `${n} B`
  if (n < 1048576) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / 1048576).toFixed(1)} MB`
}

export const clock = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`

export function chatTitle(chat) {
  return chat.type === 'group' ? chat.name : chat.peer?.display_name || 'Unknown'
}

export function chatAvatar(chat) {
  return chat.type === 'group' ? chat.avatar_url : chat.peer?.avatar_url
}

export function previewText(m) {
  if (!m) return ''
  if (m.deleted) return '🚫 This message was deleted'
  if (m.type === 'videonote') return '📹 Video message'
  if (m.type === 'sticker') return `${m.body.split('\n')[0]} Sticker`
  const icon = { image: '📷 Photo', video: '🎥 Video', audio: '🎤 Voice message', document: '📄 Document' }[m.type]
  if (icon) return m.body ? `${icon.split(' ')[0]} ${m.body}` : icon
  return m.body || ''
}

/** "Today, 03:37 PM" - day label plus clock time (no duplicated time). */
export function whenText(iso) {
  return iso ? `${dayLabel(iso)}, ${timeOf(iso)}` : ''
}
