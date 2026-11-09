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
  connection: parseAsStringLiteral(['all', 'connected', 'available']).withDefault('all'),
  scope: parseAsStringLiteral(['all', 'shared', 'personal']).withDefault('all'),
  order: parseAsStringLiteral(['asc', 'desc']).withDefault('asc'),
  resource: parseAsString,
}

/** The workspace whose skills the Skills tab lists; skills belong to a workspace, as in legacy. */
export const skillWorkspaceParams = {
  workspace: parseAsString,
}

export const resourceDetailParams = {
  resourceTab: parseAsStringLiteral(['details', 'access']).withDefault('details'),
}

export const serializeCenter = createSerializer({ ...centerParams, ...resourceDetailParams })

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
    connection: search.get('connection') ?? undefined,
    scope: search.get('scope') ?? undefined,
    order: search.get('order') ?? undefined,
  })
  return serializeCenter(path, state)
}
