import { getBaseUrl } from '@/lib/core/utils/urls'

/** The same canonical resource URL is used for client setup, discovery, and token verification. */
export function getSearchMcpUrl(kind: 'workspace' | 'organization', id: string): string {
  const prefix = kind === 'organization' ? 'organizations/' : ''
  return `${getBaseUrl()}/api/mcp/search/${prefix}${encodeURIComponent(id)}`
}
