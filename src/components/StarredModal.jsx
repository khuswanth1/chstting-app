import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api } from '../lib/api'
import { chatTitle, previewText, whenText } from '../lib/format'
import { useStore } from '../store'
import { Icon, Modal, Spinner } from './ui'

/** All messages I starred, across chats. */
export function StarredModal({ onClose }) {
  const chats = useStore((s) => s.chats)
  const me = useStore((s) => s.me)
  const toggleStar = useStore((s) => s.toggleStar)
  const lockedChats = useStore((s) => s.lockedChats)
  const navigate = useNavigate()
  const [state, setState] = useState({ items: [], cursor: null, hasMore: false, loading: true, error: '' })

  const load = async (cursor) => {
    setState((s) => ({ ...s, loading: true, error: '' }))
    try {
      const r = await api.get(`/starred?limit=30${cursor ? `&before_id=${cursor}` : ''}`)
      setState((s) => ({ items: cursor ? [...s.items, ...r.items] : r.items, cursor: r.next_before_id, hasMore: r.has_more, loading: false, error: '' }))
    } catch (e) { setState((s) => ({ ...s, loading: false, error: e.message })) }
  }
  useEffect(() => { load(null) }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const open = (m) => { onClose(); navigate(`/chats/${m.chat_id}`) }
  const unstar = async (item) => {
    await toggleStar(item.message.id, false)
    setState((s) => ({ ...s, items: s.items.filter((i) => i.id !== item.id) }))
  }

  return (
    <Modal title="Starred messages" onClose={onClose}>
      {state.error && <p role="alert" className="m-3 rounded bg-red-50 p-2 text-sm text-red-600 dark:bg-red-950 dark:text-red-300">{state.error}</p>}
      {!state.loading && !state.error && state.items.length === 0 && (
        <div className="p-10 text-center text-sm text-slate-500"><Icon name="star" className="mx-auto mb-2 h-8 w-8 opacity-40" />No starred messages.<br />Open a message’s menu and choose <b>Star</b> to save it here.</div>
      )}
      <ul>
        {state.items.map((it) => {
          const m = it.message
          const chat = chats[m.chat_id]
          const who = m.sender_id === me.id ? 'You' : chat?.type === 'group' ? chat.members.find((x) => x.user.id === m.sender_id)?.user.display_name : chat?.peer?.display_name
          return (
            <li key={it.id} className="divider flex items-start gap-3 px-4 py-3 hover:bg-black/5 dark:hover:bg-white/5">
              <button className="min-w-0 flex-1 text-left" onClick={() => open(m)}>
                <span className="flex items-center justify-between gap-2 text-xs text-slate-500"><span className="truncate font-medium text-wa-green">{who || 'Someone'}{chat ? ` · ${chatTitle(chat)}` : ''}</span><span className="shrink-0">{whenText(m.created_at)}</span></span>
                <span className="mt-1 block whitespace-pre-wrap break-words text-[15px]">{lockedChats.includes(m.chat_id) ? '🔒 Locked chat' : m.type === 'text' ? m.body : previewText(m)}</span>
              </button>
              <button className="icon-btn text-amber-500" onClick={() => unstar(it)} aria-label="Remove star" title="Remove star"><Icon name="star" fill="currentColor" /></button>
            </li>
          )
        })}
      </ul>
      {state.loading && <div className="py-6"><Spinner /></div>}
      {state.hasMore && !state.loading && <div className="p-3 text-center"><button className="btn-ghost border border-slate-300 dark:border-slate-600" onClick={() => load(state.cursor)}>Load more</button></div>}
    </Modal>
  )
}
