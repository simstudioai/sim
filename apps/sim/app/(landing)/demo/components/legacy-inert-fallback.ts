const FOCUSABLE_SELECTOR = [
  'a[href]',
  'area[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  'iframe',
  'object',
  'embed',
  '[contenteditable="true"]',
  '[tabindex]',
].join(',')

/**
 * Mirrors the interaction-blocking parts of `inert` for Firefox 111, the only
 * browser in Next's supported range without native support. Modern browsers
 * never call this fallback.
 */
export function applyLegacyInertFallback(node: HTMLElement): () => void {
  const previousAriaHidden = node.getAttribute('aria-hidden')
  const previousPointerEvents = node.style.pointerEvents
  const previousTabIndexes = new Map<HTMLElement, string | null>()
  const activeElement = node.ownerDocument.activeElement

  if (activeElement instanceof HTMLElement && node.contains(activeElement)) activeElement.blur()

  node.setAttribute('aria-hidden', 'true')
  node.style.pointerEvents = 'none'

  for (const element of node.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)) {
    previousTabIndexes.set(element, element.getAttribute('tabindex'))
    element.setAttribute('tabindex', '-1')
  }

  return () => {
    if (previousAriaHidden === null) node.removeAttribute('aria-hidden')
    else node.setAttribute('aria-hidden', previousAriaHidden)
    node.style.pointerEvents = previousPointerEvents

    for (const [element, tabIndex] of previousTabIndexes) {
      if (tabIndex === null) element.removeAttribute('tabindex')
      else element.setAttribute('tabindex', tabIndex)
    }
  }
}
