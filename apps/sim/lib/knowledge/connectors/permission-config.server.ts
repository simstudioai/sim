import { OrchestrationError } from '@/lib/core/orchestration/types'
import type {
  ConnectorPermissionSummary,
  PrepareConnectorPermissionsInput,
} from '@/lib/knowledge/connectors/permission-config'

export async function hasConnectorPermissionConfig(connectorType: string): Promise<boolean> {
  const { CONNECTOR_REGISTRY } = await import('@/connectors/registry.server')
  return Boolean(CONNECTOR_REGISTRY[connectorType]?.permissionConfig)
}

export async function prepareConnectorPermissions(
  connectorType: string,
  input: PrepareConnectorPermissionsInput
) {
  const { CONNECTOR_REGISTRY } = await import('@/connectors/registry.server')
  const capability = CONNECTOR_REGISTRY[connectorType]?.permissionConfig
  if (input.permissionConfig?.provider && input.permissionConfig.provider !== connectorType) {
    throw new OrchestrationError(
      'validation',
      'The permission configuration does not match the connector provider.'
    )
  }
  if (!capability) {
    if (input.permissionConfig || (input.existing && input.apiKey !== undefined)) {
      throw new OrchestrationError(
        'validation',
        'This connector does not support private permission settings.'
      )
    }
    return undefined
  }
  return capability.prepare(input)
}

export async function readConnectorPermissionSummary(connectorType: string, connectorId: string) {
  return (await readConnectorPermissionSummaries([{ connectorType, id: connectorId }])).get(
    connectorId
  )
}

export async function readConnectorPermissionSummaries(
  connectors: readonly { connectorType: string; id: string }[]
) {
  const { CONNECTOR_REGISTRY } = await import('@/connectors/registry.server')
  const groups = new Map<string, string[]>()
  for (const row of connectors) {
    if (!CONNECTOR_REGISTRY[row.connectorType]?.permissionConfig) continue
    const ids = groups.get(row.connectorType) ?? []
    ids.push(row.id)
    groups.set(row.connectorType, ids)
  }
  const summaries = new Map<string, ConnectorPermissionSummary>()
  for (const [type, ids] of groups) {
    const values = await CONNECTOR_REGISTRY[type].permissionConfig!.readSummaries(ids)
    for (const [id, summary] of values) summaries.set(id, summary)
  }
  return summaries
}
