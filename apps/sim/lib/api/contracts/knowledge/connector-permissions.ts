import { z } from 'zod'
import {
  gitLabPermissionInputSchema,
  gitLabPermissionSummarySchema,
} from '@/lib/api/contracts/knowledge/gitlab-permissions'

export const connectorPermissionConfigSchema = z.discriminatedUnion('provider', [
  gitLabPermissionInputSchema,
])
export const connectorPermissionGrantsSchema = z.discriminatedUnion('provider', [
  gitLabPermissionInputSchema
    .pick({ provider: true, userMapping: true, projectPermissions: true })
    .required(),
])
/** Provider-specific grants that an organization admin can replace without changing source settings. */
export type ConnectorPermissionGrants = z.output<typeof connectorPermissionGrantsSchema>

export const connectorPermissionSummarySchema = z.discriminatedUnion('provider', [
  gitLabPermissionSummarySchema,
])
export type ConnectorPermissionConfigInput = z.input<typeof connectorPermissionConfigSchema>
export type ConnectorPermissionConfigData = z.output<typeof connectorPermissionSummarySchema>
