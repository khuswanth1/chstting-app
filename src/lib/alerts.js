let audioCtx

export function beep(freq = 880) {
  try {
    audioCtx ||= new (window.AudioContext || window.webkitAudioContext)()
    const o = audioCtx.createOscillator()
    const g = audioCtx.createGain()
    o.type = 'sine'
    o.frequency.value = freq
    g.gain.setValueAtTime(0.0001, audioCtx.currentTime)
    g.gain.exponentialRampToValueAtTime(0.15, audioCtx.currentTime + 0.01)
    g.gain.exponentialRampToValueAtTime(0.0001, audioCtx.currentTime + 0.25)
    o.connect(g).connect(audioCtx.destination)
    o.start()
    o.stop(audioCtx.currentTime + 0.26)
  } catch { /* autoplay policy or no audio */ }
}

export const desktopSupported = () => typeof Notification !== 'undefined'
export const desktopPermission = () => (desktopSupported() ? Notification.permission : 'denied')

export async function requestDesktopPermission() {
  if (!desktopSupported()) return 'denied'
  return Notification.requestPermission()
}

export function desktopNotify(title, body, { tag, onClick } = {}) {
  if (!desktopSupported() || Notification.permission !== 'granted') return
  try {
    const n = new Notification(title, { body, tag, silent: true })
    n.onclick = () => { window.focus(); onClick?.(); n.close() }
  } catch { /* some browsers only allow via service worker */ }
}
