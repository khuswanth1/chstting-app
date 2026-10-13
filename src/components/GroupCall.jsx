import { useEffect, useRef, useState } from 'react'
import { askAllToUnmute, askToMute, joinGroupCall, leaveGroupCall, muteAll, setAllSpeakers, toggleGroupCamera, toggleGroupMute, toggleSpeaker } from '../lib/groupcall'
import { useStore } from '../store'
import { chatTitle, clock } from '../lib/format'
import { Avatar, Icon } from './ui'

function Tile({ name, avatar, stream, local, muted, showVideo, speakerOff, onSpeaker, onAskMute }) {
  const ref = useRef()
  useEffect(() => { if (ref.current) ref.current.srcObject = stream || null }, [stream])
  const hasVideo = showVideo && !!stream?.getVideoTracks().length
  return (
    <div className="group relative overflow-hidden rounded-xl bg-slate-800">
      {/* always mounted so remote audio keeps playing even when the avatar is shown */}
      <video ref={ref} autoPlay playsInline muted={local || speakerOff} className={hasVideo ? `h-full w-full object-cover ${local ? '-scale-x-100' : ''}` : 'hidden'} />
      {!hasVideo && <div className="flex h-full w-full items-center justify-center"><Avatar src={avatar} name={name} size={80} /></div>}
      <div className="absolute inset-x-0 bottom-0 flex items-center gap-1.5 bg-gradient-to-t from-black/70 to-transparent px-2.5 py-2 text-sm">
        <span className="min-w-0 flex-1 truncate">{name}{local ? ' (You)' : ''}</span>
        {muted && <span title="Muted" className="rounded-full bg-red-500 p-1"><Icon name="micOff" className="h-3.5 w-3.5" /></span>}
        {speakerOff && <span title="You muted this person" className="rounded-full bg-amber-500 p-1"><Icon name="volumeOff" className="h-3.5 w-3.5" /></span>}
      </div>
      {!local && (
        <div className="absolute right-2 top-2 flex gap-1 opacity-100 transition sm:opacity-0 sm:group-hover:opacity-100 sm:group-focus-within:opacity-100">
          <button onClick={onSpeaker} className="rounded-full bg-black/60 p-1.5 hover:bg-black/80" aria-label={`${speakerOff ? 'Unmute' : 'Mute'} ${name} for me`} title={speakerOff ? 'Unmute for me' : 'Mute for me'}>
            <Icon name={speakerOff ? 'volumeOff' : 'volume'} className="h-4 w-4" />
          </button>
          {onAskMute && !muted && (
            <button onClick={onAskMute} className="rounded-full bg-black/60 p-1.5 hover:bg-black/80" aria-label={`Ask ${name} to mute`} title="Ask to mute (admin)"><Icon name="micOff" className="h-4 w-4" /></button>
          )}
        </div>
      )}
    </div>
  )
}

export function GroupCallOverlay() {
  const g = useStore((s) => s.gcall)
  const me = useStore((s) => s.me)
  const chat = useStore((s) => (s.gcall ? s.chats[s.gcall.chatId] : null))
  const [secs, setSecs] = useState(0)
  useEffect(() => {
    if (g?.phase !== 'connected') return setSecs(0)
    const t = setInterval(() => setSecs(Math.floor((Date.now() - g.startedAt) / 1000)), 500)
    return () => clearInterval(t)
  }, [g?.phase, g?.startedAt])
  if (!g) return null

  const video = g.kind === 'video'
  const admin = chat?.my_role === 'admin'
  const entries = Object.entries(g.peers)
  const allSilenced = entries.length > 0 && entries.every(([, p]) => p.speakerOff)
  const allMuted = entries.length > 0 && entries.every(([, p]) => p.muted)
  const count = entries.length + 1
  const cols = count <= 1 ? 'grid-cols-1' : count === 2 ? 'grid-cols-1 sm:grid-cols-2' : count <= 4 ? 'grid-cols-2' : 'grid-cols-2 lg:grid-cols-3'
  const btn = 'flex h-12 w-12 items-center justify-center rounded-full text-white transition'

  return (
    <div className="fixed inset-0 z-[60] flex flex-col bg-slate-900 text-white" role="dialog" aria-label="Group call">
      <header className="flex items-center gap-3 px-4 py-3">
        <div className="min-w-0 flex-1"><h2 className="truncate font-semibold">{chat ? chatTitle(chat) : 'Group call'}</h2>
          <p className="text-xs opacity-80" aria-live="polite">{g.phase === 'connected' ? `${count} in call · ${clock(secs)}` : 'Joining…'}</p></div>
      </header>
      <div className={`grid min-h-0 flex-1 auto-rows-fr gap-2 p-2 ${cols}`}>
        <Tile local name={me.display_name} avatar={me.avatar_url} stream={g.localStream} muted={g.muted} showVideo={video && !g.camOff} />
        {entries.map(([uid, p]) => (
          <Tile key={uid} name={p.user.display_name} avatar={p.user.avatar_url} stream={p.stream} muted={p.muted} speakerOff={p.speakerOff}
            showVideo={video && !p.camOff} onSpeaker={() => toggleSpeaker(uid)} onAskMute={admin ? () => askToMute(Number(uid)) : null} />
        ))}
      </div>
      {entries.length === 0 && g.phase === 'connected' && <p className="pb-2 text-center text-sm opacity-80">Waiting for others to join…</p>}
      <div className="flex items-center justify-center gap-4 bg-black/40 px-4 py-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
        <button className={`${btn} ${g.muted ? 'bg-white text-slate-900' : 'bg-white/20 hover:bg-white/30'} ${g.unmuteRequested ? 'animate-pulse ring-4 ring-wa-green' : ''}`} onClick={() => toggleGroupMute()} aria-pressed={g.muted} aria-label={g.muted ? 'Unmute myself' : 'Mute myself'}><Icon name={g.muted ? 'micOff' : 'mic'} className="h-5 w-5" /></button>
        {video && !g.noCamera && <button className={`${btn} ${g.camOff ? 'bg-white text-slate-900' : 'bg-white/20 hover:bg-white/30'}`} onClick={toggleGroupCamera} aria-pressed={g.camOff} aria-label={g.camOff ? 'Turn camera on' : 'Turn camera off'}><Icon name={g.camOff ? 'videoOff' : 'video'} className="h-5 w-5" /></button>}
        {entries.length > 0 && (
          <button className={`flex h-12 items-center gap-2 rounded-full px-4 text-sm ${allSilenced ? 'bg-amber-500' : 'bg-white/20 hover:bg-white/30'}`} onClick={() => setAllSpeakers(!allSilenced)} aria-pressed={allSilenced}
            title="Stops or restores everyone's audio on your side only">
            <Icon name={allSilenced ? 'volumeOff' : 'volume'} className="h-4 w-4" />{allSilenced ? 'Unmute all for me' : 'Mute all for me'}
          </button>
        )}
        {admin && entries.length > 0 && (
          <button className="flex h-12 items-center gap-2 rounded-full bg-white/20 px-4 text-sm hover:bg-white/30" onClick={allMuted ? askAllToUnmute : muteAll}
            title={allMuted ? 'Ask everyone to unmute (they choose)' : 'Everyone is muted on their side'}>
            <Icon name={allMuted ? 'mic' : 'micOff'} className="h-4 w-4" />{allMuted ? 'Ask all to unmute' : 'Mute everyone'}
          </button>
        )}
        <button className={`${btn} bg-red-500 hover:bg-red-600`} onClick={leaveGroupCall} aria-label="Leave call"><Icon name="phone" className="h-5 w-5 rotate-[135deg]" /></button>
      </div>
    </div>
  )
}

/** Shown at the top of a group chat while a call is running there. */
export function GroupCallBanner({ chatId }) {
  const room = useStore((s) => s.groupRooms[chatId])
  const inCall = useStore((s) => s.gcall?.chatId === chatId)
  const busy = useStore((s) => !!s.call || (!!s.gcall && s.gcall.chatId !== chatId))
  if (!room || inCall) return null
  return (
    <div className="flex items-center gap-3 bg-wa-green px-4 py-2 text-sm text-white" role="status">
      <Icon name={room.kind === 'video' ? 'video' : 'phone'} className="h-4 w-4 shrink-0" />
      <span className="flex-1">Ongoing group {room.kind} call · {room.participants.length} joined</span>
      <button className="rounded-full bg-white px-4 py-1 font-medium text-wa-greenDark disabled:opacity-50" disabled={busy} onClick={() => joinGroupCall(chatId)}>Join</button>
    </div>
  )
}
