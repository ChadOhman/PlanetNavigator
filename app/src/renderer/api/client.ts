import type {
  ApiCommand,
  ApiPlanetEvent,
  ApiPois,
  ApiPoisEvent,
  ApiPosition,
  ApiStatus,
  ConnectionState
} from '@shared/api'

export const PORTS = [27641, 27642, 27643, 27644, 27645, 27646]
const PROBE_TIMEOUT_MS = 500
const BACKOFF_MIN_MS = 1000
const BACKOFF_MAX_MS = 10_000
const REPROBE_AFTER_FAILURES = 3
const POSITION_WATCHDOG_MS = 5000
const POLL_INTERVAL_MS = 100

export interface ClientEvents {
  position: ApiPosition
  planet: ApiPlanetEvent
  pois: ApiPoisEvent
  open: void
  error: unknown
  state: ConnectionState
}

type Handler<T> = (payload: T) => void
type HandlerMap = { [K in keyof ClientEvents]: Set<Handler<ClientEvents[K]>> }

export class ModClient {
  private base: string | null = null
  private es: EventSource | null = null
  private handlers: HandlerMap = {
    position: new Set(),
    planet: new Set(),
    pois: new Set(),
    open: new Set(),
    error: new Set(),
    state: new Set()
  }
  private failures = 0
  private reconnectTimer: number | undefined
  private watchdogTimer: number | undefined
  private pollTimer: number | undefined
  private pollInFlight = false
  private gotSsePosition = false
  private stopped = true
  private _state: ConnectionState = 'searching'

  get baseUrl(): string | null {
    return this.base
  }

  get state(): ConnectionState {
    return this._state
  }

  on<K extends keyof ClientEvents>(type: K, fn: Handler<ClientEvents[K]>): () => void {
    const set = this.handlers[type]
    set.add(fn)
    return () => set.delete(fn)
  }

  private emit<K extends keyof ClientEvents>(type: K, payload: ClientEvents[K]): void {
    for (const fn of this.handlers[type]) {
      try {
        fn(payload)
      } catch (err) {
        console.error(`[ModClient] ${type} handler failed`, err)
      }
    }
  }

  private setState(s: ConnectionState): void {
    if (s === this._state) return
    this._state = s
    this.emit('state', s)
  }

  /**
   * Scans ports 27641..27646 with GET /api/status (500 ms timeout each, run in parallel)
   * and remembers the lowest port that answers. Returns its status, or null.
   */
  async probe(): Promise<ApiStatus | null> {
    const results = await Promise.all(
      PORTS.map(async (port) => {
        const base = `http://127.0.0.1:${port}`
        try {
          const res = await fetch(`${base}/api/status`, {
            signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
            cache: 'no-store'
          })
          if (!res.ok) return null
          const status = (await res.json()) as ApiStatus
          return { base, status }
        } catch {
          return null
        }
      })
    )
    const hit = results.find((r) => r !== null) ?? null
    if (hit) this.base = hit.base
    return hit ? hit.status : null
  }

  /** Probes and keeps an SSE connection open (reconnecting as needed) until stop(). */
  start(): void {
    if (!this.stopped) return
    this.stopped = false
    this.failures = 0
    void this.connectLoop(true)
  }

  stop(): void {
    this.stopped = true
    this.teardown()
    window.clearTimeout(this.reconnectTimer)
  }

  private async connectLoop(reprobe: boolean): Promise<void> {
    if (this.stopped) return
    if (reprobe || !this.base) {
      if (this._state !== 'disconnected') this.setState('searching')
      const status = await this.probe()
      if (this.stopped) return
      if (!status) {
        this.failures++
        this.scheduleReconnect(true)
        return
      }
    }
    this.connect()
  }

  /** Opens the EventSource on /api/events. Requires a successful probe(). */
  connect(): void {
    if (!this.base) throw new Error('ModClient.connect() called before a successful probe()')
    this.teardown()
    const es = new EventSource(`${this.base}/api/events`)
    this.es = es

    es.onopen = () => {
      this.failures = 0
      this.gotSsePosition = false
      this.emit('open', undefined)
      // Until a position arrives, "connected" vs "menu" comes from /api/status.
      this.fetchStatus()
        .then((s) => {
          if (this.es === es && !this.gotSsePosition && this.pollTimer === undefined)
            this.setState(s.planet ? 'connected' : 'menu')
        })
        .catch(() => undefined)
      window.clearTimeout(this.watchdogTimer)
      this.watchdogTimer = window.setTimeout(() => {
        if (this.es === es && !this.gotSsePosition) this.startPolling()
      }, POSITION_WATCHDOG_MS)
    }

    es.addEventListener('position', (ev) => {
      const pos = parseJson<ApiPosition>(ev)
      if (!pos) return
      this.gotSsePosition = true
      this.stopPolling()
      this.handlePosition(pos)
    })
    es.addEventListener('planet', (ev) => {
      const p = parseJson<ApiPlanetEvent>(ev)
      if (!p) return
      this.setState(p.planet ? 'connected' : 'menu')
      this.emit('planet', p)
    })
    es.addEventListener('pois', (ev) => {
      const p = parseJson<ApiPoisEvent>(ev)
      if (p) this.emit('pois', p)
    })

    es.onerror = (err) => {
      if (this.es !== es) return
      this.emit('error', err)
      // We drive reconnection ourselves (instead of EventSource's built-in retry) so we
      // control the backoff and can re-probe ports when the game restarts on another port.
      this.teardown()
      this.failures++
      this.setState('disconnected')
      this.scheduleReconnect(this.failures >= REPROBE_AFTER_FAILURES)
    }
  }

  /** Backoff 1 s, 2 s, 4 s, 8 s, 10 s, 10 s, ... */
  private scheduleReconnect(reprobe: boolean): void {
    if (this.stopped) return
    const attempt = Math.max(0, this.failures - 1)
    const delay = Math.min(BACKOFF_MIN_MS * 2 ** attempt, BACKOFF_MAX_MS)
    window.clearTimeout(this.reconnectTimer)
    this.reconnectTimer = window.setTimeout(() => void this.connectLoop(reprobe), delay)
  }

  private teardown(): void {
    if (this.es) {
      this.es.onopen = null
      this.es.onerror = null
      this.es.close()
      this.es = null
    }
    window.clearTimeout(this.watchdogTimer)
    this.stopPolling()
  }

  private handlePosition(pos: ApiPosition): void {
    this.setState(pos.planet ? 'connected' : 'menu')
    this.emit('position', pos)
  }

  // ---- fallback polling ---------------------------------------------------

  private startPolling(): void {
    if (this.pollTimer !== undefined) return
    console.warn('[ModClient] no SSE position events; falling back to polling /api/position')
    this.pollTimer = window.setInterval(() => void this.pollOnce(), POLL_INTERVAL_MS)
  }

  private stopPolling(): void {
    if (this.pollTimer === undefined) return
    window.clearInterval(this.pollTimer)
    this.pollTimer = undefined
  }

  private async pollOnce(): Promise<void> {
    if (this.pollInFlight || !this.base) return
    this.pollInFlight = true
    try {
      const res = await fetch(`${this.base}/api/position`, {
        cache: 'no-store',
        signal: AbortSignal.timeout(1000)
      })
      if (this.pollTimer === undefined) return
      if (res.status === 204) {
        this.setState('menu')
      } else if (res.ok) {
        this.handlePosition((await res.json()) as ApiPosition)
      }
    } catch {
      // SSE error handling drives reconnection; ignore transient poll errors.
    } finally {
      this.pollInFlight = false
    }
  }

  // ---- REST ---------------------------------------------------------------

  private url(path: string): string {
    if (!this.base) throw new Error('Not connected to the game')
    return `${this.base}${path}`
  }

  async fetchStatus(): Promise<ApiStatus> {
    const res = await fetch(this.url('/api/status'), { cache: 'no-store' })
    if (!res.ok) throw new Error(`GET /api/status -> ${res.status}`)
    return (await res.json()) as ApiStatus
  }

  /** Returns null when the server answers 304 (nothing newer than `since`). */
  async fetchPois(since?: number | null): Promise<ApiPois | null> {
    const q = since === undefined || since === null ? '' : `?since=${encodeURIComponent(since)}`
    const res = await fetch(this.url(`/api/pois${q}`), { cache: 'no-store' })
    if (res.status === 304) return null
    if (!res.ok) throw new Error(`GET /api/pois -> ${res.status}`)
    return (await res.json()) as ApiPois
  }

  async sendCommand(cmd: ApiCommand): Promise<void> {
    // text/plain keeps this a CORS "simple request", so no OPTIONS preflight is needed.
    const res = await fetch(this.url('/api/command'), {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=UTF-8' },
      body: JSON.stringify(cmd)
    })
    if (!res.ok) throw new Error(`POST /api/command -> ${res.status}`)
  }
}

function parseJson<T>(ev: Event): T | null {
  try {
    return JSON.parse((ev as MessageEvent<string>).data) as T
  } catch (err) {
    console.warn('[ModClient] bad SSE payload', err)
    return null
  }
}
