import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api } from '../lib/api'
import { useStore } from '../store'
import { chatAvatar, chatTitle, presenceText } from '../lib/format'
import { AI_USERNAME, AiTopCheckbox } from './AiTools'
import { BackupChatButton } from './Backup'
import { LockToggle } from './ChatLock'
import { MediaPreview } from './Media'
import { Avatar, Icon, Modal, Spinner, Toggle } from './ui'

/** Search contacts + all users; supports single pick or multi select. */
function UserPicker({ selected = [], onToggle, exclude = [] }) {
  const [q, setQ] = useState('')
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  useEffect(() => {
    let live = true
    const t = setTimeout(async () => {
      setLoading(true)
      try {
        const contacts = (await api.get(`/contacts?q=${encodeURIComponent(q)}`)).map((c) => ({ ...c.user, contact: true }))
        let others = []
        if (q.trim().length >= 2) others = (await api.get(`/users/search?q=${encodeURIComponent(q.trim())}`)).map((u) => ({ ...u }))
        const seen = new Set(contacts.map((u) => u.id))
        if (live) setRows([...contacts, ...others.filter((u) => !seen.has(u.id))].filter((u) => !exclude.includes(u.id)))
      } catch { if (live) setRows([]) } finally { if (live) setLoading(false) }
    }, 250)
    return () => { live = false; clearTimeout(t) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q])
  return (
    <div>
      <div className="p-3"><input className="input" placeholder="Search name, username or phone number" value={q} onChange={(e) => setQ(e.target.value)} autoFocus /></div>
      {loading && <div className="py-4"><Spinner /></div>}
      {!loading && rows.length === 0 && <p className="p-6 text-center text-sm text-slate-500">{q ? 'No users found' : 'No contacts yet. Search for people by username or phone number.'}</p>}
      <ul>
        {rows.map((u) => (
          <li key={u.id}>
            <button className={`flex w-full items-center gap-3 px-4 py-2.5 text-left hover:bg-black/5 dark:hover:bg-white/5 ${selected.some((s) => s.id === u.id) ? 'bg-wa-green/10' : ''}`} onClick={() => onToggle(u)} aria-pressed={selected.some((s) => s.id === u.id)}>
              <Avatar src={u.avatar_url} name={u.display_name} />
              <span className="min-w-0 flex-1"><span className="block truncate font-medium">{u.display_name}</span><span className="block truncate text-xs text-slate-500">@{u.username}{u.contact ? '' : ' · not in contacts'}</span></span>
              {selected.some((s) => s.id === u.id) && <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-wa-green text-white"><Icon name="check" className="h-4 w-4" /></span>}
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}

export function NewChatModal({ onClose, onGroup }) {
  const openDirect = useStore((s) => s.openDirect)
  const error = useStore((s) => s.error)
  const navigate = useNavigate()
  return (
    <Modal title="New chat" onClose={onClose}>
      <button className="flex w-full items-center gap-3 px-4 py-3 hover:bg-black/5 dark:hover:bg-white/5" onClick={onGroup}>
        <span className="flex h-10 w-10 items-center justify-center rounded-full bg-wa-green text-white"><Icon name="users" /></span><span className="font-medium">New group</span>
      </button>
      <button className="flex w-full items-center gap-3 px-4 py-3 hover:bg-black/5 dark:hover:bg-white/5" onClick={async () => {
        onClose()
        const chat = await useStore.getState().openAiChat()
        if (chat?.id) navigate(`/chats/${chat.id}`)
      }}>
        <span className="flex h-10 w-10 items-center justify-center rounded-full bg-gradient-to-br from-violet-500 via-fuchsia-500 to-amber-400 text-white"><Icon name="sparkles" /></span><span className="font-medium">ChatFlow AI <span className="text-xs font-normal text-slate-500">· ask anything</span></span>
      </button>
      <UserPicker onToggle={async (u) => {
        try {
          await api.post('/contacts', { user_id: u.id })
          const chat = await openDirect(u.id)
          onClose()
          if (chat?.id) navigate(`/chats/${chat.id}`)
        } catch (e) { error(e) }
      }} />
    </Modal>
  )
}

export function NewGroupModal({ onClose }) {
  const [picked, setPicked] = useState([])
  const [name, setName] = useState('')
  const [desc, setDesc] = useState('')
  const [busy, setBusy] = useState(false)
  const { upsertChat, openChat, error } = useStore.getState()
  const navigate = useNavigate()
  async function create() {
    setBusy(true)
    try {
      const chat = await api.post('/chats/groups', { name, description: desc || null, member_ids: picked.map((u) => u.id) })
      upsertChat(chat); await openChat(chat.id); onClose(); navigate(`/chats/${chat.id}`)
    } catch (e) { error(e) } finally { setBusy(false) }
  }
  return (
    <Modal title="New group" onClose={onClose}>
      <div className="space-y-3 p-4">
        <label className="block text-xs font-medium text-slate-500">Group name
          <span className="relative mt-1 block">
            <input className="input pr-14" placeholder="e.g. Weekend plans" value={name} onChange={(e) => setName(e.target.value)} maxLength={100} autoFocus />
            <span className="absolute right-3 top-2.5 text-xs text-slate-400">{name.length}/100</span>
          </span>
        </label>
        <label className="block text-xs font-medium text-slate-500">Description <span className="font-normal">(optional)</span>
          <input className="input mt-1" placeholder="What is this group about?" value={desc} onChange={(e) => setDesc(e.target.value)} maxLength={500} />
        </label>
        <div>
          <div className="flex items-center justify-between text-xs font-medium text-slate-500">
            <span>Members</span><span>{picked.length + 1} selected · you are the admin</span>
          </div>
          {picked.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1.5">{picked.map((u) => (
              <span key={u.id} className="flex items-center gap-1.5 rounded-full bg-wa-green/15 py-0.5 pl-0.5 pr-2 text-xs">
                <Avatar src={u.avatar_url} name={u.display_name} size={22} />{u.display_name}
                <button onClick={() => setPicked(picked.filter((p) => p.id !== u.id))} aria-label={`Remove ${u.display_name}`}><Icon name="x" className="h-3 w-3" /></button>
              </span>))}
            </div>
          )}
        </div>
      </div>
      <div className="divider" />
      <UserPicker selected={picked} onToggle={(u) => setPicked((p) => (p.some((x) => x.id === u.id) ? p.filter((x) => x.id !== u.id) : [...p, u]))} />
      <div className="sticky bottom-0 border-t border-wa-line bg-white p-3 dark:border-wa-lineNight dark:bg-wa-panel">
        <button className="btn-primary w-full" disabled={!name.trim() || busy} onClick={create}>
          {busy ? 'Creating…' : name.trim() ? `Create group (${picked.length + 1})` : 'Enter a group name'}
        </button>
      </div>
    </Modal>
  )
}

export function ForwardModal({ messageIds, onClose }) {
  const chatsMap = useStore((s) => s.chats)
  const chats = useMemo(() => Object.values(chatsMap).sort((a, b) => (b.last_message_at > a.last_message_at ? 1 : -1)), [chatsMap])
  const error = useStore((s) => s.error)
  const toast = useStore((s) => s.toast)
  const [sel, setSel] = useState([])
  const [busy, setBusy] = useState(false)
  async function go() {
    setBusy(true)
    try { await api.post('/messages/forward', { message_ids: messageIds, chat_ids: sel }); toast({ kind: 'info', title: 'Message forwarded' }); onClose() }
    catch (e) { error(e) } finally { setBusy(false) }
  }
  return (
    <Modal title="Forward to…" onClose={onClose}>
      <ul>{chats.map((c) => (
        <li key={c.id}><button className="flex w-full items-center gap-3 px-4 py-2.5 text-left hover:bg-black/5 dark:hover:bg-white/5" onClick={() => setSel((s) => (s.includes(c.id) ? s.filter((i) => i !== c.id) : [...s, c.id].slice(-10)))}>
          <Avatar src={chatAvatar(c)} name={chatTitle(c)} group={c.type === 'group'} />
          <span className="flex-1 truncate font-medium">{chatTitle(c)}</span>
          {sel.includes(c.id) && <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-wa-green text-white"><Icon name="check" className="h-4 w-4" /></span>}
        </button></li>))}</ul>
      <div className="sticky bottom-0 bg-white p-3 dark:bg-wa-panel"><button className="btn-primary w-full" disabled={!sel.length || busy} onClick={go}>Send{sel.length ? ` to ${sel.length}` : ''}</button></div>
    </Modal>
  )
}

export function ChatInfoModal({ chatId, onClose }) {
  const chat = useStore((s) => s.chats[chatId])
  const me = useStore((s) => s.me)
  const { refreshChat, patchChat, error, toast } = useStore.getState()
  const [adding, setAdding] = useState(false)
  const [edit, setEdit] = useState(null)
  const [isContact, setIsContact] = useState(false)
  const [blocked, setBlocked] = useState(false)
  const fileRef = useRef()
  const group = chat?.type === 'group'
  const admin = chat?.my_role === 'admin'

  useEffect(() => {
    if (!chat || group) return
    api.get('/contacts?limit=200').then((l) => setIsContact(l.some((c) => c.user.id === chat.peer.id))).catch(() => {})
    api.get('/blocks').then((l) => setBlocked(l.some((u) => u.id === chat.peer.id))).catch(() => {})
  }, [chat?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  if (!chat) return null
  const guard = (fn) => async (...a) => { try { await fn(...a) } catch (e) { error(e) } }

  if (adding) {
    return (
      <Modal title="Add members" onClose={() => setAdding(false)}>
        <UserPicker exclude={chat.members.map((m) => m.user.id)} onToggle={guard(async (u) => {
          const updated = await api.post(`/chats/${chat.id}/members`, { user_ids: [u.id] })
          patchChat(chat.id, updated); toast({ kind: 'info', title: `${u.display_name} added` })
        })} />
      </Modal>
    )
  }

  const peer = chat.peer
  return (
    <Modal title={group ? 'Group info' : 'Contact info'} onClose={onClose}>
      <div className="flex flex-col items-center gap-2 p-6 text-center">
        <Avatar src={chatAvatar(chat)} name={chatTitle(chat)} size={96} group={group} />
        {group && admin && (
          <>
            <input ref={fileRef} type="file" accept="image/*" hidden onChange={guard(async (e) => { const f = e.target.files[0]; if (f) patchChat(chat.id, await api.upload(`/chats/${chat.id}/avatar`, f)) })} />
            <button className="text-sm text-wa-greenDark dark:text-wa-green" onClick={() => fileRef.current.click()}>Change group icon</button>
          </>
        )}
        {edit ? (
          <div className="w-full space-y-2">
            <input className="input" value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} maxLength={100} />
            <textarea className="input" rows={2} value={edit.description} onChange={(e) => setEdit({ ...edit, description: e.target.value })} maxLength={500} placeholder="Description" />
            <div className="flex gap-2"><button className="btn-primary flex-1" onClick={guard(async () => { patchChat(chat.id, await api.patch(`/chats/${chat.id}`, edit)); setEdit(null) })}>Save</button><button className="btn-ghost flex-1" onClick={() => setEdit(null)}>Cancel</button></div>
          </div>
        ) : (
          <>
            <h3 className="text-xl font-semibold">{chatTitle(chat)}</h3>
            {group ? <p className="text-sm text-slate-500">Group · {chat.members.length} members</p> : <p className="text-sm text-slate-500">@{peer.username} · {presenceText(peer)}</p>}
            {(group ? chat.description : peer.about) && <p className="text-sm">{group ? chat.description : peer.about}</p>}
            {group && admin && <button className="text-sm text-wa-greenDark dark:text-wa-green" onClick={() => setEdit({ name: chat.name, description: chat.description || '' })}>Edit name & description</button>}
          </>
        )}
      </div>
      <div className="divider px-4"><Toggle label="Mute notifications" checked={chat.muted} onChange={guard(async (muted) => patchChat(chat.id, await api.patch(`/chats/${chat.id}/me`, { muted })))} />
        <Toggle label="Pin chat" hint="Keep it at the top of your list (max 3)" checked={!!chat.pinned} onChange={guard(async (pinned) => patchChat(chat.id, await api.patch(`/chats/${chat.id}/me`, { pinned })))} />
        <Toggle label="Archive chat" hint="Move it out of your main list" checked={!!chat.archived} onChange={guard(async (archived) => patchChat(chat.id, await api.patch(`/chats/${chat.id}/me`, { archived })))} /></div>

      {!group && chat.peer?.username === AI_USERNAME && <div className="divider px-4 py-2"><AiTopCheckbox /></div>}
      <LockToggle chat={chat} />
      <BackupChatButton chat={chat} />
      <MediaPreview chatId={chat.id} />

      {group ? (
        <>
          <div className="flex items-center justify-between px-4 py-3"><h4 className="text-sm font-medium text-slate-500">{chat.members.length} members</h4>
            {admin && <button className="btn-ghost !py-1 text-wa-greenDark dark:text-wa-green" onClick={() => setAdding(true)}><Icon name="plus" className="h-4 w-4" />Add</button>}</div>
          <ul>{chat.members.map(({ user, role }) => (
            <li key={user.id} className="flex items-center gap-3 px-4 py-2">
              <Avatar src={user.avatar_url} name={user.display_name} online={user.is_online} />
              <span className="min-w-0 flex-1"><span className="block truncate font-medium">{user.id === me.id ? 'You' : user.display_name}</span><span className="block truncate text-xs text-slate-500">{user.about}</span></span>
              {role === 'admin' && <span className="rounded border border-wa-green px-1.5 text-xs text-wa-green">Admin</span>}
              {admin && user.id !== me.id && (
                <span className="flex gap-1">
                  <button className="icon-btn h-8 w-8" title={role === 'admin' ? 'Remove admin' : 'Make admin'} onClick={guard(async () => patchChat(chat.id, await api.patch(`/chats/${chat.id}/members/${user.id}`, { role: role === 'admin' ? 'member' : 'admin' })))}><Icon name="user" className="h-4 w-4" /></button>
                  <button className="icon-btn h-8 w-8 text-red-500" title="Remove from group" onClick={guard(async () => { await api.del(`/chats/${chat.id}/members/${user.id}`); await refreshChat(chat.id) })}><Icon name="x" className="h-4 w-4" /></button>
                </span>
              )}
            </li>))}</ul>
          <div className="p-4"><button className="btn-ghost w-full text-red-500" onClick={guard(async () => { await api.del(`/chats/${chat.id}/members/${me.id}`); onClose() })}><Icon name="logout" className="h-4 w-4" />Leave group</button></div>
        </>
      ) : (
        <div className="space-y-1 p-4">
          <button className="btn-ghost w-full justify-start" onClick={guard(async () => { isContact ? await api.del(`/contacts/${peer.id}`) : await api.post('/contacts', { user_id: peer.id }); setIsContact(!isContact) })}>
            <Icon name="user" className="h-4 w-4" />{isContact ? 'Remove from contacts' : 'Add to contacts'}</button>
          <button className="btn-ghost w-full justify-start text-red-500" onClick={guard(async () => { blocked ? await api.del(`/blocks/${peer.id}`) : await api.post(`/blocks/${peer.id}`); setBlocked(!blocked) })}>
            <Icon name="block" className="h-4 w-4" />{blocked ? `Unblock ${peer.display_name}` : `Block ${peer.display_name}`}</button>
        </div>
      )}
    </Modal>
  )
}

/** "Send document": pick a chat, then pick a file; it is sent straight away as a document message. */
export function SendDocumentModal({ onClose }) {
  const chatsMap = useStore((s) => s.chats)
  const chats = useMemo(() => Object.values(chatsMap).sort((a, b) => (b.last_message_at > a.last_message_at ? 1 : -1)), [chatsMap])
  const sendMessage = useStore((s) => s.sendMessage)
  const toast = useStore((s) => s.toast)
  const navigate = useNavigate()
  const [busy, setBusy] = useState(false)
  const [q, setQ] = useState('')
  const list = chats.filter((c) => chatTitle(c).toLowerCase().includes(q.trim().toLowerCase()))

  function pick(chat) {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = '.pdf,.txt,.csv,.docx,.xlsx,.pptx,.zip,image/*,video/mp4,video/webm,audio/*'
    input.onchange = async () => {
      const file = input.files[0]
      if (!file) return
      setBusy(true)
      try {
        await sendMessage(chat.id, { files: [file] })
        toast({ kind: 'info', title: `Sent to ${chatTitle(chat)}` })
        onClose()
        navigate(`/chats/${chat.id}`)
      } catch { setBusy(false) /* error toast shown by the store */ }
    }
    input.click() // must happen inside the click handler so the browser allows the file dialog
  }

  return (
    <Modal title="Send document to…" onClose={onClose}>
      <div className="p-3"><input className="input" placeholder="Search chats" value={q} onChange={(e) => setQ(e.target.value)} autoFocus /></div>
      {busy && <div className="py-4"><Spinner /><p className="mt-2 text-center text-sm text-slate-500">Uploading…</p></div>}
      {!list.length && <p className="p-6 text-center text-sm text-slate-500">No chats found</p>}
      <ul>{list.map((c) => (
        <li key={c.id}><button disabled={busy} className="flex w-full items-center gap-3 px-4 py-2.5 text-left hover:bg-black/5 disabled:opacity-50 dark:hover:bg-white/5" onClick={() => pick(c)}>
          <Avatar src={chatAvatar(c)} name={chatTitle(c)} group={c.type === 'group'} /><span className="flex-1 truncate font-medium">{chatTitle(c)}</span><Icon name="file" className="h-4 w-4 text-slate-400" />
        </button></li>))}</ul>
    </Modal>
  )
}
