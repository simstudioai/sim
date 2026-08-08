import { z } from 'zod'
import { workspaceIdSchema } from '@/lib/api/contracts/primitives'
import { defineRouteContract } from '@/lib/api/contracts/types'
import { v2DataResponse } from '@/lib/api/contracts/v2/shared'

/**
 * v2 workspace contracts.
 *
 * Read-only. Clients hold a workspace id (from a profile, a flag, or an env
 * var) and need a human-readable name to show beside it; without this they can
 * only ever display the raw uuid.
 */

const v2WorkspaceParamsSchema = z.object({
  workspaceId: workspaceIdSchema,
})

const v2WorkspaceSchema = z.object({
  id: z.string(),
  name: z.string(),
  color: z.string(),
  logoUrl: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
})

const v2WorkspaceDataSchema = z.object({
  workspace: v2WorkspaceSchema,
})

export type V2Workspace = z.output<typeof v2WorkspaceSchema>

export const v2GetWorkspaceContract = defineRouteContract({
  method: 'GET',
  path: '/api/v2/workspaces/[workspaceId]',
  params: v2WorkspaceParamsSchema,
  response: {
    mode: 'json',
    schema: v2DataResponse(v2WorkspaceDataSchema),
  },
})
