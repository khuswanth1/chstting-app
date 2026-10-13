import { useEffect, useRef, useState } from 'react'
import { acceptCall, hangup, rejectCall, toggleCamera, toggleMute, toggleSpeaker } from '../lib/call'
import { useStore } from '../store'
import { clock } from '../lib/format'
import { Avatar, Icon } from './ui'

function Stream({ stream, muted, className }) {
  const ref = useRef()
  useEffect(() => { if (ref.current) ref.current.srcObject = stream || null }, [stream])
  return <video ref={ref} autoPlay playsInline muted={muted} className={className} />
}

export default function CallOverlay() {
  const call = useStore((s) => s.call)
  const [secs, setSecs] = useState(0)
  useEffect(() => {
    if (call?.phase !== 'connected') return setSecs(0)
    const t = setInterval(() => setSecs(Math.floor((Date.now() - call.startedAt) / 1000)), 500)
    return () => clearInterval(t)
  }, [call?.phase, call?.startedAt])
  if (!call) return null

  const video = call.kind === 'video'
  const status = call.message || { calling: 'Calling…', ringing: `Incoming ${call.kind} call`, connecting: 'Connecting…', connected: clock(secs), ended: 'Call ended' }[call.phase]
  const live = ['connecting', 'connected'].includes(call.phase)
  const remoteVideo = !!call.remoteStream?.getVideoTracks().length
  const showRemote = video && live && remoteVideo && !call.peerCamOff
  const btn = 'flex h-14 w-14 items-center justify-center rounded-full text-white transition'

  return (
    <div className="fixed inset-0 z-[60] flex flex-col bg-slate-900 text-white" role="dialog" aria-label="Call">
      {/* always mounted: it carries the other person's audio, even when their video is hidden */}
      {call.remoteStream && <Stream stream={call.remoteStream} muted={!!call.speakerOff} className={showRemote ? 'absolute inset-0 h-full w-full object-cover' : 'hidden'} />}
      <div className="relative z-10 flex flex-1 flex-col items-center justify-center gap-3 bg-gradient-to-b from-black/50 via-transparent to-black/60">
        {!showRemote && <Avatar src={call.peer.avatar_url} name={call.peer.display_name} size={120} />}
        <h2 className="text-2xl font-semibold drop-shadow">{call.peer.display_name}</h2>
        <p className="text-sm opacity-90 drop-shadow" aria-live="polite">{status}</p>
        {live && call.peerMuted && <p className="flex items-center gap-1.5 rounded-full bg-black/50 px-3 py-1 text-xs"><Icon name="micOff" className="h-3.5 w-3.5" />{call.peer.display_name} is muted</p>}
        {live && call.speakerOff && <p className="flex items-center gap-1.5 rounded-full bg-amber-500/80 px-3 py-1 text-xs"><Icon name="volumeOff" className="h-3.5 w-3.5" />You muted {call.peer.display_name}</p>}
      </div>
      {video && call.localStream && !call.noCamera && (
        <Stream stream={call.localStream} muted className={`absolute right-3 top-3 z-20 h-40 w-28 rounded-xl border border-white/30 bg-black object-cover shadow-lg sm:h-48 sm:w-36 ${call.camOff ? 'opacity-30' : ''}`} />
      )}
      <div className="relative z-10 flex items-center justify-center gap-5 bg-black/40 px-4 py-6 pb-[max(1.5rem,env(safe-area-inset-bottom))]">
        {call.phase === 'ringing' ? (
          <>
            <button className={`${btn} bg-red-500 hover:bg-red-600`} onClick={rejectCall} aria-label="Decline"><Icon name="phone" className="h-6 w-6 rotate-[135deg]" /></button>
            <button className={`${btn} animate-pulse bg-green-500 hover:bg-green-600`} onClick={acceptCall} aria-label="Accept"><Icon name={video ? 'video' : 'phone'} className="h-6 w-6" /></button>
          </>
        ) : call.phase === 'ended' ? null : (
          <>
            <button className={`${btn} ${call.muted ? 'bg-white text-slate-900' : 'bg-white/20 hover:bg-white/30'}`} onClick={toggleMute} aria-label={call.muted ? 'Unmute' : 'Mute'} aria-pressed={call.muted}><Icon name={call.muted ? 'micOff' : 'mic'} className="h-6 w-6" /></button>
            <button className={`${btn} ${call.speakerOff ? 'bg-amber-500' : 'bg-white/20 hover:bg-white/30'}`} onClick={toggleSpeaker} aria-label={`${call.speakerOff ? 'Unmute' : 'Mute'} ${call.peer.display_name}`} aria-pressed={!!call.speakerOff} title={`${call.speakerOff ? 'Unmute' : 'Mute'} ${call.peer.display_name} (only for you)`}><Icon name={call.speakerOff ? 'volumeOff' : 'volume'} className="h-6 w-6" /></button>
            {video && !call.noCamera && <button className={`${btn} ${call.camOff ? 'bg-white text-slate-900' : 'bg-white/20 hover:bg-white/30'}`} onClick={toggleCamera} aria-label={call.camOff ? 'Turn camera on' : 'Turn camera off'} aria-pressed={call.camOff}><Icon name={call.camOff ? 'videoOff' : 'video'} className="h-6 w-6" /></button>}
            <button className={`${btn} bg-red-500 hover:bg-red-600`} onClick={() => hangup()} aria-label="End call"><Icon name="phone" className="h-6 w-6 rotate-[135deg]" /></button>
          </>
        )}
      </div>
    </div>
  )
}
