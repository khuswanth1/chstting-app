import { API, getToken, mediaUrl } from './api'

/** Cross-origin files ignore <a download>, so fetch the bytes and save them via a blob URL. */
export async function downloadFile(url, filename) {
  const res = await fetch(mediaUrl(url))
  if (!res.ok) throw new Error('Download failed')
  const blob = await res.blob()
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = filename || url.split('/').pop()
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(a.href), 10000)
}

/** POST /backup for ONE person's chat (password re-checked on the server) and save the ZIP. Returns { size, filename }. */
export async function downloadBackup({ chatId, password, includeMedia }) {
  let res
  try {
    res = await fetch(`${API}/backup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${getToken()}` },
      body: JSON.stringify({ chat_id: chatId, password, include_media: includeMedia }),
    })
  } catch { throw new Error('Cannot reach the server') }
  if (!res.ok) {
    const d = await res.json().catch(() => null)
    throw new Error(typeof d?.detail === 'string' ? d.detail : `Backup failed (${res.status})`)
  }
  const filename = /filename="([^"]+)"/.exec(res.headers.get('Content-Disposition') || '')?.[1] || 'chatflow-backup.zip'
  const blob = await res.blob()
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(a.href), 15000)
  return { size: blob.size, filename }
}
