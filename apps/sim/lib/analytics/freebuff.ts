/**
 * Freebuff Ads conversion tracking. A Freebuff ad click lands with a signed
 * `?bfcid=` click id; the hosted tag stores it in a first-party `bfcid` cookie,
 * and each conversion is reported twice with the same `eventId` — once by the
 * tag and once by the server postback — so Freebuff dedupes them into one.
 *
 * @see https://freebuff.com/docs/advertisers/conversions
 */

export const FREEBUFF_TAG_SRC = 'https://freebuff.com/freebuff-tag.js' as const

/** First-party cookie the tag writes the captured click id to. */
export const FREEBUFF_CLICK_ID_COOKIE = 'bfcid' as const

export type FreebuffConversionEvent = 'signup_completed'

type FreebuffCommand = (
  command: 'conversion',
  eventType: FreebuffConversionEvent,
  options?: { eventId?: string }
) => void

declare global {
  interface Window {
    freebuff?: FreebuffCommand & { q?: unknown[][] }
  }
}

/** Queues commands until the async tag loads and replays them. */
export function installFreebuffStub(): void {
  if (window.freebuff) return
  const queue: unknown[][] = []
  window.freebuff = Object.assign((...args: unknown[]) => void queue.push(args), { q: queue })
}

/** Deletes the tag's click-id cookie, which it writes host-only on `Path=/`. */
export function clearFreebuffClickId(): void {
  if (!document.cookie.includes(`${FREEBUFF_CLICK_ID_COOKIE}=`)) return
  document.cookie = `${FREEBUFF_CLICK_ID_COOKIE}=; Max-Age=0; Path=/; SameSite=Lax`
}

/**
 * Reports a conversion from the page. Call only after the caller has verified
 * marketing consent; the tag is a no-op for visitors who did not arrive from an
 * ad. `eventId` must match the one the server postback sends.
 */
export function trackFreebuffConversion(event: FreebuffConversionEvent, eventId: string): void {
  window.freebuff?.('conversion', event, { eventId })
}
