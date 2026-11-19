import type { z } from 'zod'
import type { connectorPermissionSummarySchema } from '@/lib/api/contracts/knowledge/connector-permissions'
import { v2SearchSourceSchema } from '@/lib/api/contracts/v2/search-sources'

/** Projects only public source configuration; credentials and permission contents never leave the server. */
export function toV2SearchSource(connector: {
  id: string
  connectorType: string
  credentialId: string | null
  sourceConfig: unknown
  status: string
  accessMode: string
  approved: boolean
  createdAt: Date
  updatedAt: Date
  permissionConfig?: z.output<typeof connectorPermissionSummarySchema>
}) {
  return v2SearchSourceSchema.parse({
    id: connector.id,
    connectorType: connector.connectorType,
    credentialId: connector.credentialId,
    sourceConfig: connector.sourceConfig,
    status: connector.status,
    accessMode: connector.accessMode,
    approved: connector.approved,
    permissionConfig: connector.permissionConfig ?? null,
    createdAt: connector.createdAt.toISOString(),
    updatedAt: connector.updatedAt.toISOString(),
  })
}
