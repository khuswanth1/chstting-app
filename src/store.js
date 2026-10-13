import { create } from 'zustand'
import { api, getToken, setToken, setUnauthorizedHandler } from './lib/api'
import { Socket } from './lib/socket'
import { beep, desktopNotify } from './lib/alerts'
import { chatTitle, previewText } from './lib/format'
import { getLockedIds, saveLockedIds } from './lib/chatlock'
import { handleCallEvent, resetCall } from './lib/call'
import { dropGroupCall, handleGroupCallEvent, loadActiveRooms, resetGroupCall } from './lib/groupcall'

const PAGE = 30
let socket = null
const typingTimers = {}
const reloadTimers = {}

export const sendWs = (obj) => socket?.send(obj) ?? false
const isFocused = () => document.hasFocus() && document.visibilityState === 'visible'

const readAiTop = () => {
  try { return localStorage.getItem('cf_ai_top') !== '0' } catch { return true }
}

export function getStoredTheme() {
  try { return localStorage.getItem('cf_theme') } catch { return null }
}

export function applyTheme(theme) {
  try { localStorage.setItem('cf_theme', theme) } catch { /* storage unavailable */ }
  const dark = theme === 'dark' || (theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches)
  document.documentElement.classList.toggle('dark', dark)
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', dark ? '#202c33' : '#008069')
}

const mergeMsg = (list, msg) => {
  const i = list.findIndex((m) => m.id === msg.id)
  if (i >= 0) { const c = list.slice(); c[i] = msg; return c }
  return [...list, msg].sort((a, b) => a.id - b.id)
}

export const useStore = create((set, get) => ({
  token: getToken(),
  me: null,
  booting: !!getToken(),
  wsOpen: false,
  chats: {},
  messages: {},
  activeChatId: null,
  typing: {},
  feed: [],
  notifications: { items: [], unread: 0 },
  toasts: [],
  call: null,
  gcall: null,
  groupRooms: {},
  tab: 'chats',
  modal: null, // 'new' | 'group' | 'notifs' | 'sendDoc' | 'starred' | 'chatlock'
  lockedChats: [], // one-to-one chat ids locked on this device (per account)
  unlockedChats: [], // unlocked for this visit; they lock again when you leave the chat
  chatView: 'all', // 'all' | 'archived'
  selecting: false, // multi-select mode in the chat list
  selected: [],
  starredIds: {},
  aiAtTop: readAiTop(), // keep ChatFlow AI fixed at the top of the chat list

  // ---------- session ----------
  async boot() {
    if (!getToken()) return set({ booting: false })
    try {
      const me = await api.get('/auth/me')
      set({ me, token: getToken() })
      applyTheme(me.settings.theme)
      await get().start()
    } catch {
      setToken(null)
      set({ token: null, me: null })
    } finally {
      set({ booting: false })
    }
  },

  async authenticate(path, body) {
    const res = await api.post(path, body)
    setToken(res.access_token)
    set({ token: res.access_token, me: res.user })
    applyTheme(res.user.settings.theme)
    await get().start()
  },

  async start() {
    set({ lockedChats: getLockedIds(get().me.id), unlockedChats: [] })
    socket?.close()
    socket = new Socket({
      onEvent: (e) => get().handleEvent(e),
      onStatus: (s) => {
        set({ wsOpen: s === 'open' })
        if (s === 'open') get().resync()
      },
    })
    socket.connect(getToken())
    await Promise.all([get().loadChats(), get().loadNotifications(), get().loadFeed(), loadActiveRooms(), get().loadStarred()])
  },

  /** After a (re)connect, refresh anything we may have missed while offline. */
  async resync() {
    if (!get().me) return
    dropGroupCall() // the server drops us from group calls when the socket closes
    await Promise.all([get().loadChats(), loadActiveRooms()])
    const { activeChatId } = get()
    if (activeChatId) get().reloadMessages(activeChatId)
  },

  logout() {
    api.post('/auth/logout').catch(() => {})
    socket?.close()
    socket = null
    resetCall()
    resetGroupCall()
    setToken(null)
    set({ token: null, me: null, chats: {}, messages: {}, activeChatId: null, feed: [], call: null, gcall: null, groupRooms: {}, lockedChats: [], unlockedChats: [], chatView: 'all', selecting: false, selected: [], starredIds: {}, modal: null,
      notifications: { items: [], unread: 0 }, tab: 'chats', wsOpen: false })
  },

  setMe: (me) => set({ me }),
  setTab: (tab) => set({ tab }),
  setModal: (modal) => set({ modal }),
  isChatHidden: (id) => get().lockedChats.includes(id) && !get().unlockedChats.includes(id),
  lockChat(id) {
    const ids = [...new Set([...get().lockedChats, id])]
    saveLockedIds(get().me.id, ids)
    // the chat is open right now, so it stays open for this visit and asks for the PIN next time
    set((st) => ({ lockedChats: ids, unlockedChats: st.unlockedChats.includes(id) ? st.unlockedChats : [...st.unlockedChats, id] }))
  },
  removeChatLock(id) {
    const ids = get().lockedChats.filter((x) => x !== id)
    saveLockedIds(get().me.id, ids)
    set({ lockedChats: ids, unlockedChats: get().unlockedChats.filter((x) => x !== id) })
  },
  removeAllChatLocks() {
    saveLockedIds(get().me.id, [])
    set({ lockedChats: [], unlockedChats: [] })
  },
  unlockChat(id) {
    set((s) => ({ unlockedChats: s.unlockedChats.includes(id) ? s.unlockedChats : [...s.unlockedChats, id] }))
    get().markRead(id) // only now has the user actually seen the messages
  },
  relockChat: (id) => set((s) => (s.unlockedChats.includes(id) ? { unlockedChats: s.unlockedChats.filter((x) => x !== id) } : {})),
  setAiAtTop: (on) => {
    try { localStorage.setItem('cf_ai_top', on ? '1' : '0') } catch { /* storage unavailable */ }
    set({ aiAtTop: on })
  },
  setChatView: (chatView) => set({ chatView, selecting: false, selected: [] }),
  startSelecting: () => set({ selecting: true, selected: [] }),
  stopSelecting: () => set({ selecting: false, selected: [] }),
  toggleSelected: (id) => set((s) => ({ selected: s.selected.includes(id) ? s.selected.filter((x) => x !== id) : [...s.selected, id] })),

  /** Pin or unpin one chat. The list updates immediately and rolls back if the server refuses (e.g. 3-pin limit). */
  async togglePin(chatId) {
    const chat = get().chats[chatId]
    if (!chat) return
    const next = !chat.pinned
    get().patchChat(chatId, { pinned: next, ...(next ? { archived: false } : {}) })
    try {
      get().upsertChat(await api.patch(`/chats/${chatId}/me`, { pinned: next }))
      get().toast({ kind: 'info', title: next ? 'Chat pinned to the top' : 'Chat unpinned', duration: 2500 })
    } catch (e) {
      get().patchChat(chatId, { pinned: chat.pinned, archived: chat.archived })
      get().error(e)
    }
  },

  /** Apply muted / archived / pinned to several chats; returns how many failed. */
  async setChatPrefs(ids, prefs) {
    const results = await Promise.allSettled(ids.map((id) => api.patch(`/chats/${id}/me`, prefs)))
    results.forEach((r) => r.status === 'fulfilled' && get().upsertChat(r.value))
    const failed = results.filter((r) => r.status === 'rejected')
    if (failed.length) get().error(failed[0].reason)
    return failed.length
  },

  async markAllRead() {
    try {
      const r = await api.post('/chats/read-all', {})
      set((s) => ({ chats: Object.fromEntries(Object.entries(s.chats).map(([id, c]) => [id, { ...c, unread_count: 0 }])) }))
      get().toast({ kind: 'info', title: r.chats ? `Marked ${r.chats} chat${r.chats === 1 ? '' : 's'} as read` : 'Everything is already read' })
    } catch (e) { get().error(e) }
  },

  async loadStarred() {
    try { set({ starredIds: Object.fromEntries((await api.get('/starred/ids')).ids.map((i) => [i, true])) }) } catch { /* ignore */ }
  },
  async toggleStar(messageId, on) {
    const was = !!get().starredIds[messageId]
    const next = on ?? !was
    set((s) => { const ids = { ...s.starredIds }; next ? (ids[messageId] = true) : delete ids[messageId]; return { starredIds: ids } })
    try { next ? await api.put(`/messages/${messageId}/star`, {}) : await api.del(`/messages/${messageId}/star`) }
    catch (e) {
      set((s) => { const ids = { ...s.starredIds }; was ? (ids[messageId] = true) : delete ids[messageId]; return { starredIds: ids } })
      get().error(e)
    }
  },

  toast(t) {
    const id = Math.random().toString(36).slice(2)
    set((s) => ({ toasts: [...s.toasts, { id, ...t }].slice(-4) }))
    setTimeout(() => get().dismissToast(id), t.duration ?? 5000)
  },
  dismissToast: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
  error: (e) => get().toast({ kind: 'error', title: e.message || String(e) }),

  // ---------- chats ----------
  async loadChats() {
    const list = await api.get('/chats?limit=100')
    set({ chats: Object.fromEntries(list.map((c) => [c.id, c])) })
  },
  upsertChat: (chat) => set((s) => ({ chats: { ...s.chats, [chat.id]: chat } })),
  patchChat: (id, patch) => set((s) => (s.chats[id] ? { chats: { ...s.chats, [id]: { ...s.chats[id], ...patch } } } : {})),
  async refreshChat(id) {
    try { get().upsertChat(await api.get(`/chats/${id}`)) } catch { /* removed */ }
  },
  async openChat(id) {
    set({ activeChatId: id, tab: 'chats' })
    if (id == null) return
    if (!get().messages[id]?.loaded) await get().loadMessages(id)
    get().markRead(id)
  },
  async openAiChat() {
    try {
      const chat = await api.post('/ai/chat')
      get().upsertChat(chat)
      await get().openChat(chat.id)
      return chat
    } catch (e) { get().error(e); throw e }
  },
  async openDirect(userId) {
    const chat = await api.post('/chats/direct', { user_id: userId })
    get().upsertChat(chat)
    await get().openChat(chat.id)
    return chat
  },

  // ---------- messages ----------
  async loadMessages(chatId, older = false) {
    const cur = get().messages[chatId]
    if (cur?.loading) return
    set((s) => ({ messages: { ...s.messages, [chatId]: { items: [], hasMore: false, ...cur, loading: true } } }))
    try {
      const before = older && cur?.items[0] ? `&before_id=${cur.items[0].id}` : ''
      const page = await api.get(`/chats/${chatId}/messages?limit=${PAGE}${before}`)
      set((s) => {
        const prev = s.messages[chatId]?.items || []
        const items = older ? [...page.items, ...prev] : page.items
        return { messages: { ...s.messages, [chatId]: { items, hasMore: page.has_more, loading: false, loaded: true } } }
      })
    } catch (e) {
      set((s) => ({ messages: { ...s.messages, [chatId]: { ...s.messages[chatId], loading: false } } }))
      get().error(e)
    }
  },
  reloadMessages(chatId) {
    clearTimeout(reloadTimers[chatId])
    reloadTimers[chatId] = setTimeout(async () => {
      if (!get().messages[chatId]?.loaded) return
      try {
        const page = await api.get(`/chats/${chatId}/messages?limit=${PAGE}`)
        set((s) => {
          const old = s.messages[chatId]
          const oldest = page.items[0]?.id ?? Infinity
          const keep = old.items.filter((m) => m.id < oldest)
          return { messages: { ...s.messages, [chatId]: { ...old, items: [...keep, ...page.items], hasMore: keep.length ? old.hasMore : page.has_more } } }
        })
      } catch { /* ignore */ }
    }, 250)
  },

  async sendMessage(chatId, { body, replyTo, files = [], voice = null, sticker = null, videoNote = null }) {
    const text = (body || '').trim()
    try {
      if (videoNote) {
        const up = await api.upload('/uploads', videoNote.file, { duration: videoNote.duration })
        await api.post(`/chats/${chatId}/messages`, { attachment_ids: [up.id], video_note: true, reply_to_id: replyTo?.id ?? null })
        return
      }
      if (sticker) {
        const stickerBody = sticker.caption ? `${sticker.emoji}\n${sticker.caption}` : sticker.emoji
        const ok = sendWs({ type: 'message.send', chat_id: chatId, body: stickerBody, sticker: true, reply_to_id: replyTo?.id ?? null, client_id: Math.random().toString(36).slice(2) })
        if (!ok) await api.post(`/chats/${chatId}/messages`, { body: stickerBody, sticker: true, reply_to_id: replyTo?.id ?? null })
        return
      }
      if (!files.length && !voice) {
        if (!text) return
        const ok = sendWs({ type: 'message.send', chat_id: chatId, body: text, reply_to_id: replyTo?.id ?? null, client_id: Math.random().toString(36).slice(2) })
        if (!ok) await api.post(`/chats/${chatId}/messages`, { body: text, reply_to_id: replyTo?.id ?? null })
        return
      }
      const uploads = []
      for (const f of files) uploads.push(await api.upload('/uploads', f))
      if (voice) uploads.push(await api.upload('/uploads', voice.file, { duration: voice.duration, voice: true }))
      // one message per attachment; caption + reply go on the first
      for (let i = 0; i < uploads.length; i++) {
        await api.post(`/chats/${chatId}/messages`, {
          body: i === 0 ? text || null : null, reply_to_id: i === 0 ? replyTo?.id ?? null : null, attachment_ids: [uploads[i].id],
        })
      }
    } catch (e) { get().error(e); throw e }
  },

  markRead(chatId) {
    const chat = get().chats[chatId]
    if (!chat || get().isChatHidden(chatId)) return
    if (chat.unread_count > 0) get().patchChat(chatId, { unread_count: 0 })
    if (!sendWs({ type: 'message.read', chat_id: chatId })) api.post(`/chats/${chatId}/read`, {}).catch(() => {})
  },

  async loadNotifications() {
    set({ notifications: await api.get('/notifications') })
  },
  async loadFeed() {
    try { set({ feed: await api.get('/statuses') }) } catch { /* ignore */ }
  },

  // ---------- realtime ----------
  handleEvent(e) {
    const s = get()
    const me = s.me
    if (!me) return
    switch (e.type) {
      case 'message.new': {
        const m = e.message
        const mine = m.sender_id === me.id
        const chat = s.chats[m.chat_id]
        if (!chat) { s.refreshChat(m.chat_id).then(() => get().afterNewMessage(m)); break }
        s.afterNewMessage(m)
        break
      }
      case 'message.updated': {
        const m = e.message
        set((st) => {
          const box = st.messages[m.chat_id]
          return box ? { messages: { ...st.messages, [m.chat_id]: { ...box, items: mergeMsg(box.items, m) } } } : {}
        })
        if (s.chats[m.chat_id]?.last_message?.id === m.id) s.patchChat(m.chat_id, { last_message: m })
        break
      }
      case 'message.deleted': {
        set((st) => {
          const box = st.messages[e.chat_id]
          if (!box) return {}
          const items = e.scope === 'me'
            ? box.items.filter((m) => m.id !== e.message_id)
            : box.items.map((m) => (m.id === e.message_id ? { ...m, deleted: true, body: null, attachments: [], reactions: [] } : m))
          return { messages: { ...st.messages, [e.chat_id]: { ...box, items } } }
        })
        if (s.chats[e.chat_id]?.last_message?.id === e.message_id) s.refreshChat(e.chat_id)
        break
      }
      case 'reaction.updated':
        set((st) => {
          const box = st.messages[e.chat_id]
          if (!box) return {}
          const items = box.items.map((m) => (m.id === e.message_id ? { ...m, reactions: e.reactions } : m))
          return { messages: { ...st.messages, [e.chat_id]: { ...box, items } } }
        })
        break
      case 'receipt.update': {
        const chat = s.chats[e.chat_id]
        if (chat?.type === 'group') { s.reloadMessages(e.chat_id); break }
        set((st) => {
          const box = st.messages[e.chat_id]
          if (!box) return {}
          const ids = new Set(e.message_ids)
          const items = box.items.map((m) => {
            if (!ids.has(m.id)) return m
            if (e.status === 'read') return { ...m, status: 'read' }
            return m.status === 'read' ? m : { ...m, status: 'delivered' }
          })
          return { messages: { ...st.messages, [e.chat_id]: { ...box, items } } }
        })
        break
      }
      case 'chat.read':
        s.patchChat(e.chat_id, { unread_count: 0 })
        break
      case 'typing': {
        const key = `${e.chat_id}:${e.user_id}`
        clearTimeout(typingTimers[key])
        set((st) => {
          const cur = new Set(st.typing[e.chat_id] || [])
          e.is_typing ? cur.add(e.user_id) : cur.delete(e.user_id)
          return { typing: { ...st.typing, [e.chat_id]: [...cur] } }
        })
        if (e.is_typing) {
          typingTimers[key] = setTimeout(() => get().handleEvent({ ...e, is_typing: false }), 4500)
        }
        break
      }
      case 'presence':
        s.patchUser(e.user_id, { is_online: e.is_online, last_seen: e.last_seen })
        break
      case 'user.updated':
        s.patchUser(e.user.id, e.user)
        break
      case 'chat.updated':
        s.refreshChat(e.chat_id)
        break
      case 'chat.removed':
        set((st) => {
          const { [e.chat_id]: _, ...chats } = st.chats
          return { chats, activeChatId: st.activeChatId === e.chat_id ? null : st.activeChatId }
        })
        break
      case 'notification.new': {
        const n = e.notification
        set((st) => ({ notifications: { items: [n, ...st.notifications.items], unread: st.notifications.unread + 1 } }))
        if (!n.type.startsWith('call.') || true) {
          get().toast({ kind: 'info', title: n.title, body: n.body })
          if (me.settings.notify_sound) beep()
          if (me.settings.notify_desktop && !isFocused()) desktopNotify(n.title, n.body, { tag: `n${n.id}` })
        }
        break
      }
      case 'status.new':
      case 'status.viewed':
        s.loadFeed()
        break
      case 'blocks.updated':
        break
      case 'error':
        s.toast({ kind: 'error', title: e.detail })
        break
      default:
        if (e.type?.startsWith('group.call.')) handleGroupCallEvent(e)
        else if (e.type?.startsWith('call.')) handleCallEvent(e)
    }
  },

  afterNewMessage(m) {
    const s = get()
    const me = s.me
    const chat = s.chats[m.chat_id]
    const mine = m.sender_id === me.id
    const hidden = s.isChatHidden(m.chat_id)
    const active = s.activeChatId === m.chat_id && isFocused() && !hidden
    set((st) => {
      const box = st.messages[m.chat_id]
      return box?.loaded ? { messages: { ...st.messages, [m.chat_id]: { ...box, items: mergeMsg(box.items, m) } } } : {}
    })
    s.patchChat(m.chat_id, {
      last_message: m, last_message_at: m.created_at,
      unread_count: mine || m.type === 'system' || active ? chat.unread_count : chat.unread_count + 1,
    })
    if (mine || m.type === 'system') return
    if (active) { s.markRead(m.chat_id); return }
    const allowed = chat.type === 'group' ? me.settings.notify_groups : me.settings.notify_messages
    if (!allowed || chat.muted) return
    const sender = chat.type === 'group' ? chat.members.find((x) => x.user.id === m.sender_id)?.user.display_name : null
    // locked chats never reveal who wrote or what was said
    const title = hidden ? 'ChatFlow' : chatTitle(chat)
    const body = hidden ? 'New message' : (sender ? `${sender}: ` : '') + previewText(m)
    s.toast({ kind: 'message', title, body, chatId: m.chat_id })
    if (me.settings.notify_sound) beep()
    if (me.settings.notify_desktop) desktopNotify(title, body, { tag: `chat${m.chat_id}`, onClick: () => get().openChat(m.chat_id) })
  },

  patchUser(userId, patch) {
    set((st) => {
      const chats = {}
      for (const [id, c] of Object.entries(st.chats)) {
        let next = c
        if (c.peer?.id === userId) next = { ...c, peer: { ...c.peer, ...patch } }
        else if (c.type === 'group' && c.members.some((m) => m.user.id === userId)) {
          next = { ...c, members: c.members.map((m) => (m.user.id === userId ? { ...m, user: { ...m.user, ...patch } } : m)) }
        }
        chats[id] = next
      }
      return { chats }
    })
  },
}))

setUnauthorizedHandler(() => {
  if (useStore.getState().me) useStore.getState().logout()
})
