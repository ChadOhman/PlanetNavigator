import { getPlanetDef } from '@shared/planets'
import type { ModClient } from '../api/client'
import { store, type VariantChoice } from '../state/store'
import { showToast } from './toast'

const VARIANTS: { id: VariantChoice; label: string }[] = [
  { id: 'auto', label: 'Auto' },
  { id: 'barren', label: 'Barren' },
  { id: 'lush', label: 'Lush' },
  { id: 'endgame', label: 'Endgame' }
]

function button(text: string, title: string): HTMLButtonElement {
  const b = document.createElement('button')
  b.type = 'button'
  b.className = 'tb-btn'
  b.textContent = text
  b.title = title
  return b
}

/**
 * Follow toggle, variant segmented control, Rescan button, and the planet label.
 * `getEffectiveVariant` reports what "Auto" currently resolves to (shown as a tooltip).
 */
export function mountToolbar(
  el: HTMLElement,
  planetLabel: HTMLElement,
  client: ModClient,
  getEffectiveVariant: () => string | null
): void {
  const follow = button('Follow', 'Keep the map centred on your position')
  follow.addEventListener('click', () => store.set({ follow: !store.get().follow }))

  const seg = document.createElement('div')
  seg.className = 'segmented'
  seg.setAttribute('role', 'group')
  const segButtons = new Map<VariantChoice, HTMLButtonElement>()
  for (const v of VARIANTS) {
    const b = button(v.label, `Show ${v.label.toLowerCase()} imagery`)
    b.addEventListener('click', () => store.set({ variant: v.id }))
    segButtons.set(v.id, b)
    seg.appendChild(b)
  }

  const rescan = button('Rescan', 'Ask the game to rescan nearby resources')
  rescan.addEventListener('click', async () => {
    rescan.disabled = true
    try {
      await client.sendCommand({ type: 'rescan' })
      showToast('Rescan requested')
    } catch (err) {
      showToast(`Rescan failed: ${err instanceof Error ? err.message : String(err)}`, 'error')
    } finally {
      rescan.disabled = false
    }
  })

  el.replaceChildren(follow, seg, rescan)

  const render = (): void => {
    const s = store.get()
    follow.classList.toggle('active', s.follow)
    follow.setAttribute('aria-pressed', String(s.follow))
    const hasEndgame = s.planet ? getPlanetDef(s.planet).variants.includes('endgame') : false
    for (const [id, b] of segButtons) {
      b.classList.toggle('active', id === s.variant)
      b.setAttribute('aria-pressed', String(id === s.variant))
      if (id === 'endgame') b.hidden = !hasEndgame
    }
    const eff = getEffectiveVariant()
    segButtons.get('auto')!.title = eff ? `Automatic (currently ${eff})` : 'Automatic'
    rescan.disabled = s.connection !== 'connected'
    planetLabel.textContent = s.planet ? getPlanetDef(s.planet).name : '—'
  }

  store.subscribe((s, prev) => {
    if (
      s.follow !== prev.follow ||
      s.variant !== prev.variant ||
      s.planet !== prev.planet ||
      s.connection !== prev.connection ||
      s.status !== prev.status ||
      s.lastPosition?.ti !== prev.lastPosition?.ti
    )
      render()
  })
  render()
}
