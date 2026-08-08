import { z } from 'zod'
import { workspaceIdSchema } from '@/lib/api/contracts/primitives'
import { defineRouteContract } from '@/lib/api/contracts/types'
import { v2CursorListResponse, v2DataResponse } from '@/lib/api/contracts/v2/shared'

export const v2WorkspaceParamsSchema = z.object({ workspaceId: workspaceIdSchema }).strict()
export type V2WorkspaceParams = z.output<typeof v2WorkspaceParamsSchema>

export const v2WorkspaceSchema = z.object({
  id: workspaceIdSchema,
  name: z.string(),
  color: z.string(),
  logoUrl: z.string().nullable(),
  mode: z.enum(['personal', 'organization', 'grandfathered_shared']),
  memberCount: z.number().int().nonnegative(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
})
export type V2Workspace = z.output<typeof v2WorkspaceSchema>

export const v2WorkspaceMemberSchema = z.object({
  email: z.email(),
  name: z.string(),
  image: z.string().nullable(),
  role: z.enum(['admin', 'write', 'read']),
  isExternal: z.boolean(),
  joinedAt: z.string().datetime(),
})
export type V2WorkspaceMember = z.output<typeof v2WorkspaceMemberSchema>

export const v2ListWorkspaceMembersQuerySchema = z
  .object({
    limit: z.coerce.number().int().min(1).max(100).optional().default(50),
    cursor: z.string().min(1).optional(),
  })
  .strict()
export type V2ListWorkspaceMembersQuery = z.output<typeof v2ListWorkspaceMembersQuerySchema>

export const v2WorkspaceMemberCursorSchema = z.object({ email: z.email() }).strict()
export type V2WorkspaceMemberCursor = z.output<typeof v2WorkspaceMemberCursorSchema>

export const v2GetWorkspaceContract = defineRouteContract({
  method: 'GET',
  path: '/api/v2/workspaces/[workspaceId]',
  params: v2WorkspaceParamsSchema,
  response: { mode: 'json', schema: v2DataResponse(v2WorkspaceSchema) },
})

export const v2ListWorkspaceMembersContract = defineRouteContract({
  method: 'GET',
  path: '/api/v2/workspaces/[workspaceId]/members',
  params: v2WorkspaceParamsSchema,
  query: v2ListWorkspaceMembersQuerySchema,
  response: { mode: 'json', schema: v2CursorListResponse(v2WorkspaceMemberSchema) },
})
