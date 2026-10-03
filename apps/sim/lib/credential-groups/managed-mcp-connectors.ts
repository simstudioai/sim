export const MANAGED_MCP_CONNECTOR_IDS = [
  'fireflies',
  'granola',
  'databricks',
  'coda',
  'notion',
  'hubspot',
  'lucid',
  'zoom',
] as const

export type ManagedMcpConnectorId = (typeof MANAGED_MCP_CONNECTOR_IDS)[number]

interface ManagedMcpConnectorMetadata {
  name: string
  description: string
  bgColor?: string
}

interface FixedManagedMcpConnector extends ManagedMcpConnectorMetadata {
  id: Exclude<ManagedMcpConnectorId, 'databricks' | 'hubspot' | 'zoom'>
  url: string
  oauthClientRegistration: 'dynamic'
}

interface DatabricksManagedMcpConnector extends ManagedMcpConnectorMetadata {
  id: 'databricks'
  oauthClientRegistration: 'preregistered'
}

interface FixedPreregisteredManagedMcpConnector extends ManagedMcpConnectorMetadata {
  id: 'hubspot' | 'zoom'
  url: string
  oauthClientRegistration: 'preregistered'
}

export type ManagedMcpConnector =
  | FixedManagedMcpConnector
  | DatabricksManagedMcpConnector
  | FixedPreregisteredManagedMcpConnector

export const MANAGED_MCP_CONNECTORS = {
  zoom: {
    id: 'zoom',
    name: 'Zoom',
    description: 'Search past meetings, transcripts and notes using your Zoom account',
    url: 'https://mcp.zoom.us/mcp/meeting/streamable',
    oauthClientRegistration: 'preregistered',
  },
  lucid: {
    id: 'lucid',
    name: 'Lucid',
    bgColor: '#282C33',
    description: 'Search Lucidchart diagrams and Lucidspark boards using your Lucid account',
    url: 'https://mcp.lucid.app/mcp/readonly',
    oauthClientRegistration: 'dynamic',
  },
  hubspot: {
    id: 'hubspot',
    name: 'HubSpot',
    description: 'Search CRM records using each person’s HubSpot permissions',
    url: 'https://mcp.hubspot.com',
    oauthClientRegistration: 'preregistered',
  },
  coda: {
    id: 'coda',
    name: 'Coda',
    description: 'Search and read Superhuman Docs (Coda) using each person’s OAuth account',
    url: 'https://docs.superhuman.com/apis/mcp',
    oauthClientRegistration: 'dynamic',
  },
  notion: {
    id: 'notion',
    name: 'Notion',
    description: 'Search and read Notion using each person’s OAuth account',
    url: 'https://mcp.notion.com/mcp',
    oauthClientRegistration: 'dynamic',
  },
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

export function getManagedMcpConnectorBgColor(
  connectorId: string | null | undefined
): string | undefined {
  return connectorId && isManagedMcpConnectorId(connectorId)
    ? getManagedMcpConnector(connectorId).bgColor
    : undefined
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
