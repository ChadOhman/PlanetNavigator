function svgUrl(svg: string): string {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`
}

function arrowSvg(fill: string): string {
  // Points up (= +z / north when the view is unrotated).
  return (
    '<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32">' +
    `<path d="M16 3 L26 28 L16 22 L6 28 Z" fill="${fill}" stroke="#0b0d10" ` +
    'stroke-width="2.2" stroke-linejoin="round"/></svg>'
  )
}

export const PLAYER_ARROW = svgUrl(arrowSvg('#ffffff'))
export const REMOTE_PLAYER_ARROW = svgUrl(arrowSvg('#3ee6ff'))

const poiCache = new Map<string, string>()

/** A 14 px coloured dot with a dark outline. */
export function poiIcon(color: string): string {
  let url = poiCache.get(color)
  if (!url) {
    url = svgUrl(
      '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 14 14">' +
        `<circle cx="7" cy="7" r="5" fill="${color}" stroke="#0b0d10" stroke-width="1.6"/></svg>`
    )
    poiCache.set(color, url)
  }
  return url
}

/** Ring used to briefly highlight a POI. */
export const HIGHLIGHT_RING = svgUrl(
  '<svg xmlns="http://www.w3.org/2000/svg" width="36" height="36" viewBox="0 0 36 36">' +
    '<circle cx="18" cy="18" r="14" fill="none" stroke="#ffffff" stroke-width="3"/>' +
    '<circle cx="18" cy="18" r="14" fill="none" stroke="#f0b429" stroke-width="1.5"/></svg>'
)
