/**
 * Where a click is about to navigate, when it is a plain left click on a same-origin link leading
 * somewhere else in the app: the navigation an unsaved-changes guard has to stop. Anything the
 * browser or another control handles itself reads as `null`, so it is never interrupted.
 */
export function inAppLinkDestination(event: MouseEvent): URL | null {
  if (
    event.defaultPrevented ||
    event.button !== 0 ||
    event.metaKey ||
    event.ctrlKey ||
    event.shiftKey ||
    event.altKey
  )
    return null
  const anchor = event.target instanceof Element ? event.target.closest('a[href]') : null
  if (
    !(anchor instanceof HTMLAnchorElement) ||
    anchor.hasAttribute('download') ||
    anchor.dataset.settingsNavigation === 'managed' ||
    (anchor.target && anchor.target !== '_self') ||
    anchor.getAttribute('aria-disabled') === 'true'
  )
    return null
  if (
    event.target instanceof Element &&
    event.target.closest('button, input, textarea, select, [role="button"]')
  )
    return null
  const destination = new URL(anchor.href, window.location.href)
  if (
    destination.origin !== window.location.origin ||
    (destination.pathname === window.location.pathname &&
      destination.search === window.location.search)
  )
    return null
  return destination
}
