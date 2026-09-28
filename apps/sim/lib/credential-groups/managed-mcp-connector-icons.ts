import {
  CodaIcon,
  DatabricksIcon,
  FirefliesIcon,
  GranolaIcon,
  HubspotIcon,
  NotionIcon,
} from '@/components/icons'
import type { ManagedMcpConnectorId } from '@/lib/credential-groups/managed-mcp-connectors'

export const MANAGED_MCP_CONNECTOR_ICONS = {
  fireflies: FirefliesIcon,
  granola: GranolaIcon,
  hubspot: HubspotIcon,
  coda: CodaIcon,
  notion: NotionIcon,
  databricks: DatabricksIcon,
} as const satisfies Record<ManagedMcpConnectorId, typeof FirefliesIcon>

export function getManagedMcpConnectorIcon(connectorId: ManagedMcpConnectorId) {
  return MANAGED_MCP_CONNECTOR_ICONS[connectorId]
}
