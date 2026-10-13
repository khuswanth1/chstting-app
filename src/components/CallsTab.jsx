import { useEffect, useState } from 'react'
import { api } from '../lib/api'
import { startCall } from '../lib/call'
import { listTime } from '../lib/format'
import { Avatar, Empty, Icon, Spinner } from './ui'

const LABEL = { missed: 'Missed', declined: 'Declined', busy: 'Busy', ended: 'Completed', ringing: 'Not answered', ongoing: 'Ongoing' }

export default function CallsTab() {
  const [calls, setCalls] = useState(null)
  useEffect(() => { api.get('/calls').then(setCalls).catch(() => setCalls([])) }, [])
  if (!calls) return <div className="p-6"><Spinner /></div>
  if (!calls.length) return <Empty icon="phone" title="No calls yet">Open a chat and tap the phone or video icon to call.</Empty>
  return (
    <ul className="scroll-thin min-h-0 flex-1 overflow-y-auto">
      {calls.map((c) => {
        const bad = c.status === 'missed' && c.direction === 'incoming'
        return (
          <li key={c.id} className="flex items-center gap-3 px-3 py-2.5">
            <Avatar src={c.peer.avatar_url} name={c.peer.display_name} size={44} />
            <span className="min-w-0 flex-1">
              <span className={`block truncate font-medium ${bad ? 'text-red-500' : ''}`}>{c.peer.display_name}</span>
              <span className="block text-xs text-slate-500">{c.direction === 'outgoing' ? '↗' : '↙'} {c.kind === 'video' ? 'Video' : 'Voice'} · {LABEL[c.status]} · {listTime(c.created_at)}</span>
            </span>
            <button className="icon-btn text-wa-green" onClick={() => startCall(c.peer, c.kind, c.chat_id)} aria-label={`Call ${c.peer.display_name} again`}><Icon name={c.kind === 'video' ? 'video' : 'phone'} /></button>
          </li>
        )
      })}
    </ul>
  )
}
