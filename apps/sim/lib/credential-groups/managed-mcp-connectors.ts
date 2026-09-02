export const MANAGED_MCP_CONNECTOR_IDS = ['fireflies', 'granola', 'databricks'] as const

export type ManagedMcpConnectorId = (typeof MANAGED_MCP_CONNECTOR_IDS)[number]

interface FixedManagedMcpConnector {
  id: Exclude<ManagedMcpConnectorId, 'databricks'>
  name: string
  description: string
  url: string
  oauthClientRegistration: 'dynamic'
}

interface DatabricksManagedMcpConnector {
  id: 'databricks'
  name: string
  description: string
  oauthClientRegistration: 'preregistered'
}

export type ManagedMcpConnector = FixedManagedMcpConnector | DatabricksManagedMcpConnector

export const MANAGED_MCP_CONNECTORS = {
  fireflies: {
    id: 'fireflies',
    name: 'Fireflies',
    description: 'Let each person connect their own Fireflies account',
    url: 'https://api.fireflies.ai/mcp',
    oauthClientRegistration: 'dynamic',
  },
  granola: {
    id: 'granola',
    name: 'Granola',
    description: 'Let each person connect their own Granola account',
    url: 'https://mcp.granola.ai/mcp',
    oauthClientRegistration: 'dynamic',
  },
  databricks: {
    id: 'databricks',
    name: 'Databricks',
    description: 'Let each person connect their own Databricks account',
    oauthClientRegistration: 'preregistered',
  },
} as const satisfies Record<ManagedMcpConnectorId, ManagedMcpConnector>

const DATABRICKS_WORKSPACE_HOST_SUFFIXES = [
  '.cloud.databricks.com',
  '.cloud.databricks.us',
  '.cloud.databricks.mil',
  '.azuredatabricks.net',
  '.gcp.databricks.com',
  '.databricks.com',
] as const

const DATABRICKS_APP_HOST_SUFFIXES = [
  '.databricksapps.com',
  '.databricksapps.us',
  '.databricksapps.mil',
] as const

export function isManagedMcpConnectorId(value: string): value is ManagedMcpConnectorId {
  return MANAGED_MCP_CONNECTOR_IDS.some((connectorId) => connectorId === value)
}

export function getManagedMcpConnector(connectorId: string): ManagedMcpConnector {
  if (!isManagedMcpConnectorId(connectorId)) {
    throw new Error(`Unsupported managed MCP connector: ${connectorId}`)
  }
  return MANAGED_MCP_CONNECTORS[connectorId]
}

function hostnameHasSuffix(hostname: string, suffixes: readonly string[]): boolean {
  return suffixes.some((suffix) => hostname.endsWith(suffix))
}

export function requireManagedMcpConnectorUrl(
  connectorId: ManagedMcpConnectorId,
  rawUrl?: string
): string {
  const connector = getManagedMcpConnector(connectorId)
  if ('url' in connector) {
    if (rawUrl !== undefined && rawUrl !== connector.url) {
      throw new Error(`${connector.name} uses the fixed MCP URL ${connector.url}`)
    }
    return connector.url
  }

  if (!rawUrl?.trim()) throw new Error('Databricks MCP URL is required')
  let url: URL
  try {
    url = new URL(rawUrl.trim())
  } catch {
    throw new Error('Databricks MCP URL is invalid')
  }
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) {
    throw new Error('Databricks MCP URL must be a credential-free HTTPS URL')
  }

  const hostname = url.hostname.toLowerCase()
  const isWorkspaceHost = hostnameHasSuffix(hostname, DATABRICKS_WORKSPACE_HOST_SUFFIXES)
  const isAppHost = hostnameHasSuffix(hostname, DATABRICKS_APP_HOST_SUFFIXES)
  const isManagedServicePath =
    url.pathname.startsWith('/api/2.0/mcp/') || url.pathname.startsWith('/ai-gateway/mcp-services/')
  const isAppPath = url.pathname === '/mcp' || url.pathname === '/mcp/'
  if ((!isWorkspaceHost || !isManagedServicePath) && (!isAppHost || !isAppPath)) {
    throw new Error('Databricks MCP URL must point to an official Databricks MCP endpoint')
  }
  return url.toString().replace(/\/$/, '')
}
