/**
 * How the legacy organization surface maps onto the Platform zone. Dependency-free: the edge proxy,
 * server components, and client code all read it.
 */

/** Where the main app's `/org` rewrite in `next.config.ts` mounts the zone. */
const PLATFORM_BASE_PATH = '/org'

/**
 * Carries the requested `/o/...` URL from the proxy to the organization layout, which Next gives no
 * way to learn its own sub-path. A forged value can only choose among the mapped routes of an
 * organization the viewer already belongs to.
 */
export const LEGACY_URL_HEADER = 'x-sim-legacy-url'

/** Legacy settings paths that keep their name on the Platform. */
const SETTINGS_SECTIONS: ReadonlySet<string> = new Set([
  'knowledge-graphs',
  'mothership',
  'search-mcp',
  'recently-deleted',
  'members',
  'billing',
  'usage',
  'whitelabeling',
  'requests',
  'audit-logs',
  'access-control',
  'sso',
  'security',
  'data-retention',
  'data-drains',
])

/** The legacy surface's own aliases, resolved here so a saved link lands in one hop. */
const SETTINGS_ALIASES: Readonly<Record<string, string>> = {
  organization: 'members',
  team: 'members',
  subscription: 'billing',
  domains: 'sso',
  sessions: 'security',
}

function mapSettingsRoute(rest: readonly string[], query: URLSearchParams): string | null {
  const [section, detail] = rest
  if (section === undefined) return '/settings'
  if (section === 'usage' && detail === 'events' && rest.length === 2)
    return '/settings/usage/events'
  if (rest.length !== 1) return null
  if (section === 'general') return '/settings/general'
  if (section === 'authorized-apps') {
    query.set('view', 'authorized-apps')
    return '/settings/general'
  }
  const target = Object.hasOwn(SETTINGS_ALIASES, section)
    ? SETTINGS_ALIASES[section]
    : SETTINGS_SECTIONS.has(section)
      ? section
      : null
  return target && `/settings/${target}`
}

function mapRoute(rest: readonly string[], query: URLSearchParams): string | null {
  const [head, detail] = rest
  if (head === undefined) return '/'
  if (head === 'settings') return mapSettingsRoute(rest.slice(1), query)
  if (rest.length === 1) {
    if (head === 'home' || head === 'people' || head === 'integrations' || head === 'search')
      return `/${head}`
    if (head === 'links') return '/settings/links'
    return null
  }
  if (rest.length === 2 && (head === 'chat' || head === 'people')) return `/${head}/${detail}`
  if (rest.length === 3 && head === 'search' && detail === 'chat') return `/search/chat/${rest[2]}`
  return null
}

/**
 * The Platform URL for a legacy URL under `/o/{organizationId}`, keeping its query, or `null` for a
 * route that stays legacy: Benchmark, Skills, Admin, and the Search and credential pages with
 * legacy management links. Null also covers another organization's URL. A fallback must lead to
 * an unmapped route so the two surfaces cannot redirect to each other.
 */
export function mapLegacyOrganizationUrl(url: string, organizationId: string): string | null {
  const queryStart = url.indexOf('?')
  const pathname = queryStart === -1 ? url : url.slice(0, queryStart)
  const query = new URLSearchParams(queryStart === -1 ? '' : url.slice(queryStart + 1))
  const [surface, organization, ...rest] = pathname.split('/').filter(Boolean)
  if (surface !== 'o' || organization !== organizationId) return null
  const route = mapRoute(rest, query)
  if (route === null) return null
  const search = query.toString()
  return `${PLATFORM_BASE_PATH}${route === '/' ? '' : route}${search ? `?${search}` : ''}`
}
