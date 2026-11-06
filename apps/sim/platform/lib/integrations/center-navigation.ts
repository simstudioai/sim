import { createLoader, createSerializer, parseAsString, parseAsStringLiteral } from 'nuqs/server'

export const CENTER_TABS = [
  { id: 'apps', label: 'Apps' },
  { id: 'skills', label: 'Skills' },
  { id: 'mcps', label: 'MCPs' },
  { id: 'credentials', label: 'Credentials' },
] as const

export const centerParams = {
  tab: parseAsStringLiteral(['apps', 'skills', 'mcps', 'credentials']).withDefault('apps'),
  q: parseAsString.withDefault(''),
  category: parseAsString.withDefault('all'),
  scope: parseAsStringLiteral(['all', 'shared', 'personal']).withDefault('all'),
  order: parseAsStringLiteral(['asc', 'desc']).withDefault('asc'),
  resource: parseAsString,
}

export const serializeCenter = createSerializer(centerParams)

/** Discovery categories describe providers, independently of their connection or sharing state. */
export function appCategory(provider: string): string {
  if (
    [
      'gmail',
      'outlook',
      'google_calendar',
      'google-calendar',
      'slack',
      'microsoft_teams',
      'fireflies',
      'zoom',
    ].includes(provider)
  )
    return 'Communication'
  if (
    [
      'google_drive',
      'google-drive',
      'notion',
      'confluence',
      'coda',
      'sharepoint',
      'dropbox',
    ].includes(provider)
  )
    return 'Knowledge'
  if (['github', 'gitlab', 'linear', 'jira'].includes(provider)) return 'Development'
  if (['hubspot', 'salesforce', 'attio', 'intercom', 'zendesk'].includes(provider))
    return 'Customers'
  return 'Productivity'
}

const loadCenter = createLoader(centerParams)

/** Keep directory filters through a provider detail or credential round trip. */
export function integrationCenterHref(
  path: string,
  search: Pick<URLSearchParams, 'get'>,
  query = search.get('q')
) {
  const state = loadCenter({
    tab: search.get('tab') ?? undefined,
    q: query ?? undefined,
    category: search.get('category') ?? undefined,
    scope: search.get('scope') ?? undefined,
    order: search.get('order') ?? undefined,
  })
  return serializeCenter(path, state)
}
