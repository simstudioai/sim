import { getEnv } from '@/lib/core/config/env'
import { getBaseUrl } from '@/lib/core/utils/urls'

/** Where the Sim MCP route lives in this app, whichever host serves it publicly. */
export const SIM_MCP_ROUTE_PATH = '/api/mcp'

export type SimMcpProfile = 'standard' | 'openai'

/**
 * The Sim MCP server's canonical URL. Client setup, protected-resource
 * discovery, and OAuth token audience all use this one string.
 *
 * `SIM_MCP_URL` names a dedicated host (hosted Sim serves `https://mcp.sim.ai/mcp`),
 * which `proxy.ts` maps onto {@link SIM_MCP_ROUTE_PATH}. Without it the server
 * is served from the app's own origin.
 */
export function getSimMcpUrl(profile: SimMcpProfile = 'standard'): string {
  const configured = getEnv('SIM_MCP_URL')?.trim().replace(/\/+$/, '')
  const base = configured || `${getBaseUrl()}${SIM_MCP_ROUTE_PATH}`
  return profile === 'openai' ? `${base}/openai` : base
}
