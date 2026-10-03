import { sha256Hex } from '@sim/security/hash'
import {
  inspectConfiguredOAuthClient,
  requireConfiguredOAuthClient,
} from '@/lib/core/config/env-capabilities.server'
import { getBaseUrl } from '@/lib/core/utils/urls'
import { MANAGED_MCP_CONNECTORS } from '@/lib/credential-groups/managed-mcp-connectors'

/** Deployment-owned registration; access tokens remain personal managed grants. */
export function getSharedHubSpotMcpClient() {
  if (inspectConfiguredOAuthClient('hubspot-mcp').state !== 'ready') return undefined
  const configuration = requireConfiguredOAuthClient('hubspot-mcp')
  const clientId = configuration.values.HUBSPOT_MCP_CLIENT_ID
  const clientSecret = configuration.values.HUBSPOT_MCP_CLIENT_SECRET
  return {
    clientId,
    clientSecret,
    configurationFingerprint: sha256Hex(
      JSON.stringify([
        'shared-hubspot-mcp',
        MANAGED_MCP_CONNECTORS.hubspot.url,
        `${getBaseUrl().replace(/\/$/, '')}/api/mcp/oauth/callback`,
        clientId,
        clientSecret,
      ])
    ),
  }
}

/** A separate registration keeps Search authorization from replacing workflow Zoom grants. */
export function getSharedZoomMcpClient() {
  if (inspectConfiguredOAuthClient('zoom-mcp').state !== 'ready') return undefined
  const configuration = requireConfiguredOAuthClient('zoom-mcp')
  const clientId = configuration.values.ZOOM_MCP_CLIENT_ID
  const clientSecret = configuration.values.ZOOM_MCP_CLIENT_SECRET
  const scope = 'meeting:read:search meeting:read:assets'
  const tokenEndpointAuthMethod = 'client_secret_basic' as const
  return {
    clientId,
    clientSecret,
    scope,
    tokenEndpointAuthMethod,
    configurationFingerprint: sha256Hex(
      JSON.stringify([
        'shared-zoom-mcp',
        MANAGED_MCP_CONNECTORS.zoom.url,
        `${getBaseUrl().replace(/\/$/, '')}/api/mcp/oauth/callback`,
        clientId,
        clientSecret,
        scope,
        tokenEndpointAuthMethod,
      ])
    ),
  }
}
