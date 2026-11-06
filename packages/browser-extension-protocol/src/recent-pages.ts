import { z } from 'zod'

export const RECENT_PAGES_LIMIT = 20
const RECENT_PAGE_TITLE_MAX_LENGTH = 256
export const RECENT_PAGE_ICON_MAX_LENGTH = 32_000

const envelope = { channel: z.literal('sim-extension'), version: z.literal(1) }

/** What a Sim page may ask the extension. Only the exact Sim origin can reach it at all. */
export const recentsRequestSchema = z.discriminatedUnion('type', [
  z.strictObject({ ...envelope, type: z.literal('recents-status') }),
  z.strictObject({
    ...envelope,
    type: z.literal('recent-pages'),
    limit: z.number().int().min(1).max(RECENT_PAGES_LIMIT),
  }),
  z.strictObject({ ...envelope, type: z.literal('open-recents-setup') }),
])
export type RecentsRequest = z.infer<typeof recentsRequestSchema>

export const recentsStatusSchema = z.object({
  permission: z.enum(['granted', 'not_granted']),
  enabled: z.boolean(),
})
export type RecentsStatus = z.infer<typeof recentsStatusSchema>

const recentPageIconSchema = z
  .string()
  .max(RECENT_PAGE_ICON_MAX_LENGTH)
  .regex(/^data:image\/[a-z+.-]+;base64,[A-Za-z0-9+/]+=*$/)

const recentPageSchema = z.object({
  url: z.string().max(4_096),
  title: z.string().max(RECENT_PAGE_TITLE_MAX_LENGTH),
  visitedAt: z.number(),
  iconUrl: recentPageIconSchema.optional(),
})
export type RecentPage = z.infer<typeof recentPageSchema>

export const recentPagesSchema = z.object({ pages: z.array(recentPageSchema) })

const TRACKING_PARAMETER = /^(utm_.+|gclid|fbclid|msclkid|mc_cid|mc_eid|ref_src)$/i
const SIGN_IN_SEGMENT =
  /^(login|logout|signin|sign-in|signup|sign-up|oauth|oauth2|auth|authorize|callback|sso|saml|mfa|2fa|reset-password|password-reset)$/i
const SIGN_IN_HOST = /^(login|accounts?|auth|sso|signin)\./i

function isPrivateHost(host: string): boolean {
  const name = host.toLowerCase()
  if (name.startsWith('[')) return true
  if (!name.includes('.') || name.endsWith('.localhost') || name.endsWith('.local')) return true
  const ipv4 = name.match(/^(\d+)\.(\d+)\.\d+\.\d+$/)
  if (!ipv4) return false
  const [first, second] = [Number(ipv4[1]), Number(ipv4[2])]
  return (
    first === 0 ||
    first === 10 ||
    first === 127 ||
    (first === 100 && second >= 64 && second <= 127) ||
    (first === 169 && second === 254) ||
    (first === 172 && second >= 16 && second <= 31) ||
    (first === 192 && second === 168)
  )
}

/**
 * The address a visited page may be shown under, or null when it should not appear at all: not a
 * web page, private, part of signing in, or identified by a query that cannot be kept. A link
 * stripped of an identifying query would open the wrong page, so those are dropped instead.
 */
export function recentPageUrl(value: string, simOrigin: string): string | null {
  let url: URL
  try {
    url = new URL(value)
  } catch {
    return null
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null
  if (url.username || url.password || url.origin === simOrigin) return null
  if (isPrivateHost(url.hostname) || SIGN_IN_HOST.test(url.hostname)) return null
  if (url.pathname.split('/').some((segment) => SIGN_IN_SEGMENT.test(segment))) return null
  for (const name of [...url.searchParams.keys()]) {
    if (TRACKING_PARAMETER.test(name)) url.searchParams.delete(name)
  }
  if (url.search) return null
  url.hash = ''
  return url.href
}

interface VisitedPage {
  url?: string
  title?: string
  lastVisitTime?: number
}

/** Browser history reduced to what Home may show: most recent first, one entry per page and title. */
export function selectRecentPages(
  visits: readonly VisitedPage[],
  simOrigin: string,
  limit: number
): RecentPage[] {
  const seen = new Set<string>()
  const pages: RecentPage[] = []
  const newestFirst = [...visits].sort((a, b) => (b.lastVisitTime ?? 0) - (a.lastVisitTime ?? 0))
  for (const visit of newestFirst) {
    if (pages.length === limit) break
    const url = visit.url && recentPageUrl(visit.url, simOrigin)
    if (!url) continue
    const host = new URL(url).hostname.replace(/^www\./, '')
    const named = visit.title?.trim().slice(0, RECENT_PAGE_TITLE_MAX_LENGTH)
    const title = named || host
    // Untitled pages share their site's name without being the same page.
    const key = named ? `${host}\0${named.toLowerCase()}` : url
    if (seen.has(url) || seen.has(key)) continue
    seen.add(url)
    seen.add(key)
    pages.push({ url, title, visitedAt: visit.lastVisitTime ?? 0 })
  }
  return pages
}
