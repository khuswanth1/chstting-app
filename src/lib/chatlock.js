// Chat lock: individual one-to-one chats can be hidden behind a PIN on THIS device.
// Only a salted PBKDF2 hash of the PIN is stored. The list of locked chats is kept per account in localStorage.
// This hides content on screen; it is not encryption and does not replace your operating-system lock.
const PIN_KEY = 'cf_chatlock'
const listKey = (userId) => `cf_locked_${userId}`
const ITER = 150000

try { localStorage.removeItem('cf_applock') } catch { /* the old whole-app lock no longer exists */ }

const enc = new TextEncoder()
const toHex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('')
const fromHex = (hex) => new Uint8Array(hex.match(/.{2}/g).map((h) => parseInt(h, 16)))

async function derive(pin, saltHex, iterations) {
  const key = await crypto.subtle.importKey('raw', enc.encode(pin), 'PBKDF2', false, ['deriveBits'])
  return toHex(await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: fromHex(saltHex), iterations }, key, 256))
}

const read = (key) => { try { return JSON.parse(localStorage.getItem(key) || 'null') } catch { return null } }
const write = (key, v) => { try { v == null ? localStorage.removeItem(key) : localStorage.setItem(key, JSON.stringify(v)) } catch { /* storage unavailable */ } }

export const validPin = (pin) => /^\d{4,8}$/.test(pin)
export const hasPin = () => !!read(PIN_KEY)?.hash

export async function setPin(pin) {
  if (!validPin(pin)) throw new Error('PIN must be 4 to 8 digits')
  const salt = toHex(crypto.getRandomValues(new Uint8Array(16)))
  write(PIN_KEY, { salt, iter: ITER, hash: await derive(pin, salt, ITER) })
}

export async function verifyPin(pin) {
  const cur = read(PIN_KEY)
  if (!cur?.hash || !validPin(pin)) return false
  const h = await derive(pin, cur.salt, cur.iter || ITER)
  let diff = h.length ^ cur.hash.length
  for (let i = 0; i < h.length; i++) diff |= h.charCodeAt(i) ^ (cur.hash.charCodeAt(i) || 0)
  return diff === 0
}

export const clearPin = () => write(PIN_KEY, null)
export const getLockedIds = (userId) => (read(listKey(userId)) || []).filter((n) => Number.isInteger(n))
export const saveLockedIds = (userId, ids) => write(listKey(userId), ids.length ? ids : null)
