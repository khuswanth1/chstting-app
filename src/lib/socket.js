import { WS_URL } from './api'

/** WebSocket wrapper with auto-reconnect (exponential backoff) and heartbeat. */
export class Socket {
  constructor({ onEvent, onStatus }) {
    this.onEvent = onEvent
    this.onStatus = onStatus
    this.ws = null
    this.token = null
    this.retry = 0
    this.closed = true
  }

  connect(token) {
    this.token = token
    this.closed = false
    this._open()
  }

  _open() {
    if (this.closed) return
    const ws = new WebSocket(`${WS_URL}?token=${encodeURIComponent(this.token)}`)
    this.ws = ws
    ws.onopen = () => {
      this.retry = 0
      this.onStatus('open')
      clearInterval(this.hb)
      this.hb = setInterval(() => this.send({ type: 'ping' }), 25000)
    }
    ws.onmessage = (e) => {
      try { this.onEvent(JSON.parse(e.data)) } catch (err) { console.error('bad ws event', err) }
    }
    ws.onclose = (e) => {
      clearInterval(this.hb)
      this.onStatus('closed')
      if (this.closed || e.code === 4401) return
      const delay = Math.min(15000, 500 * 2 ** this.retry++)
      this.timer = setTimeout(() => this._open(), delay)
    }
    ws.onerror = () => ws.close()
  }

  send(obj) {
    if (this.ws?.readyState === WebSocket.OPEN) { this.ws.send(JSON.stringify(obj)); return true }
    return false
  }

  close() {
    this.closed = true
    clearTimeout(this.timer)
    clearInterval(this.hb)
    this.ws?.close()
  }
}
