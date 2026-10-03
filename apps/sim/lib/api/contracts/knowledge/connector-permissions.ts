import { z } from 'zod'
import {
  gitLabPermissionInputSchema,
  gitLabPermissionSummarySchema,
} from '@/lib/api/contracts/knowledge/gitlab-permissions'

export const connectorPermissionConfigSchema = z.discriminatedUnion('provider', [
  gitLabPermissionInputSchema,
])
export const connectorPermissionSummarySchema = z.discriminatedUnion('provider', [
  gitLabPermissionSummarySchema,
])
export type ConnectorPermissionConfigInput = z.input<typeof connectorPermissionConfigSchema>
export type ConnectorPermissionConfigData = z.output<typeof connectorPermissionSummarySchema>
