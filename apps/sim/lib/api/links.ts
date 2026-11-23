import { getSimMcpUrl } from '@/lib/api/mcp/urls'
import { DOCS_URL } from '@/lib/help-links'

/** Where a v2 API client finds the machine-readable contract, the reference docs, and the MCP server. */
export interface V2ApiLinks {
  openapi: string
  docs: string
  mcp: string
}

/**
 * This deployment's v2 discovery links. The OpenAPI document and reference docs
 * are the published ones; the MCP URL is this deployment's own server.
 */
export function getV2ApiLinks(): V2ApiLinks {
  return {
    openapi: `${DOCS_URL}/openapi.json`,
    docs: `${DOCS_URL}/api-reference/getting-started`,
    mcp: getSimMcpUrl(),
  }
}
