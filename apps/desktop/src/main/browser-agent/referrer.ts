/**
 * The referrer a page-menu action carries: the clicked frame's URL and Referrer-Policy, and the
 * `Referer` that policy allows for a given request.
 */
import type { ContextMenuParams, Referrer } from 'electron'
import { parseHttpUrl } from '@/main/navigation'

const isWebUrl = (url: string) => parseHttpUrl(url) !== null

const REFERRER_POLICIES: ReadonlySet<unknown> = new Set<Referrer['policy']>([
  'default',
  'unsafe-url',
  'no-referrer-when-downgrade',
  'no-referrer',
  'origin',
  'strict-origin-when-cross-origin',
  'same-origin',
  'strict-origin',
])

function isReferrerPolicy(value: unknown): value is Referrer['policy'] {
  return REFERRER_POLICIES.has(value)
}

/** Electron types `referrerPolicy` as a Referrer, but it arrives as the bare policy string. */
export function menuReferrer(
  params: Pick<ContextMenuParams, 'referrerPolicy' | 'frameURL' | 'pageURL'>
): Referrer {
  const policy: unknown = params.referrerPolicy
  const url = params.frameURL || params.pageURL
  return {
    url: isWebUrl(url) ? url : '',
    policy: isReferrerPolicy(policy) ? policy : 'default',
  }
}

/** Longest referrer sent in full; a longer one is cut to its origin, as browsers do. */
const MAX_REFERRER_LENGTH = 4096
const LOOPBACK_HOSTS: ReadonlySet<string> = new Set(['localhost', '127.0.0.1', '[::1]'])

function isPotentiallyTrustworthy(url: URL): boolean {
  if (url.protocol === 'https:') return true
  return LOOPBACK_HOSTS.has(url.hostname) || url.hostname.endsWith('.localhost')
}

/**
 * The `Referer` a request from `referrer`'s document to `targetUrl` carries under its
 * Referrer-Policy (W3C Referrer Policy, "determine request's referrer"), or undefined when it
 * sends none. Chromium's `default` is `strict-origin-when-cross-origin`; Electron's `Referrer` has
 * no `origin-when-cross-origin`, which {@link menuReferrer} already reads as `default`.
 */
export function referrerForRequest(referrer: Referrer, targetUrl: string): string | undefined {
  const source = parseHttpUrl(referrer.url)
  const target = parseHttpUrl(targetUrl)
  if (!source || !target) return undefined
  source.username = ''
  source.password = ''
  source.hash = ''
  const origin = `${source.origin}/`
  const full = source.href.length > MAX_REFERRER_LENGTH ? origin : source.href
  const sameOrigin = source.origin === target.origin
  const downgrade = isPotentiallyTrustworthy(source) && !isPotentiallyTrustworthy(target)

  switch (referrer.policy) {
    case 'no-referrer':
      return undefined
    case 'origin':
      return origin
    case 'unsafe-url':
      return full
    case 'same-origin':
      return sameOrigin ? full : undefined
    case 'no-referrer-when-downgrade':
      return downgrade ? undefined : full
    case 'strict-origin':
      return downgrade ? undefined : origin
    default:
      if (downgrade) return undefined
      return sameOrigin ? full : origin
  }
}
