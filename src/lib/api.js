export const API = (import.meta.env.VITE_API_URL || 'http://localhost:8000').replace(/\/$/, '')
export const WS_URL = API.replace(/^http/, 'ws') + '/ws'

export const mediaUrl = (u) => (!u ? null : /^https?:/.test(u) ? u : API + u)

let token = null
try { token = localStorage.getItem('cf_token') } catch { /* storage unavailable */ }
export const getToken = () => token
export function setToken(t) {
  token = t
  try { t ? localStorage.setItem('cf_token', t) : localStorage.removeItem('cf_token') } catch { /* ignore */ }
}

let onUnauthorized = () => {}
export const setUnauthorizedHandler = (fn) => { onUnauthorized = fn }

function errorMessage(data, status) {
  const d = data?.detail
  if (typeof d === 'string') return d
  if (Array.isArray(d) && d[0]) return `${(d[0].loc || []).slice(1).join('.') || 'input'}: ${d[0].msg}`
  return `Request failed (${status})`
}

async function request(method, path, body, form) {
  const headers = {}
  if (token) headers.Authorization = `Bearer ${token}`
  let payload
  if (form) payload = form
  else if (body !== undefined) { headers['Content-Type'] = 'application/json'; payload = JSON.stringify(body) }
  let res
  try { res = await fetch(API + path, { method, headers, body: payload }) }
  catch { throw Object.assign(new Error('Cannot reach the server'), { status: 0 }) }
  if (res.status === 204) return null
  const data = await res.json().catch(() => null)
  if (!res.ok) {
    if (res.status === 401 && token && !path.startsWith('/auth/login')) onUnauthorized()
    throw Object.assign(new Error(errorMessage(data, res.status)), { status: res.status })
  }
  return data
}

export const api = {
  get: (p) => request('GET', p),
  post: (p, b) => request('POST', p, b ?? {}),
  put: (p, b) => request('PUT', p, b),
  patch: (p, b) => request('PATCH', p, b),
  del: (p) => request('DELETE', p),
  upload(path, file, extra = {}) {
    const f = new FormData()
    f.append('file', file, file.name)
    Object.entries(extra).forEach(([k, v]) => v != null && f.append(k, v))
    return request('POST', path, undefined, f)
  },
}
