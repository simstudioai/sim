import { z } from 'zod'
import { workspaceIdSchema } from '@/lib/api/contracts/primitives'
import { defineRouteContract } from '@/lib/api/contracts/types'
import { v2CursorListResponse, v2DataResponse } from '@/lib/api/contracts/v2/shared'

export const v2WorkspaceParamsSchema = z
  .object({ workspaceId: workspaceIdSchema.describe('Workspace to retrieve.') })
  .strict()
export type V2WorkspaceParams = z.output<typeof v2WorkspaceParamsSchema>

export const v2WorkspaceSchema = z
  .object({
    id: workspaceIdSchema.describe('Unique workspace identifier.'),
    name: z.string().describe('Workspace display name.'),
    color: z.string().describe('Workspace color as a hexadecimal color value.'),
    logoUrl: z.string().nullable().describe('Workspace logo URL, or null when none is configured.'),
    memberCount: z
      .number()
      .int()
      .nonnegative()
      .describe('Number of effective members, including inherited organization administrators.'),
    createdAt: z.string().datetime().describe('ISO 8601 timestamp when the workspace was created.'),
    updatedAt: z
      .string()
      .datetime()
      .describe('ISO 8601 timestamp when the workspace was last updated.'),
  })
  .strict()
  .meta({
    id: 'V2Workspace',
    title: 'Workspace',
    description: 'Public metadata for an accessible workspace.',
  })
export type V2Workspace = z.output<typeof v2WorkspaceSchema>

export const v2WorkspaceMemberSchema = z
  .object({
    email: z.email().describe('Member email address and public member identifier.'),
    name: z.string().describe('Member display name.'),
    image: z.string().nullable().describe('Member profile image URL, or null when absent.'),
    role: z.enum(['admin', 'write', 'read']).describe('Effective role in the workspace.'),
    isExternal: z
      .boolean()
      .describe('Whether access is inherited from outside the explicit workspace member list.'),
    joinedAt: z.string().datetime().describe('ISO 8601 timestamp when access was granted.'),
  })
  .meta({
    id: 'V2WorkspaceMember',
    title: 'Workspace member',
    description: 'An effective workspace member and their public access role.',
  })
export type V2WorkspaceMember = z.output<typeof v2WorkspaceMemberSchema>

export const v2ListWorkspaceMembersQuerySchema = z
  .object({
    limit: z.coerce
      .number()
      .int()
      .min(1)
      .max(100)
      .optional()
      .default(50)
      .describe('Maximum members to return. Defaults to 50 and cannot exceed 100.'),
    cursor: z.string().min(1).optional().describe('Opaque cursor returned by the preceding page.'),
  })
  .strict()
export type V2ListWorkspaceMembersQuery = z.output<typeof v2ListWorkspaceMembersQuerySchema>

export const v2WorkspaceMemberCursorSchema = z
  .object({ email: z.email().describe('Email at which the next page begins.') })
  .strict()
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
