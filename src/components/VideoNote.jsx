import { useEffect, useRef, useState } from 'react'
import { describeMediaError } from '../lib/call'
import { mediaUrl } from '../lib/api'
import { clock } from '../lib/format'
import { Icon, Modal } from './ui'

export const MAX_VIDEO_NOTE_SECONDS = 60

/** Record a short round video message, review it, then send. */
export function VideoNoteRecorder({ onSend, onClose }) {
  const [phase, setPhase] = useState('starting') // starting | ready | recording | review
  const [secs, setSecs] = useState(0)
  const [error, setError] = useState('')
  const [clip, setClip] = useState(null) // { file, url, duration }
  const [sending, setSending] = useState(false)
  const liveRef = useRef()
  const reviewRef = useRef()
  const streamRef = useRef(null)
  const recRef = useRef(null)

  async function openCamera() {
    setError(''); setPhase('starting')
    try {
      if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') throw new Error('Video notes need HTTPS or localhost and a browser that supports recording')
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: 480 }, height: { ideal: 480 }, facingMode: 'user' },
        audio: { echoCancellation: true, noiseSuppression: true },
      })
      streamRef.current = stream
      setPhase('ready')
    } catch (e) {
      setError(e.name ? describeMediaError(e, 'camera/microphone') : e.message)
      setPhase('error')
    }
  }

  useEffect(() => {
    openCamera()
    return () => { streamRef.current?.getTracks().forEach((t) => t.stop()); recRef.current?.cancel() }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => { if (liveRef.current && streamRef.current && phase !== 'review') liveRef.current.srcObject = streamRef.current }, [phase])
  useEffect(() => () => clip && URL.revokeObjectURL(clip.url), [clip])

  function start() {
    const stream = streamRef.current
    const mime = ['video/webm;codecs=vp8,opus', 'video/webm', 'video/mp4'].find((m) => MediaRecorder.isTypeSupported(m))
    const mr = new MediaRecorder(stream, { ...(mime ? { mimeType: mime } : {}), videoBitsPerSecond: 800000 })
    const chunks = []
    let seconds = 0
    let cancelled = false
    mr.ondataavailable = (e) => e.data.size && chunks.push(e.data)
    const tick = setInterval(() => {
      seconds += 1; setSecs(seconds)
      if (seconds >= MAX_VIDEO_NOTE_SECONDS && mr.state === 'recording') mr.stop()
    }, 1000)
    mr.onstop = () => {
      clearInterval(tick)
      recRef.current = null
      if (cancelled || !chunks.length) return
      const type = mr.mimeType || 'video/webm'
      const file = new File(chunks, `video-note.${type.includes('mp4') ? 'mp4' : 'webm'}`, { type })
      streamRef.current?.getTracks().forEach((t) => t.stop())
      setClip({ file, url: URL.createObjectURL(file), duration: Math.max(1, seconds) })
      setPhase('review')
    }
    recRef.current = { stop: () => mr.state === 'recording' && mr.stop(), cancel: () => { cancelled = true; mr.state !== 'inactive' && mr.stop() } }
    mr.start(500)
    setSecs(0); setPhase('recording')
  }

  async function retake() {
    setClip(null); setSecs(0)
    await openCamera()
  }

  async function send() {
    setSending(true)
    try { await onSend({ file: clip.file, duration: clip.duration }); onClose() } catch { setSending(false) }
  }

  const ring = 'mx-auto h-64 w-64 overflow-hidden rounded-full border-4 bg-black object-cover sm:h-72 sm:w-72'
  return (
    <Modal title="Video message" onClose={onClose}>
      <div className="space-y-4 p-5 text-center">
        {phase === 'error' && (
          <div className="space-y-3 py-6"><p role="alert" className="text-sm text-red-500">{error}</p><button className="btn-primary" onClick={openCamera}>Try again</button></div>
        )}
        {phase !== 'error' && phase !== 'review' && (
          <div className="relative mx-auto w-fit">
            <video ref={liveRef} autoPlay playsInline muted className={`${ring} -scale-x-100 ${phase === 'recording' ? 'border-red-500' : 'border-wa-green'}`} />
            {phase === 'starting' && <p className="absolute inset-0 flex items-center justify-center text-sm text-white">Starting camera…</p>}
          </div>
        )}
        {phase === 'review' && clip && (
          <video ref={reviewRef} src={clip.url} controls playsInline className={`${ring} border-wa-green`} />
        )}
        {(phase === 'recording' || phase === 'review') && (
          <p className="text-sm tabular-nums text-slate-500" aria-live="polite">
            {phase === 'recording' ? <><span className="mr-2 inline-block h-2.5 w-2.5 animate-pulse rounded-full bg-red-500" />{clock(secs)} / {clock(MAX_VIDEO_NOTE_SECONDS)}</> : clock(clip.duration)}
          </p>
        )}
        <div className="flex justify-center gap-3">
          {phase === 'ready' && <button className="btn-primary h-14 w-14 !rounded-full !p-0" onClick={start} aria-label="Start recording"><span className="h-5 w-5 rounded-full bg-white" /></button>}
          {phase === 'recording' && <button className="h-14 w-14 rounded-full bg-red-500 text-white" onClick={() => recRef.current?.stop()} aria-label="Stop recording"><Icon name="stop" className="mx-auto h-6 w-6" fill="currentColor" /></button>}
          {phase === 'review' && <>
            <button className="btn-ghost border border-slate-300 dark:border-slate-600" onClick={retake} disabled={sending}>Retake</button>
            <button className="btn-primary" onClick={send} disabled={sending}><Icon name="send" className="h-4 w-4" />{sending ? 'Sending…' : 'Send'}</button>
          </>}
        </div>
        {phase === 'ready' && <p className="text-xs text-slate-500">Up to {MAX_VIDEO_NOTE_SECONDS} seconds. Tap the circle to record.</p>}
      </div>
    </Modal>
  )
}

/** Round inline player used in chat bubbles. */
export function VideoNotePlayer({ attachment }) {
  const ref = useRef()
  const [playing, setPlaying] = useState(false)
  const [progress, setProgress] = useState(0)
  const toggle = () => {
    const v = ref.current
    if (!v) return
    v.paused ? v.play().catch(() => {}) : v.pause()
  }
  const R = 46
  const C = 2 * Math.PI * R
  return (
    <button onClick={toggle} className="relative block h-52 w-52 overflow-hidden rounded-full bg-black shadow-md sm:h-60 sm:w-60" aria-label={playing ? 'Pause video message' : 'Play video message'}>
      <video ref={ref} src={mediaUrl(attachment.url)} playsInline preload="metadata" className="h-full w-full object-cover"
        onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)} onEnded={() => { setPlaying(false); setProgress(0) }}
        onTimeUpdate={(e) => setProgress(e.target.currentTime / (e.target.duration || 1))} />
      <svg viewBox="0 0 100 100" className="pointer-events-none absolute inset-0 -rotate-90"><circle cx="50" cy="50" r={R} fill="none" stroke="#00a884" strokeWidth="3" strokeDasharray={C} strokeDashoffset={C * (1 - progress)} strokeLinecap="round" /></svg>
      {!playing && <span className="absolute inset-0 flex items-center justify-center bg-black/25"><span className="flex h-12 w-12 items-center justify-center rounded-full bg-black/60 text-white"><Icon name="play" className="h-6 w-6" fill="currentColor" /></span></span>}
      {attachment.duration != null && !playing && <span className="absolute bottom-3 left-1/2 -translate-x-1/2 rounded-full bg-black/60 px-2 py-0.5 text-xs text-white">{clock(attachment.duration)}</span>}
    </button>
  )
}
