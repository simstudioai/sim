import { SIM_LINK_NAME_MAX_LENGTH } from '@sim/browser-extension-protocol'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'

const MAX_VALUES = 8
const MAX_VALUE_LENGTH = 256
const MAX_DECODED_LENGTH = 5 + SIM_LINK_NAME_MAX_LENGTH + MAX_VALUES * (MAX_VALUE_LENGTH + 1)
const SHORTCUT_SEGMENT = /^[A-Za-z0-9.:@&~_-]+$/
const RESPONSE_HEADERS = {
  'Cache-Control': 'no-store',
  'Referrer-Policy': 'no-referrer',
} as const

/**
 * Next normalizes query spelling; the handoff still accepts only one q value. Rejecting other
 * parameters and surviving percent escapes prevents ambiguous or repeatedly decoded shortcuts.
 */
function recoverSimLinkPath(search: string): string | null {
  if (
    !search.startsWith('?q=') ||
    search.length > 3 + MAX_DECODED_LENGTH * 3 ||
    search.includes('&')
  ) {
    return null
  }

  let shortcut: string
  try {
    shortcut = decodeURIComponent(search.slice(3))
  } catch {
    return null
  }
  const prefix = /^(?:sim|go)\//i.exec(shortcut)
  if (shortcut.length > MAX_DECODED_LENGTH || !prefix) return null

  const segments = shortcut.slice(prefix[0].length).replace(/\/$/, '').split('/')
  const [name] = segments
  if (
    !name ||
    name.length > SIM_LINK_NAME_MAX_LENGTH ||
    !/[A-Za-z0-9]/.test(name) ||
    segments.length > MAX_VALUES + 1 ||
    segments.some(
      (segment) =>
        !SHORTCUT_SEGMENT.test(segment) ||
        segment === '.' ||
        segment === '..' ||
        segment.length > MAX_VALUE_LENGTH
    )
  ) {
    return null
  }
  return `/sim/${segments.map(encodeURIComponent).join('/')}`
}

/**
 * Search recovery navigation: no page is rendered and the canonical Sim link route owns
 * sign-in, current organization membership, feature availability, and destination resolution.
 */
export const GET = withRouteHandler((request) => {
  const destination = recoverSimLinkPath(request.nextUrl.search)
  if (!destination) {
    return new Response('Invalid Sim shortcut.', { status: 400, headers: RESPONSE_HEADERS })
  }
  return new Response(null, {
    status: 307,
    headers: { ...RESPONSE_HEADERS, Location: destination },
  })
})
