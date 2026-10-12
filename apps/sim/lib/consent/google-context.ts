import { GOOGLE_CLICK_ID_PARAMETERS, UTM_PARAMETERS } from '@/lib/analytics/campaign-parameters'
import { isNoindexPath } from '@/lib/navigation/paths'

const GOOGLE_ANALYTICS_ORIGINS = new Set(['https://sim.ai', 'https://www.sim.ai'])

const TOKEN_UTILITY_PATHS = [
  '/slack-search',
  '/credential-groups/enroll',
  '/enterprise/claim',
] as const

const GOOGLE_CAMPAIGN_PARAMETERS = [...UTM_PARAMETERS, ...GOOGLE_CLICK_ID_PARAMETERS] as const

interface GooglePageContext {
  page_location: string
  page_referrer: string
  page_title: string
}

let currentGooglePageContext: GooglePageContext | undefined
let initialGooglePagePathname: string | undefined

/** Returns the page queued for Google's initial configuration, before its script finishes loading. */
export function getInitialGooglePagePathname(): string | undefined {
  return initialGooglePagePathname
}

function getPrivatePageRoot(pathname: string): string | undefined {
  const routePath = decodeURIComponent(pathname)
  if (isNoindexPath(routePath)) return `/${routePath.split('/')[1]}`
  return TOKEN_UTILITY_PATHS.find((root) => routePath === root || routePath.startsWith(`${root}/`))
}

function getPageReferrer(value: string): string {
  try {
    const url = new URL(value)
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return ''
    const pathname = GOOGLE_ANALYTICS_ORIGINS.has(url.origin)
      ? (getPrivatePageRoot(url.pathname) ?? url.pathname)
      : '/'
    return `${url.origin}${pathname}`
  } catch {
    return ''
  }
}

/** Restricts Sim's Google destinations to production origins and approved campaign parameters. */
export function getGooglePageLocation(value: string): string | undefined {
  if (process.env.NODE_ENV !== 'production') return undefined

  try {
    const url = new URL(value)
    if (!GOOGLE_ANALYTICS_ORIGINS.has(url.origin)) return undefined

    const campaign = new URLSearchParams()
    for (const parameter of GOOGLE_CAMPAIGN_PARAMETERS) {
      const value = url.searchParams.get(parameter)
      if (value) campaign.set(parameter, value)
    }

    const query = campaign.toString()
    const pathname = getPrivatePageRoot(url.pathname) ?? url.pathname
    return `${url.origin}${pathname}${query ? `?${query}` : ''}`
  } catch {
    return undefined
  }
}

/** Keeps shared Google event context aligned with the current sanitized virtual page. */
export function updateGooglePageContext(value: string, initialReferrer?: string): void {
  const pageLocation = getGooglePageLocation(value)
  if (!pageLocation) return
  if (initialReferrer !== undefined) initialGooglePagePathname = new URL(value).pathname

  const pathname = new URL(pageLocation).pathname
  const privatePage = getPrivatePageRoot(pathname) !== undefined
  const pageReferrer =
    initialReferrer !== undefined
      ? getPageReferrer(initialReferrer)
      : currentGooglePageContext?.page_location === pageLocation
        ? currentGooglePageContext.page_referrer
        : (currentGooglePageContext?.page_location ?? getPageReferrer(document.referrer))

  currentGooglePageContext = {
    page_location: pageLocation,
    page_referrer: pageReferrer,
    page_title: privatePage ? 'Sim' : document.title,
  }
  window.gtag?.('set', currentGooglePageContext)
}
