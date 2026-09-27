import { store } from '../state/store'
import { showToast } from './toast'

// Derived from the preload contract (Window['planetNav']) instead of importing types across the
// preload/renderer boundary, so this stays in sync with src/preload/index.d.ts automatically.
type AppSettings = Awaited<ReturnType<Window['planetNav']['settings']['get']>>
type SetupStatus = Awaited<ReturnType<Window['planetNav']['setup']['status']>>
type InstallResult = Awaited<ReturnType<Window['planetNav']['setup']['installBepInEx']>>

const HINT_DELAY_MS = 10_000
const GAME_BUILD = '25296421'
const GAME_VERSION = 'v2.103'

function bridge(): Window['planetNav'] | null {
  const api = (window as Partial<Window>).planetNav
  return api && typeof api.setup === 'object' ? api : null
}

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag)
  if (className) node.className = className
  if (text !== undefined) node.textContent = text
  return node
}

function statusRow(label: string): { row: HTMLElement; dot: HTMLElement; text: HTMLElement } {
  const row = el('div', 'setup-row')
  const dot = el('span', 'dot')
  const text = el('span', 'setup-row-text', label)
  row.append(dot, text)
  return { row, dot, text }
}

/** Slide-in panel appended to <body> (not index.html — same pattern as toast.ts's container). */
export function mountSettingsPane(toolbarEl: HTMLElement): { open(): void } {
  const api = bridge()

  const gearBtn = el('button', 'tb-btn tb-icon', '⚙')
  gearBtn.type = 'button'
  gearBtn.title = 'Settings'
  gearBtn.setAttribute('aria-label', 'Settings')
  toolbarEl.appendChild(gearBtn)

  const overlay = el('div', 'settings-overlay')
  const pane = el('aside', 'settings-pane')
  pane.setAttribute('role', 'dialog')
  pane.setAttribute('aria-label', 'Settings')

  const header = el('div', 'settings-header')
  header.append(el('span', 'settings-title', 'Settings'))
  const closeBtn = el('button', 'tb-btn', '✕')
  closeBtn.type = 'button'
  closeBtn.title = 'Close'
  header.appendChild(closeBtn)

  const body = el('div', 'settings-body')
  pane.append(header, body)
  document.body.append(overlay, pane)

  // ---- open / close -------------------------------------------------------------

  function open(): void {
    overlay.classList.add('open')
    pane.classList.add('open')
    void refresh()
  }
  function close(): void {
    overlay.classList.remove('open')
    pane.classList.remove('open')
  }
  gearBtn.addEventListener('click', () => {
    if (pane.classList.contains('open')) close()
    else open()
  })
  closeBtn.addEventListener('click', close)
  overlay.addEventListener('click', close)
  document.addEventListener('keydown', (ev) => {
    if (ev.key === 'Escape' && pane.classList.contains('open')) close()
  })

  // ---- Window section -------------------------------------------------------------

  const winSection = el('section', 'settings-section')
  winSection.append(el('h4', 'settings-section-title', 'Window'))

  const alwaysOnTopRow = el('label', 'settings-field')
  const alwaysOnTopInput = el('input', 'settings-checkbox')
  alwaysOnTopInput.type = 'checkbox'
  alwaysOnTopRow.append(alwaysOnTopInput, el('span', undefined, 'Always on top'))

  const startMinRow = el('label', 'settings-field')
  const startMinInput = el('input', 'settings-checkbox')
  startMinInput.type = 'checkbox'
  startMinRow.append(startMinInput, el('span', undefined, 'Start minimized to tray'))

  const opacityRow = el('div', 'settings-field settings-field-col')
  const opacityLabelRow = el('div', 'settings-slider-label')
  const opacityLabel = el('span', undefined, 'Window opacity')
  const opacityValue = el('span', 'settings-slider-value', '100%')
  opacityLabelRow.append(opacityLabel, opacityValue)
  const opacityInput = el('input', 'settings-slider')
  opacityInput.type = 'range'
  opacityInput.min = '0.4'
  opacityInput.max = '1'
  opacityInput.step = '0.05'
  opacityRow.append(opacityLabelRow, opacityInput)

  winSection.append(alwaysOnTopRow, startMinRow, opacityRow)

  alwaysOnTopInput.addEventListener('change', () => {
    void api?.window.setAlwaysOnTop(alwaysOnTopInput.checked)
  })
  startMinInput.addEventListener('change', () => {
    void api?.settings.set({ startMinimized: startMinInput.checked })
  })
  opacityInput.addEventListener('input', () => {
    const v = Number(opacityInput.value)
    opacityValue.textContent = `${Math.round(v * 100)}%`
    void api?.settings.set({ windowOpacity: v })
  })

  // ---- Game setup section -----------------------------------------------------------

  const setupSection = el('section', 'settings-section')
  setupSection.append(el('h4', 'settings-section-title', 'Game setup'))

  const gameDirRow = el('div', 'settings-field settings-field-col')
  const gameDirLabel = el('div', 'settings-gamedir', 'Detecting…')
  const changeDirBtn = el('button', 'tb-btn', 'Change…')
  changeDirBtn.type = 'button'
  gameDirRow.append(gameDirLabel, changeDirBtn)

  const { row: gameRow, dot: gameDot, text: gameText } = statusRow('Game found')
  const { row: bepRow, dot: bepDot, text: bepText } = statusRow('BepInEx installed')
  const { row: pluginRow, dot: pluginDot, text: pluginText } = statusRow('Plugin installed')

  const runningHint = el('div', 'settings-hint settings-hint-warn', 'Close the game before installing.')
  runningHint.hidden = true

  const installBepBtn = el('button', 'tb-btn', 'Install BepInEx')
  installBepBtn.type = 'button'
  const installPluginBtn = el('button', 'tb-btn', 'Install / update plugin')
  installPluginBtn.type = 'button'
  const btnRow = el('div', 'settings-btn-row')
  btnRow.append(installBepBtn, installPluginBtn)

  const openLogsBtn = el('button', 'tb-btn', 'Open BepInEx log')
  openLogsBtn.type = 'button'

  const launchReminder = el(
    'div',
    'settings-hint',
    'After installing, launch the game once (and load a save) so PlanetNavigator connects.'
  )

  setupSection.append(
    gameDirRow,
    gameRow,
    bepRow,
    pluginRow,
    runningHint,
    btnRow,
    openLogsBtn,
    launchReminder
  )

  changeDirBtn.addEventListener('click', async () => {
    if (!api) return
    changeDirBtn.disabled = true
    try {
      const res = await api.setup.pickGameDir()
      if (res.ok) showToast('Game folder set.')
      else if (res.message && res.message !== 'Cancelled.') showToast(res.message, 'error')
    } catch (err) {
      showToast(`Failed to set game folder: ${message(err)}`, 'error')
    } finally {
      changeDirBtn.disabled = false
      void refresh()
    }
  })

  function wireInstall(btn: HTMLButtonElement, run: () => Promise<InstallResult>): void {
    btn.addEventListener('click', async () => {
      if (!api) return
      btn.disabled = true
      try {
        const res = await run()
        showToast(res.message, res.ok ? 'info' : 'error')
      } catch (err) {
        showToast(`Failed: ${message(err)}`, 'error')
      } finally {
        btn.disabled = false
        void refresh()
      }
    })
  }
  wireInstall(installBepBtn, () => api!.setup.installBepInEx())
  wireInstall(installPluginBtn, () => api!.setup.installPlugin())

  openLogsBtn.addEventListener('click', async () => {
    if (!api) return
    try {
      const res = await api.setup.openLogs()
      if (!res.ok) showToast(res.message, 'warn')
    } catch (err) {
      showToast(`Failed: ${message(err)}`, 'error')
    }
  })

  // ---- About section ----------------------------------------------------------------

  const aboutSection = el('section', 'settings-section')
  aboutSection.append(el('h4', 'settings-section-title', 'About'))
  aboutSection.append(el('div', 'settings-about-row', `PlanetNavigator ${api?.app.version ?? ''}`.trim()))
  aboutSection.append(el('div', 'settings-about-row', `Tested against game build ${GAME_BUILD} / ${GAME_VERSION}`))

  const notice = el('details', 'settings-notice')
  const noticeSummary = el('summary', undefined, 'Third-party notices')
  const noticeBody = el('div', 'settings-notice-body')
  noticeBody.append(
    el(
      'p',
      undefined,
      'Map imagery derived from akarnokd/ThePlanetCrafterMods, licensed under the Apache License 2.0.'
    ),
    el('p', undefined, 'BepInEx (LGPL-2.1) is downloaded and redistributed unmodified by the installer above.'),
    el('p', undefined, 'OpenLayers (BSD-2-Clause) and Electron (MIT). See NOTICE in the project root for details.')
  )
  notice.append(noticeSummary, noticeBody)
  aboutSection.append(notice)

  body.append(winSection, setupSection, aboutSection)

  // ---- data ---------------------------------------------------------------------------

  function applySettings(s: AppSettings): void {
    alwaysOnTopInput.checked = s.alwaysOnTop
    startMinInput.checked = s.startMinimized
    opacityInput.value = String(s.windowOpacity)
    opacityValue.textContent = `${Math.round(s.windowOpacity * 100)}%`
  }

  function applyStatus(status: SetupStatus): void {
    gameDirLabel.textContent = status.gameDir ?? 'No game folder set'
    gameDirLabel.title = status.gameDir ?? ''

    setDot(gameDot, status.gameFound ? 'ok' : 'err')
    gameText.textContent = status.gameFound ? 'Game found' : 'Game not found'

    setDot(bepDot, status.bepinexInstalled ? 'ok' : 'err')
    bepText.textContent = status.bepinexInstalled ? 'BepInEx installed' : 'BepInEx not installed'

    if (status.pluginInstalled && status.pluginUpToDate) {
      setDot(pluginDot, 'ok')
      pluginText.textContent = 'Plugin installed (up to date)'
    } else if (status.pluginInstalled) {
      setDot(pluginDot, 'warn')
      pluginText.textContent = 'Plugin installed (update available)'
    } else {
      setDot(pluginDot, 'err')
      pluginText.textContent = 'Plugin not installed'
    }

    runningHint.hidden = !status.gameRunning
    installBepBtn.disabled = status.gameRunning || !status.gameFound
    installPluginBtn.disabled = status.gameRunning || !status.gameFound
    openLogsBtn.disabled = !status.gameDir
  }

  function setDot(dot: HTMLElement, kind: 'ok' | 'warn' | 'err'): void {
    dot.classList.remove('dot-ok', 'dot-warn', 'dot-err')
    dot.classList.add(`dot-${kind}`)
  }

  async function refresh(): Promise<void> {
    if (!api) return
    try {
      const [settings, status] = await Promise.all([api.settings.get(), api.setup.status()])
      applySettings(settings)
      applyStatus(status)
    } catch (err) {
      console.warn('[SettingsPane] refresh failed', err)
    }
  }

  void refresh()

  return { open }
}

function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

/**
 * Shows a one-time hint toast if the game stays undetected (searching/disconnected) for more
 * than 10 s and the plugin isn't installed yet. Call once at startup.
 */
export function watchConnectionHint(): void {
  let timer: number | undefined
  let shown = false

  const isBad = (c: string): boolean => c === 'searching' || c === 'disconnected'

  const clearTimer = (): void => {
    if (timer !== undefined) {
      window.clearTimeout(timer)
      timer = undefined
    }
  }

  const arm = (): void => {
    clearTimer()
    timer = window.setTimeout(() => {
      timer = undefined
      void maybeShow()
    }, HINT_DELAY_MS)
  }

  async function maybeShow(): Promise<void> {
    if (shown || !isBad(store.get().connection)) return
    const api = bridge()
    if (!api) return
    try {
      const status = await api.setup.status()
      if (status.pluginInstalled) return
    } catch {
      return
    }
    shown = true
    showToast('Game not detected — open Settings › Game setup', 'warn', 10_000)
  }

  store.subscribe((s, prev) => {
    if (isBad(s.connection) === isBad(prev.connection)) return
    if (isBad(s.connection)) arm()
    else clearTimer()
  })

  if (isBad(store.get().connection)) arm()
}
