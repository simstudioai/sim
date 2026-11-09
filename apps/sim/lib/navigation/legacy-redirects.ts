/**
 * Legacy workspace URLs whose new home needs the organization the workspace renders in: its own,
 * or the viewer's landing organization for an organization-less workspace. Only a server page can
 * read that, after authorizing the viewer, so `next.config.ts` cannot redirect them statically.
 * Pure: the page passes the organization it read, and this decides the destination.
 */
import { matchPathPattern, organizationRoutes, WORKSPACES_PATH } from '@/lib/navigation/paths'
import { settingsAliasHref } from '@/lib/navigation/settings-aliases'

interface LegacyWorkspaceUrl {
  workspaceId: string
  /** The path below `/workspace/{workspaceId}/`, one entry per segment, decoded. */
  segments: readonly string[]
  query: URLSearchParams
  /** The organization the workspace renders in, or `null` when the viewer cannot open it. */
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
  /** Where it lands, with the legacy query carried over. */
  target: (ids: SettingsRedirectIds, query: URLSearchParams) => string
}

/**
 * Legacy workspace Settings sections that moved to organization Settings. A renamed one
 * (`subscription`, `team`…) lands on its section through `settingsAliasHref` in the same hop.
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
      target: ({ organizationId }, query) => {
        const routes = organizationRoutes(organizationId)
        return (
          settingsAliasHref(routes.root, section.split('/'), query) ??
          withQuery(routes.settingsSection(section), query)
        )
      },
    })
  ),
  {
    legacy: 'settings/apikeys',
    target: ({ workspaceId }, query) =>
      withQuery(workspaceSettings(workspaceId, 'api-keys'), query),
  },
  {
    legacy: 'access-requests',
    target: ({ workspaceId }, query) =>
      withQuery(workspaceSettings(workspaceId, 'requests'), query),
  },
]

function matchSettingsRedirect(segments: readonly string[]) {
  for (const redirect of SETTINGS_REDIRECTS) {
    const params = matchPathPattern(redirect.legacy, segments)
    if (params) return { redirect, params }
  }
  return null
}

function withQuery(path: string, query: URLSearchParams): string {
  const search = query.toString()
  return search ? `${path}?${search}` : path
}

/**
 * The legacy query with the workspace it was scoped to: an organization without member-scoped
 * accounts lists that workspace's apps and credentials on its Integrations page.
 */
function inWorkspace(query: URLSearchParams, workspaceId: string): URLSearchParams {
  const scoped = new URLSearchParams(query)
  scoped.set('workspace', workspaceId)
  return scoped
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
  if (head === 'integrations' && rest.length === 0)
    return withQuery(routes.integrations, inWorkspace(query, workspaceId))
  if (head === 'integrations' && rest.length === 2 && rest[0] === 'connected')
    return withQuery(routes.account(rest[1]), inWorkspace(query, workspaceId))
  if (head === 'integrations' && rest.length === 1)
    return withQuery(routes.integration(rest[0]), inWorkspace(query, workspaceId))
  if (head === 'upgrade' && rest.length === 0) {
    const reason = query.get('reason')
    const plans = routes.settingsSection('billing/plans')
    return reason ? withQuery(plans, new URLSearchParams({ reason })) : plans
  }

  const settings = matchSettingsRedirect(segments)
  if (!settings) return null
  return settings.redirect.target({ organizationId, workspaceId, params: settings.params }, query)
}
