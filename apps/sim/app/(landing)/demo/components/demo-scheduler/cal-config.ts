const DEFAULT_CAL_ORIGIN = 'https://app.cal.com'
const DEFAULT_CAL_LINK = 'team/sim/demo'

/** Resolves a hosted or self-hosted Cal event link and rejects non-HTTP embed targets. */
export function resolveCalLink(configuredLink?: string): URL {
  const link = configuredLink?.trim() || DEFAULT_CAL_LINK
  let url: URL

  try {
    url = new URL(link)
  } catch {
    url = new URL(link.replace(/^\/+/, ''), `${DEFAULT_CAL_ORIGIN}/`)
  }

  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
    throw new Error('NEXT_PUBLIC_CAL_LINK must be an HTTP(S) URL or a Cal.com event path')
  }

  url.hash = ''
  return url
}

/**
 * Resolved at module scope on an eagerly-imported path, so a malformed
 * NEXT_PUBLIC_CAL_LINK degrades to the default link instead of taking the
 * whole /demo page down.
 */
const calLinkUrl = (() => {
  try {
    return resolveCalLink(process.env.NEXT_PUBLIC_CAL_LINK)
  } catch {
    return resolveCalLink(undefined)
  }
})()

/** Exact origin used for iframe navigation, preconnect, and postMessage validation. */
export const CAL_ORIGIN = calLinkUrl.origin

/** Returns a fresh URL so callers can safely add embed-specific paths and parameters. */
export function createConfiguredCalUrl(): URL {
  return new URL(calLinkUrl)
}
