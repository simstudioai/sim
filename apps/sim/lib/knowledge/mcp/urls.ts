import { getBaseUrl } from '@/lib/core/utils/urls'

/** The same canonical resource URL is used for client setup, discovery, and token verification. */
export function getSearchMcpUrl(organizationId: string): string {
  return `${getBaseUrl()}/api/mcp/search/organizations/${encodeURIComponent(organizationId)}`
}
