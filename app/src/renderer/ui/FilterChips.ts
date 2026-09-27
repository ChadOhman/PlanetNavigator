import {
  CATEGORY_LABELS,
  CATEGORY_ORDER,
  DEFAULT_ENABLED_CATEGORIES,
  getPoiGroupInfo,
  type PoiCategory
} from '@shared/poiGroups'
import { store } from '../state/store'

/**
 * Filter UI: one section per category present in the POI cache, with a clickable header that
 * toggles the whole category and group chips beneath that toggle individually (via
 * `disabledGroups`) regardless of the category's own state. "All" enables every category and
 * clears per-group opt-outs; "Default" resets to `DEFAULT_ENABLED_CATEGORIES`.
 */
export function mountFilterChips(el: HTMLElement): void {
  el.addEventListener('click', (ev) => {
    const target = ev.target as HTMLElement

    if (target.closest<HTMLButtonElement>('button[data-hide-stored]')) {
      store.set({ hideStored: !store.get().hideStored })
      return
    }

    if (target.closest<HTMLButtonElement>('button[data-all]')) {
      store.set({ enabledCategories: new Set(CATEGORY_ORDER), disabledGroups: new Set() })
      return
    }

    if (target.closest<HTMLButtonElement>('button[data-default]')) {
      store.set({
        enabledCategories: new Set(DEFAULT_ENABLED_CATEGORIES),
        disabledGroups: new Set()
      })
      return
    }

    const header = target.closest<HTMLButtonElement>('button[data-category]')
    if (header) {
      const cat = header.dataset.category as PoiCategory
      const current = store.get().enabledCategories
      const next = new Set(current)
      if (next.has(cat)) next.delete(cat)
      else next.add(cat)
      store.set({ enabledCategories: next })
      return
    }

    const chip = target.closest<HTMLButtonElement>('button[data-group]')
    if (!chip) return
    const group = chip.dataset.group!
    const current = store.get().disabledGroups
    const next = new Set(current)
    if (next.has(group)) next.delete(group)
    else next.add(group)
    store.set({ disabledGroups: next })
  })

  const render = (): void => {
    const { pois, enabledCategories, disabledGroups, hideStored } = store.get()
    const counts = new Map<string, number>()
    let storedCount = 0
    for (const p of pois.values()) {
      counts.set(p.group, (counts.get(p.group) ?? 0) + 1)
      if (p.inStorage) storedCount++
    }

    const byCat = new Map<PoiCategory, string[]>()
    for (const group of counts.keys()) {
      const cat = getPoiGroupInfo(group).category
      const list = byCat.get(cat) ?? []
      list.push(group)
      byCat.set(cat, list)
    }

    const allActive =
      CATEGORY_ORDER.every((c) => enabledCategories.has(c)) && disabledGroups.size === 0
    const defaultActive =
      enabledCategories.size === DEFAULT_ENABLED_CATEGORIES.length &&
      DEFAULT_ENABLED_CATEGORIES.every((c) => enabledCategories.has(c)) &&
      disabledGroups.size === 0

    const all = actionChip('all', 'All', allActive)
    all.classList.add('chip-all')
    const def = actionChip('default', 'Default', defaultActive)
    def.classList.add('chip-default')
    const children: HTMLElement[] = [all, def]

    for (const cat of CATEGORY_ORDER) {
      const groups = byCat.get(cat)
      if (!groups?.length) continue
      groups.sort((a, b) => getPoiGroupInfo(a).label.localeCompare(getPoiGroupInfo(b).label))

      const categoryEnabled = enabledCategories.has(cat)
      const section = document.createElement('div')
      section.className = 'chip-group'

      const header = document.createElement('button')
      header.type = 'button'
      header.className = categoryEnabled ? 'chip-group-header' : 'chip-group-header disabled'
      header.dataset.category = cat
      header.setAttribute('aria-pressed', String(categoryEnabled))
      const box = document.createElement('span')
      box.className = 'chip-group-checkbox'
      const label = document.createElement('span')
      label.className = 'chip-group-label'
      label.textContent = CATEGORY_LABELS[cat]
      header.append(box, label)
      section.appendChild(header)

      const chipsWrap = document.createElement('div')
      chipsWrap.className = 'chip-group-chips'
      for (const group of groups) {
        const info = getPoiGroupInfo(group)
        const groupDisabled = disabledGroups.has(group)
        const active = categoryEnabled && !groupDisabled
        const c = chip(group, info.label, active)
        if (!categoryEnabled) c.classList.add('dimmed')
        const dot = document.createElement('span')
        dot.className = 'dot'
        dot.style.background = info.color
        const n = document.createElement('span')
        n.className = 'count'
        n.textContent = String(counts.get(group))
        c.prepend(dot)
        c.append(n)
        chipsWrap.appendChild(c)
      }
      section.appendChild(chipsWrap)
      children.push(section)
    }

    children.push(hideStoredChip(hideStored, storedCount))

    el.replaceChildren(...children)
  }

  store.subscribe((s, prev) => {
    if (
      s.pois !== prev.pois ||
      s.enabledCategories !== prev.enabledCategories ||
      s.disabledGroups !== prev.disabledGroups ||
      s.hideStored !== prev.hideStored
    )
      render()
  })
  render()
}

function chip(group: string, text: string, active: boolean): HTMLButtonElement {
  const b = document.createElement('button')
  b.type = 'button'
  b.className = active ? 'chip active' : 'chip'
  b.dataset.group = group
  b.setAttribute('aria-pressed', String(active))
  const label = document.createElement('span')
  label.textContent = text
  b.appendChild(label)
  return b
}

/** "All" / "Default" chips: plain buttons with no group/count decoration. */
function actionChip(kind: 'all' | 'default', text: string, active: boolean): HTMLButtonElement {
  const b = document.createElement('button')
  b.type = 'button'
  b.className = active ? 'chip active' : 'chip'
  if (kind === 'all') b.dataset.all = 'true'
  else b.dataset.default = 'true'
  b.setAttribute('aria-pressed', String(active))
  const label = document.createElement('span')
  label.textContent = text
  b.appendChild(label)
  return b
}

/** Trailing toggle chip: hides/shows POIs held in storage/furniture across all groups. */
function hideStoredChip(active: boolean, storedCount: number): HTMLButtonElement {
  const b = document.createElement('button')
  b.type = 'button'
  b.className = active ? 'chip chip-hide-stored active' : 'chip chip-hide-stored'
  b.dataset.hideStored = 'true'
  b.setAttribute('aria-pressed', String(active))
  const label = document.createElement('span')
  label.textContent = 'Hide stored'
  b.appendChild(label)
  if (storedCount > 0) {
    const n = document.createElement('span')
    n.className = 'count muted'
    n.textContent = `(${storedCount})`
    b.appendChild(n)
  }
  return b
}
