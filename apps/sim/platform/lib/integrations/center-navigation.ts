import { createLoader, createSerializer, parseAsString, parseAsStringLiteral } from 'nuqs/server'
import { credentialParams } from '@/platform/lib/integrations/credential-navigation'

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

/** The workspace every Integrations tab lists within: its apps, credentials, skills and MCPs. */
export const integrationsWorkspaceParams = {
  workspace: parseAsString,
}

const serializeWorkspace = createSerializer(integrationsWorkspaceParams)

/** Keeps the page's workspace on a link within an organization's Integrations. */
export function withIntegrationsWorkspace(href: string, workspace: string | null) {
  return serializeWorkspace(href, { workspace })
}

export const resourceDetailParams = {
  resourceTab: parseAsStringLiteral(['details', 'access']).withDefault('details'),
}

export const serializeCenter = createSerializer({ ...centerParams, ...resourceDetailParams })

/**
 * Every param the Integrations directory keeps on its own links. A link built from these values, and
 * not from a second read of the URL, agrees with the view the same render shows.
 */
export const integrationsPageParams = {
  ...centerParams,
  ...resourceDetailParams,
  ...credentialParams,
  ...integrationsWorkspaceParams,
}

export const serializeIntegrationsPage = createSerializer(integrationsPageParams)

const loadCenter = createLoader(centerParams)

/** Keep directory filters through a provider detail or credential round trip. */
export function integrationCenterHref(
  path: string,
  search: URLSearchParams,
  query = search.get('q')
) {
  return serializeCenter(path, { ...loadCenter(search), q: query ?? '', resource: null })
}
