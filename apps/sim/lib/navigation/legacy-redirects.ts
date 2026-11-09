/**
 * Legacy workspace URLs whose new home needs the workspace's organization. Only a server page can
 * read that, after authorizing the viewer, so `next.config.ts` cannot redirect them statically.
 * Pure: the page passes the organization it read, and this decides the destination.
 */
import { organizationRoutes, WORKSPACES_PATH } from '@/lib/navigation/paths'

interface LegacyWorkspaceUrl {
  workspaceId: string
  /** The path below `/workspace/{workspaceId}/`, one entry per segment, decoded. */
  segments: readonly string[]
  query: URLSearchParams
  /** The workspace's organization, or `null` when the viewer cannot open the workspace. */
  organizationId: string | null
}

interface SettingsRedirectIds {
  organizationId: string
  workspaceId: string
  /** Each `:name` segment of {@link SettingsRedirect.legacy}, decoded. */
  params: Readonly<Record<string, string>>
}

interface SettingsRedirect {
  /** A legacy path below `/workspace/{workspaceId}/`; a `:name` segment matches any one segment. */
  legacy: `settings${string}` | `access-requests${string}`
  /** Where it lands, without a query: the legacy query is carried over. */
  target: (ids: SettingsRedirectIds) => string
}

/**
 * Legacy workspace Settings sections that moved to organization Settings, under the same key: the
 * organization Settings route and `next.config.ts` resolve the renamed ones (`subscription`, `team`…).
 */
const ORGANIZATION_SETTINGS: readonly string[] = [
  'general',
  'preferences',
  'account',
  'privacy',
  'notifications',
  'authorized-apps',
  'desktop',
  'browser',
  'terminal',
  'billing',
  'subscription',
  'billing/credit-usage',
  'usage',
  'usage/events',
  'connected-accounts',
  'access-control',
  'audit-logs',
  'sso',
  'domains',
  'security',
  'sessions',
  'data-retention',
  'data-drains',
  'whitelabeling',
  'admin',
  'mothership',
  'self-host',
  'organization',
  'team',
]

function workspaceSettings(workspaceId: string, section: string): string {
  return `${WORKSPACES_PATH}/${encodeURIComponent(workspaceId)}/settings/${section}`
}

/**
 * Legacy workspace Settings URLs whose page moved: sections that became organization Settings, the
 * old API keys key, and access requests. Sections that stay with the workspace keep their URL and
 * need no redirect. A legacy path listed nowhere here has no destination and answers not found.
 */
const SETTINGS_REDIRECTS: readonly SettingsRedirect[] = [
  ...ORGANIZATION_SETTINGS.map(
    (section): SettingsRedirect => ({
      legacy: `settings/${section}`,
      target: ({ organizationId }) => organizationRoutes(organizationId).settingsSection(section),
    })
  ),
  {
    legacy: 'settings/apikeys',
    target: ({ workspaceId }) => workspaceSettings(workspaceId, 'api-keys'),
  },
  {
    legacy: 'access-requests',
    target: ({ workspaceId }) => workspaceSettings(workspaceId, 'requests'),
  },
]

function matchSettingsRedirect(segments: readonly string[]) {
  for (const redirect of SETTINGS_REDIRECTS) {
    const pattern = redirect.legacy.split('/')
    if (pattern.length !== segments.length) continue
    const params: Record<string, string> = {}
    const matches = pattern.every((part, index) => {
      if (part.startsWith(':')) {
        params[part.slice(1)] = segments[index]
        return true
      }
      return part === segments[index]
    })
    if (matches) return { redirect, params }
  }
  return null
}

function withQuery(path: string, query: URLSearchParams): string {
  const search = query.toString()
  return search ? `${path}?${search}` : path
}

function skillsUrl(organizationId: string, workspaceId: string, resource: string | null): string {
  const query = new URLSearchParams({ tab: 'skills', workspace: workspaceId })
  if (resource) query.set('resource', resource)
  return withQuery(organizationRoutes(organizationId).integrations, query)
}

/**
 * The URL a legacy workspace URL now lives at, or `null` when it has none, including every URL of
 * a workspace the viewer cannot open.
 */
export function mapLegacyWorkspaceUrl({
  workspaceId,
  segments,
  query,
  organizationId,
}: LegacyWorkspaceUrl): string | null {
  if (organizationId === null) return null
  const routes = organizationRoutes(organizationId)
  const [head, ...rest] = segments

  if (head === 'home' && rest.length === 0) return withQuery(routes.home, query)
  if (head === 'chat' && rest.length === 1) return withQuery(routes.chat(rest[0]), query)
  if (head === 'skills' && rest.length === 0)
    return skillsUrl(organizationId, workspaceId, query.get('skillId'))
  if (head === 'skills' && rest.length === 1) return skillsUrl(organizationId, workspaceId, rest[0])
  if (head === 'integrations' && rest.length === 0) return withQuery(routes.integrations, query)
  if (head === 'integrations' && rest.length === 2 && rest[0] === 'connected')
    return `${routes.integrations}?tab=credentials`
  if (head === 'integrations' && rest.length === 1)
    return withQuery(`${routes.integrations}/${encodeURIComponent(rest[0])}`, query)
  if (head === 'upgrade' && rest.length === 0) {
    const reason = query.get('reason')
    const plans = routes.settingsSection('billing/plans')
    return reason ? withQuery(plans, new URLSearchParams({ reason })) : plans
  }

  const settings = matchSettingsRedirect(segments)
  if (!settings) return null
  return withQuery(
    settings.redirect.target({ organizationId, workspaceId, params: settings.params }),
    query
  )
}
