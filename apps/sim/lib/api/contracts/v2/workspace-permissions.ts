import { z } from 'zod'
import { userPermissionConfigSchema } from '@/lib/api/contracts/permission-groups'
import { noInputSchema, workspaceIdSchema } from '@/lib/api/contracts/primitives'
import { defineRouteContract } from '@/lib/api/contracts/types'
import { v2DataResponse } from '@/lib/api/contracts/v2/shared'

export const v2GetWorkspacePermissionConfigParamsSchema = z.object({
  workspaceId: workspaceIdSchema,
})

export const v2GetWorkspacePermissionConfigContract = defineRouteContract({
  method: 'GET',
  path: '/api/v2/workspaces/[workspaceId]/permission-config',
  params: v2GetWorkspacePermissionConfigParamsSchema,
  query: noInputSchema,
  response: {
    mode: 'json',
    schema: v2DataResponse(userPermissionConfigSchema.meta({ id: 'V2WorkspacePermissionConfig' })),
  },
})

export type V2GetWorkspacePermissionConfigParams = z.input<
  typeof v2GetWorkspacePermissionConfigParamsSchema
>
export type V2GetWorkspacePermissionConfigResponse = z.output<
  typeof v2GetWorkspacePermissionConfigContract.response.schema
>
