// 1:1 WebRTC calls. Signaling goes through the app WebSocket; media is peer-to-peer.
import { api } from './api'
import { sendWs, useStore } from '../store'
import { beep } from './alerts'

let pc = null
let pendingIce = []
let remoteDescSet = false
let ringTimer = null
let iceServers = null
let iceFetchedAt = 0
let ringInterval = null

/** Ringtone (incoming) / ringback (outgoing). Stopped whenever the call state changes. */
export function startRing(kind) {
  stopRing()
  const play = () => beep(kind === 'incoming' ? 660 : 440)
  play()
  ringInterval = setInterval(play, kind === 'incoming' ? 1600 : 3000)
}
export function stopRing() { clearInterval(ringInterval); ringInterval = null }

const set = (patch) => useStore.setState((s) => ({ call: s.call ? { ...s.call, ...patch } : s.call }))
const getCall = () => useStore.getState().call

export async function getIce() {
  // TURN credentials are short-lived, so refetch when older than ~10 minutes
  if (!iceServers || Date.now() - iceFetchedAt > 600000) {
    try { iceServers = (await api.get('/calls/ice')).iceServers; iceFetchedAt = Date.now() } catch { iceServers ??= [{ urls: ['stun:stun.l.google.com:19302'] }] }
  }
  return iceServers
}

const AUDIO = { echoCancellation: true, noiseSuppression: true, autoGainControl: true }

export function describeMediaError(err, what) {
  switch (err?.name) {
    case 'NotAllowedError':
    case 'SecurityError':
      return `Permission to use your ${what} was blocked. Click the camera/lock icon in the address bar, allow it, then try again.`
    case 'NotFoundError':
    case 'DevicesNotFoundError':
      return `No ${what} was found. Plug one in or enable it in system settings.`
    case 'NotReadableError':
    case 'TrackStartError':
      return `Your ${what} is being used by another app or browser tab. Close it and try again.`
    default:
      return `Cannot access your ${what} (${err?.name || 'unknown error'})`
  }
}

/**
 * Returns { stream, videoUnavailable }. The microphone is required; if only the camera fails the call
 * continues audio-only instead of aborting.
 */
export async function getMedia(kind) {
  if (!navigator.mediaDevices?.getUserMedia) throw new Error('Calls need HTTPS or localhost and a supported browser')
  const gum = (c) => navigator.mediaDevices.getUserMedia(c)
  if (kind !== 'video') {
    try { return { stream: await gum({ audio: AUDIO, video: false }) } } catch (e) { throw new Error(describeMediaError(e, 'microphone')) }
  }
  // 1) preferred constraints  2) plain video  3) audio only
  for (const video of [{ width: { ideal: 1280 }, height: { ideal: 720 } }, true]) {
    try { return { stream: await gum({ audio: AUDIO, video }) } } catch (e) {
      if (e.name === 'NotAllowedError' || e.name === 'SecurityError') throw new Error(describeMediaError(e, 'camera/microphone'))
    }
  }
  try {
    const stream = await gum({ audio: AUDIO, video: false })
    useStore.getState().toast({ kind: 'error', title: 'Camera unavailable. Continuing with audio only.', duration: 6000 })
    return { stream, videoUnavailable: true }
  } catch (e) { throw new Error(describeMediaError(e, 'microphone')) }
}

async function createPc(stream) {
  pendingIce = []
  remoteDescSet = false
  pc = new RTCPeerConnection({ iceServers: await getIce() })
  stream.getTracks().forEach((t) => pc.addTrack(t, stream))
  const remote = new MediaStream()
  set({ remoteStream: remote })
  pc.ontrack = (e) => { e.streams[0]?.getTracks().forEach((t) => remote.addTrack(t)); set({ remoteStream: remote, tick: Math.random() }) }
  pc.onicecandidate = (e) => {
    const c = getCall()
    if (e.candidate && c?.id) sendWs({ type: 'call.signal', call_id: c.id, data: { candidate: e.candidate } })
  }
  pc.onconnectionstatechange = () => {
    if (pc?.connectionState === 'connected') set({ phase: 'connected', startedAt: Date.now() })
    if (['failed', 'closed'].includes(pc?.connectionState) && getCall()?.phase === 'connected') hangup()
  }
}

function cleanup(finalPhase, message) {
  clearTimeout(ringTimer)
  stopRing()
  const c = getCall()
  c?.localStream?.getTracks().forEach((t) => t.stop())
  pc?.close()
  pc = null
  pendingIce = []
  if (!c) return
  useStore.setState({ call: { ...c, phase: finalPhase, message, localStream: null, remoteStream: null } })
  setTimeout(() => { if (getCall()?.phase === finalPhase) useStore.setState({ call: null }) }, 2200)
}

export function resetCall() {
  clearTimeout(ringTimer)
  stopRing()
  getCall()?.localStream?.getTracks().forEach((t) => t.stop())
  pc?.close()
  pc = null
}

export async function startCall(peer, kind, chatId) {
  if (getCall()) return
  try {
    const { stream, videoUnavailable } = await getMedia(kind)
    useStore.setState({ call: { id: null, peer, kind, chatId, direction: 'outgoing', phase: 'calling', localStream: stream, remoteStream: null, muted: false, camOff: !!videoUnavailable, noCamera: !!videoUnavailable } })
    if (!sendWs({ type: 'call.invite', to_user_id: peer.id, kind, chat_id: chatId })) throw new Error('Not connected')
    startRing('outgoing')
    ringTimer = setTimeout(() => { if (getCall()?.phase === 'calling') hangup('No answer') }, 45000)
  } catch (e) {
    useStore.getState().error(e)
    cleanup('ended')
  }
}

export async function acceptCall() {
  const c = getCall()
  if (!c || c.phase !== 'ringing') return
  stopRing()
  try {
    const { stream, videoUnavailable } = await getMedia(c.kind)
    set({ localStream: stream, phase: 'connecting', camOff: !!videoUnavailable, noCamera: !!videoUnavailable })
    await createPc(stream)
    sendWs({ type: 'call.accept', call_id: c.id })
  } catch (e) {
    useStore.getState().error(e)
    sendWs({ type: 'call.reject', call_id: c.id })
    cleanup('ended')
  }
}

export function rejectCall() {
  const c = getCall()
  if (c) sendWs({ type: 'call.reject', call_id: c.id })
  cleanup('ended', 'Call declined')
}

export function hangup(message = 'Call ended') {
  const c = getCall()
  if (c?.id) sendWs({ type: 'call.end', call_id: c.id })
  cleanup('ended', message)
}

export function toggleMute() {
  const c = getCall()
  if (!c?.localStream) return
  const muted = !c.muted
  c.localStream.getAudioTracks().forEach((t) => (t.enabled = !muted))
  set({ muted })
  sendState(c.id, muted, c.camOff)
}

function sendState(id, muted, camOff) {
  if (id) sendWs({ type: 'call.signal', call_id: id, data: { state: { muted, camOff } } })
}

/** Silence the other person on your side only (their audio stops playing here). */
export function toggleSpeaker() {
  const c = getCall()
  if (c) set({ speakerOff: !c.speakerOff })
}

export function toggleCamera() {
  const c = getCall()
  if (!c?.localStream) return
  const camOff = !c.camOff
  c.localStream.getVideoTracks().forEach((t) => (t.enabled = !camOff))
  set({ camOff })
  sendState(c.id, c.muted, camOff)
}

async function flushIce() {
  for (const c of pendingIce) await pc.addIceCandidate(c).catch(() => {})
  pendingIce = []
}

export async function handleCallEvent(e) {
  const c = getCall()
  switch (e.type) {
    case 'call.incoming':
      if (c) { sendWs({ type: 'call.reject', call_id: e.call_id }); return }
      useStore.setState({ call: { id: e.call_id, peer: e.from, kind: e.kind, chatId: e.chat_id, direction: 'incoming', phase: 'ringing', localStream: null, remoteStream: null, muted: false, camOff: false } })
      startRing('incoming')
      ringTimer = setTimeout(() => { if (getCall()?.phase === 'ringing') rejectCall() }, 45000)
      break
    case 'call.ringing':
      set({ id: e.call_id })
      break
    case 'call.busy': cleanup('ended', 'User is busy'); break
    case 'call.unavailable': cleanup('ended', 'User is offline'); break
    case 'call.rejected': cleanup('ended', 'Call declined'); break
    case 'call.ended': cleanup('ended', 'Call ended'); break
    case 'call.accepted':
      if (!c || c.id !== e.call_id) return
      clearTimeout(ringTimer)
      stopRing()
      set({ phase: 'connecting' })
      try {
        await createPc(c.localStream)
        const offer = await pc.createOffer()
        await pc.setLocalDescription(offer)
        sendWs({ type: 'call.signal', call_id: c.id, data: { sdp: pc.localDescription } })
      } catch (err) { useStore.getState().error(err); hangup() }
      break
    case 'call.signal': {
      if (e.data?.state) { if (c && c.id === e.call_id) set({ peerMuted: !!e.data.state.muted, peerCamOff: !!e.data.state.camOff }); return }
      if (!c || c.id !== e.call_id || !pc) { if (e.data?.candidate) pendingIce.push(e.data.candidate); return }
      const { sdp, candidate } = e.data
      try {
        if (sdp) {
          await pc.setRemoteDescription(sdp)
          remoteDescSet = true
          await flushIce()
          if (sdp.type === 'offer') {
            const answer = await pc.createAnswer()
            await pc.setLocalDescription(answer)
            sendWs({ type: 'call.signal', call_id: c.id, data: { sdp: pc.localDescription } })
          }
        } else if (candidate) {
          remoteDescSet ? await pc.addIceCandidate(candidate) : pendingIce.push(candidate)
        }
      } catch (err) { console.error('signal error', err) }
      break
    }
    default:
  }
}

/** Gather ICE candidates with the server-provided config and report what the network can do. */
export async function testCallSetup(timeoutMs = 6000) {
  const servers = await getIce()
  const found = { host: 0, srflx: 0, relay: 0 }
  const conn = new RTCPeerConnection({ iceServers: servers })
  conn.createDataChannel('probe')
  const done = new Promise((resolve) => {
    const t = setTimeout(resolve, timeoutMs)
    conn.onicecandidate = (e) => {
      if (!e.candidate) { clearTimeout(t); resolve(); return }
      const type = / typ (\w+)/.exec(e.candidate.candidate)?.[1]
      if (type in found) found[type] += 1
    }
  })
  await conn.setLocalDescription(await conn.createOffer())
  await done
  conn.close()
  return { ...found, hasTurn: servers.some((s) => s.username) }
}
