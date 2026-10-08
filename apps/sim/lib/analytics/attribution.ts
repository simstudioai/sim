import { toStringOrNull } from '@sim/utils/coerce'
import { isRecordLike } from '@sim/utils/object'
import { GOOGLE_CLICK_ID_PARAMETERS, UTM_PARAMETERS } from '@/lib/analytics/campaign-parameters'
import { isNoindexPath, isPathOrDescendant } from '@/lib/navigation/paths'

/**
 * Marketing attribution for sign-ups and sales leads. The browser records the
 * campaign or external site that brought a visitor in a first-party cookie,
 * written only under measurement consent; the server reads it back when the
 * account is created (or a demo is requested) and attaches it to that record.
 *
 * Server-side events cannot see the visitor's landing page, and the OAuth round
 * trip replaces `document.referrer` with the identity provider, so without this
 * cookie every Google sign-up looks like it came from `accounts.google.com`.
 *
 * Only campaign parameters, the referring hostname, and the landing pathname
 * are kept — never a full URL, query string, or ad click id — matching the URL
 * stripping `preparePostHogEvent` applies to every PostHog event.
 */

const ATTRIBUTION_FIRST_TOUCH_COOKIE = 'sim_attribution_first'
const ATTRIBUTION_LAST_TOUCH_COOKIE = 'sim_attribution_last'

/** Matches the Google Ads click cookies listed alongside it in the cookie policy. */
const ATTRIBUTION_MAX_AGE_SECONDS = 90 * 24 * 60 * 60

/**
 * Bounds on each value's stored size — its URL-encoded JSON form, which is
 * what the cookie actually holds — so a touch stays far below the browser's
 * 4 KB cookie limit whatever script or punctuation a link carries. A cookie
 * over the limit is dropped without an error.
 */
const ATTRIBUTION_VALUE_MAX_BYTES = 200
const LANDING_PATH_MAX_BYTES = 400
const ATTRIBUTION_VALUE_MAX_LENGTH = 100
const LANDING_PATH_MAX_LENGTH = 200

const CAMPAIGN_PARAMETERS = [...UTM_PARAMETERS, 'ref'] as const

/**
 * Ad-network click ids. Only which network clicked through is kept: the id
 * itself identifies one ad interaction and is never needed downstream.
 */
const CLICK_ID_PARAMETERS = [
  ...GOOGLE_CLICK_ID_PARAMETERS,
  'msclkid',
  'fbclid',
  'li_fat_id',
  'ttclid',
  'twclid',
  'rdt_cid',
  'bfcid',
] as const

/**
 * Hosts a visitor passes through mid-session — sign-in and checkout — rather
 * than hosts that sent them. Arriving from one says nothing about acquisition.
 */
const INTERMEDIARY_REFERRER_HOSTS = new Set([
  'accounts.google.com',
  'login.microsoftonline.com',
  'login.live.com',
  'appleid.apple.com',
  'checkout.stripe.com',
  'billing.stripe.com',
])

/** A bare DNS hostname: the only shape a stored referring domain may take. */
const HOSTNAME_PATTERN = /^[a-z0-9-]+(\.[a-z0-9-]+)+$/

/** Sign-in surfaces an identity provider redirects back to, never an acquisition landing page. */
const AUTH_PATH_ROOTS = ['/login', '/signup', '/sso', '/verify', '/reset-password', '/oauth']

type CampaignParameter = (typeof CAMPAIGN_PARAMETERS)[number]
type ClickIdParameter = (typeof CLICK_ID_PARAMETERS)[number]

type AttributionTouch = Partial<Record<CampaignParameter, string>> & {
  click_id_type?: ClickIdParameter
  referring_domain?: string
  landing_path: string
  touched_at: string
}

type AttributionTouchKey = keyof AttributionTouch

/** Flattened PostHog properties: `first_touch_utm_source`, `last_touch_landing_path`, … */
export type AttributionProperties = Partial<
  Record<`first_touch_${AttributionTouchKey}` | `last_touch_${AttributionTouchKey}`, string>
>

/** Reads one request or browser cookie by name. */
type CookieReader = (name: string) => string | null | undefined

function encodedSize(value: string): number {
  return encodeURIComponent(JSON.stringify(value)).length
}

/**
 * Strips control and line-separator characters, then bounds the value by
 * length and by stored size. Values come from URL-decoded query strings and
 * reach a plain-text sales email, where any line break would forge extra lines.
 */
function bound(
  value: string,
  maxLength = ATTRIBUTION_VALUE_MAX_LENGTH,
  maxBytes = ATTRIBUTION_VALUE_MAX_BYTES
): string {
  const characters = Array.from(
    value.replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]/g, '')
  ).slice(0, maxLength)
  while (characters.length > 0 && encodedSize(characters.join('')) > maxBytes) characters.pop()
  return characters.join('')
}

function normalizeHost(hostname: string): string {
  return hostname.toLowerCase().replace(/^www\./, '')
}

/** Another of Sim's own sites, such as `docs.sim.ai` seen from `www.sim.ai`. */
function isOwnPropertyHost(host: string, currentHost: string): boolean {
  return normalizeHost(host).endsWith(`.${normalizeHost(currentHost)}`)
}

/**
 * Identity providers return to sign-in routes and the browser hides their path,
 * so a referral into those routes cannot be told apart from a sign-in round trip.
 */
function isReferralLandingPath(pathname: string): boolean {
  return !AUTH_PATH_ROOTS.some((root) => isPathOrDescendant(pathname, root))
}

function getExternalReferringDomain(referrer: string, currentHost: string): string | undefined {
  if (!referrer) return undefined
  let url: URL
  try {
    url = new URL(referrer)
  } catch {
    return undefined
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return undefined

  const host = url.hostname.toLowerCase()
  if (normalizeHost(host) === normalizeHost(currentHost)) return undefined
  if (INTERMEDIARY_REFERRER_HOSTS.has(host)) return undefined
  return bound(host)
}

interface BuildAttributionTouchInput {
  /** The URL the document was loaded from — the landing page, before any client navigation. */
  href: string
  /** `document.referrer` for that load. */
  referrer: string
  now: Date
  /**
   * When the consent grant the touch is recorded under lapses (epoch ms), so
   * the cookies never outlive it: a sign-up completed straight from an
   * identity provider never loads a Sim page that could clear them.
   */
  consentExpiresAt?: number
}

/**
 * The touch a page load represents, or `null` when it carries no acquisition
 * signal: a direct visit, an internal navigation, a sign-in or checkout round
 * trip, or an app or customer-owned page (deployed chats, shared files).
 * Campaign links also count on sign-in pages; bare referrals do not (see
 * {@link isReferralLandingPath}).
 */
function buildAttributionTouch({
  href,
  referrer,
  now,
}: BuildAttributionTouchInput): AttributionTouch | null {
  let url: URL
  try {
    url = new URL(href)
  } catch {
    return null
  }

  const campaign: Partial<Record<CampaignParameter, string>> = {}
  for (const parameter of CAMPAIGN_PARAMETERS) {
    const value = url.searchParams.get(parameter)?.trim()
    if (value) campaign[parameter] = bound(value)
  }
  const clickIdType = CLICK_ID_PARAMETERS.find((parameter) => url.searchParams.get(parameter))
  const referringDomain = getExternalReferringDomain(referrer, url.hostname)

  if (isNoindexPath(url.pathname)) return null
  const hasCampaignSignal = Object.keys(campaign).length > 0 || clickIdType !== undefined
  if (!hasCampaignSignal && (!referringDomain || !isReferralLandingPath(url.pathname))) {
    return null
  }

  return {
    ...campaign,
    ...(clickIdType ? { click_id_type: clickIdType } : {}),
    ...(referringDomain ? { referring_domain: referringDomain } : {}),
    landing_path: bound(url.pathname, LANDING_PATH_MAX_LENGTH, LANDING_PATH_MAX_BYTES),
    touched_at: now.toISOString(),
  }
}

function parseJson(raw: string): unknown {
  try {
    return JSON.parse(raw)
  } catch {}
  try {
    return JSON.parse(decodeURIComponent(raw))
  } catch {
    return undefined
  }
}

/**
 * Reads a touch back from a cookie value. The cookie is client-writable, so
 * every field is re-validated and re-bounded and unknown keys are dropped.
 * Accepts the value with or without URL encoding, since some cookie readers
 * decode it and some do not.
 */
function parseAttributionTouch(raw: string | null | undefined): AttributionTouch | null {
  if (!raw) return null
  const value = parseJson(raw)
  if (!isRecordLike(value)) return null

  const landingPath = toStringOrNull(value.landing_path)
  const touchedAt = toStringOrNull(value.touched_at)
  if (!landingPath?.startsWith('/') || !touchedAt || Number.isNaN(Date.parse(touchedAt))) {
    return null
  }

  const touch: AttributionTouch = {
    landing_path: bound(
      landingPath.split(/[?#]/, 1)[0],
      LANDING_PATH_MAX_LENGTH,
      LANDING_PATH_MAX_BYTES
    ),
    touched_at: new Date(touchedAt).toISOString(),
  }
  for (const key of CAMPAIGN_PARAMETERS) {
    const field = toStringOrNull(value[key])
    if (field) touch[key] = bound(field)
  }
  const referringDomain = toStringOrNull(value.referring_domain)?.toLowerCase()
  if (referringDomain && HOSTNAME_PATTERN.test(referringDomain)) {
    touch.referring_domain = bound(referringDomain)
  }
  const clickIdType = CLICK_ID_PARAMETERS.find((parameter) => parameter === value.click_id_type)
  if (clickIdType) touch.click_id_type = clickIdType
  return touch
}

function readTouches(getCookie: CookieReader) {
  return {
    first: parseAttributionTouch(getCookie(ATTRIBUTION_FIRST_TOUCH_COOKIE)),
    last: parseAttributionTouch(getCookie(ATTRIBUTION_LAST_TOUCH_COOKIE)),
  }
}

function prefixTouch(
  prefix: 'first_touch' | 'last_touch',
  touch: AttributionTouch | null
): AttributionProperties {
  return Object.fromEntries(
    Object.entries(touch ?? {}).map(([key, value]) => [`${prefix}_${key}`, value])
  )
}

/**
 * Reads both attribution cookies through the caller's cookie accessor and
 * flattens them into PostHog properties. Empty when the visitor never granted
 * measurement consent, since the cookies are only ever written under it.
 */
export function readAttributionProperties(getCookie: CookieReader): AttributionProperties {
  const { first, last } = readTouches(getCookie)
  return { ...prefixTouch('first_touch', first), ...prefixTouch('last_touch', last) }
}

/**
 * Plain-text attribution lines for a notification a person reads, such as the
 * sales inbox's demo-request email. Empty when the visitor left no touch.
 */
export function formatAttributionForNotification(getCookie: CookieReader): string {
  const { first, last } = readTouches(getCookie)
  const touches = [
    ['First touch', first],
    ['Last touch', last],
  ] as const
  return touches
    .flatMap(([label, touch]) =>
      touch
        ? [
            `${label}: ${Object.entries(touch)
              .map(([key, value]) => `${key}=${value}`)
              .join(', ')}`,
          ]
        : []
    )
    .join('\n')
}

/**
 * `SameSite=None` because a SAML identity provider returns by cross-site POST,
 * which drops `Lax` cookies, and that callback is when the account is created.
 * The cookies hold no credential, so cross-site delivery exposes nothing.
 * Browsers only accept `None` with `Secure`, so plain-HTTP development keeps `Lax`.
 */
function writeCookie(name: string, value: string, maxAgeSeconds = ATTRIBUTION_MAX_AGE_SECONDS) {
  const sameSite = window.location.protocol === 'https:' ? 'SameSite=None; Secure' : 'SameSite=Lax'
  document.cookie = `${name}=${encodeURIComponent(value)}; Max-Age=${maxAgeSeconds}; Path=/; ${sameSite}`
}

function readBrowserCookie(name: string): string | undefined {
  return document.cookie
    .split('; ')
    .find((entry) => entry.startsWith(`${name}=`))
    ?.slice(name.length + 1)
}

/**
 * Records this page load's touch in the browser. Call only after the caller has
 * verified measurement consent. A valid first touch is never replaced, and a
 * referral from another of Sim's own sites never replaces a real last touch —
 * it only fills an empty slot.
 */
export function recordAttributionTouch(input: BuildAttributionTouchInput): void {
  const touch = buildAttributionTouch(input)
  if (!touch) return

  const { first, last } = readTouches(readBrowserCookie)
  const isOwnPropertyReferral =
    touch.referring_domain !== undefined &&
    isOwnPropertyHost(touch.referring_domain, new URL(input.href).hostname) &&
    !CAMPAIGN_PARAMETERS.some((parameter) => touch[parameter]) &&
    !touch.click_id_type

  const maxAgeSeconds =
    input.consentExpiresAt === undefined
      ? ATTRIBUTION_MAX_AGE_SECONDS
      : Math.min(
          ATTRIBUTION_MAX_AGE_SECONDS,
          Math.floor((input.consentExpiresAt - input.now.getTime()) / 1000)
        )
  if (maxAgeSeconds <= 0) return

  const value = JSON.stringify(touch)
  if (!first) writeCookie(ATTRIBUTION_FIRST_TOUCH_COOKIE, value, maxAgeSeconds)
  if (!last || !isOwnPropertyReferral) {
    writeCookie(ATTRIBUTION_LAST_TOUCH_COOKIE, value, maxAgeSeconds)
  }
}

/** Deletes both attribution cookies once measurement consent is withdrawn or expires. */
export function clearAttributionCookies(): void {
  for (const name of [ATTRIBUTION_FIRST_TOUCH_COOKIE, ATTRIBUTION_LAST_TOUCH_COOKIE]) {
    if (readBrowserCookie(name) !== undefined) writeCookie(name, '', 0)
  }
}
