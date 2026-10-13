// Group calls as a WebRTC mesh: one RTCPeerConnection per remote participant.
// The newcomer sends the offers (so two people never offer to each other at once); existing members answer.
import { api } from './api'
import { sendWs, useStore } from '../store'
import { beep } from './alerts'
import { getIce, getMedia } from './call'

const peers = new Map() // userId -> Promise<{ pc, pending: [], remoteSet }>

const G = () => useStore.getState().gcall
const setG = (patch) => useStore.setState((s) => (s.gcall ? { gcall: { ...s.gcall, ...(typeof patch === 'function' ? patch(s.gcall) : patch) } } : {}))
const setPeer = (id, patch) => setG((g) => ({ peers: { ...g.peers, [id]: { ...(g.peers[id] || {}), ...patch } } }))
const toast = (t) => useStore.getState().toast(t)

export async function loadActiveRooms() {
  try {
    const rooms = await api.get('/calls/group/active')
    useStore.setState({ groupRooms: Object.fromEntries(rooms.map((r) => [r.chat_id, r])) })
  } catch { /* ignore */ }
}

async function enter(chatId, kind, evt) {
  const s = useStore.getState()
  if (s.call || s.gcall) return toast({ kind: 'error', title: 'Finish your current call first' })
  try {
    const { stream, videoUnavailable } = await getMedia(kind)
    useStore.setState({
      gcall: { chatId, kind, phase: 'joining', localStream: stream, muted: false, camOff: !!videoUnavailable, noCamera: !!videoUnavailable, peers: {} },
    })
    if (!sendWs({ type: evt, chat_id: chatId, kind })) throw new Error('Not connected to the server')
  } catch (e) {
    useStore.getState().error(e)
    cleanupLocal()
  }
}

export const startGroupCall = (chatId, kind) => enter(chatId, kind, 'group.call.start')
export function joinGroupCall(chatId) {
  const room = useStore.getState().groupRooms[chatId]
  return enter(chatId, room?.kind || 'audio', 'group.call.join')
}

function cleanupLocal(message) {
  const g = G()
  g?.localStream?.getTracks().forEach((t) => t.stop())
  peers.forEach((p) => p.then((e) => e.pc.close()).catch(() => {}))
  peers.clear()
  useStore.setState({ gcall: null })
  if (message) toast({ kind: 'info', title: message })
}

export function leaveGroupCall() {
  const g = G()
  if (g) sendWs({ type: 'group.call.leave', chat_id: g.chatId })
  cleanupLocal()
}
export const resetGroupCall = () => cleanupLocal()
export const dropGroupCall = () => G() && cleanupLocal('Connection lost: the group call ended for you')

function ensurePeer(uid) {
  if (!peers.has(uid)) {
    peers.set(uid, (async () => {
      const pc = new RTCPeerConnection({ iceServers: await getIce() })
      const entry = { pc, pending: [], remoteSet: false }
      const local = G()?.localStream
      local?.getTracks().forEach((t) => pc.addTrack(t, local))
      pc.onicecandidate = (e) => {
        const g = G()
        if (e.candidate && g) sendWs({ type: 'group.call.signal', chat_id: g.chatId, to_user_id: uid, data: { candidate: e.candidate } })
      }
      pc.ontrack = (e) => setPeer(uid, { stream: e.streams[0], v: Math.random() })
      return entry
    })())
  }
  return peers.get(uid)
}

async function offerTo(uid) {
  const { pc } = await ensurePeer(uid)
  await pc.setLocalDescription(await pc.createOffer())
  sendWs({ type: 'group.call.signal', chat_id: G().chatId, to_user_id: uid, data: { sdp: pc.localDescription } })
}

async function onSignal(e) {
  if (!G() || G().chatId !== e.chat_id) return
  const entry = await ensurePeer(e.from_user_id)
  const { sdp, candidate } = e.data
  try {
    if (sdp) {
      await entry.pc.setRemoteDescription(sdp)
      entry.remoteSet = true
      for (const c of entry.pending.splice(0)) await entry.pc.addIceCandidate(c).catch(() => {})
      if (sdp.type === 'offer') {
        await entry.pc.setLocalDescription(await entry.pc.createAnswer())
        sendWs({ type: 'group.call.signal', chat_id: e.chat_id, to_user_id: e.from_user_id, data: { sdp: entry.pc.localDescription } })
      }
    } else if (candidate) {
      entry.remoteSet ? await entry.pc.addIceCandidate(candidate).catch(() => {}) : entry.pending.push(candidate)
    }
  } catch (err) { console.error('group signal error', err) }
}

function sendState() {
  const g = G()
  if (g) sendWs({ type: 'group.call.state', chat_id: g.chatId, muted: g.muted, cam_off: g.camOff })
}

export function toggleGroupMute(force) {
  const g = G()
  if (!g) return
  const muted = force ?? !g.muted
  g.localStream.getAudioTracks().forEach((t) => (t.enabled = !muted))
  setG({ muted, unmuteRequested: false })
  sendState()
}

export function toggleGroupCamera() {
  const g = G()
  if (!g || g.noCamera) return
  const camOff = !g.camOff
  g.localStream.getVideoTracks().forEach((t) => (t.enabled = !camOff))
  setG({ camOff })
  sendState()
}

/** Mute somebody for yourself only (stops playing their audio locally). */
export const toggleSpeaker = (uid) => setPeer(uid, { speakerOff: !G()?.peers[uid]?.speakerOff })

/** Silence (or restore) everybody's audio on your side only. */
export function setAllSpeakers(off) {
  setG((g) => ({ peers: Object.fromEntries(Object.entries(g.peers).map(([id, p]) => [id, { ...p, speakerOff: off }])) }))
}

/** Group admins can ask others to mute (their client mutes itself) or to unmute (a request they can accept). */
export const askToMute = (uid, mute = true) => G() && sendWs({ type: 'group.call.mute', chat_id: G().chatId, user_id: uid, mute })
export function muteAll() {
  Object.entries(G()?.peers || {}).forEach(([uid, p]) => !p.muted && askToMute(Number(uid), true))
}
export function askAllToUnmute() {
  Object.entries(G()?.peers || {}).forEach(([uid, p]) => p.muted && askToMute(Number(uid), false))
}

export async function handleGroupCallEvent(e) {
  const rooms = useStore.getState().groupRooms
  const setRooms = (r) => useStore.setState({ groupRooms: r })
  switch (e.type) {
    case 'group.call.incoming': {
      setRooms({ ...rooms, [e.room.chat_id]: e.room })
      if (!G() && !useStore.getState().call) {
        beep(660)
        toast({ kind: 'message', title: `${e.from.display_name} started a group ${e.room.kind} call`, body: `${e.chat_name || 'Group'} · tap to open the chat and join`, chatId: e.room.chat_id, duration: 12000 })
      }
      break
    }
    case 'group.call.updated':
      setRooms({ ...rooms, [e.room.chat_id]: e.room })
      break
    case 'group.call.ended': {
      const { [e.chat_id]: _, ...rest } = rooms
      setRooms(rest)
      if (G()?.chatId === e.chat_id) cleanupLocal('The call has ended')
      break
    }
    case 'group.call.joined': {
      const g = G()
      if (!g || g.chatId !== e.room.chat_id) return
      const others = e.room.participants.filter((p) => p.id !== e.self_id)
      setG({
        phase: 'connected', startedAt: Date.now(),
        peers: Object.fromEntries(others.map((p) => [p.id, { user: p, stream: null, muted: p.muted, camOff: p.cam_off, speakerOff: false }])),
      })
      if (g.camOff) sendState()
      for (const p of others) await offerTo(p.id).catch((err) => console.error('offer failed', err))
      break
    }
    case 'group.call.participant_joined':
      if (G()?.chatId === e.chat_id) setPeer(e.user.id, { user: e.user, stream: null, muted: e.user.muted, camOff: e.user.cam_off, speakerOff: false })
      break
    case 'group.call.participant_left': {
      const g = G()
      if (!g || g.chatId !== e.chat_id) return
      peers.get(e.user_id)?.then((p) => p.pc.close()).catch(() => {})
      peers.delete(e.user_id)
      setG((cur) => { const { [e.user_id]: _, ...rest } = cur.peers; return { peers: rest } })
      break
    }
    case 'group.call.signal':
      await onSignal(e)
      break
    case 'group.call.state':
      if (G()?.chatId === e.chat_id && G().peers[e.user_id]) setPeer(e.user_id, { muted: e.muted, camOff: e.cam_off })
      break
    case 'group.call.muted_by_admin':
      if (G()?.chatId === e.chat_id) { toggleGroupMute(true); toast({ kind: 'info', title: `${e.by} muted you. Tap the mic to unmute.` }) }
      break
    case 'group.call.unmute_requested':
      if (G()?.chatId === e.chat_id && G().muted) {
        setG({ unmuteRequested: true })
        toast({ kind: 'info', title: `${e.by} asked you to unmute`, body: 'Tap the microphone button to unmute.', duration: 8000 })
      }
      break
    default:
  }
}
