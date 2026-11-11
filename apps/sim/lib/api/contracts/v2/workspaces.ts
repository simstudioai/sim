import { z } from 'zod'
import {
  MAX_ID_LENGTH,
  noInputSchema,
  requiredFieldSchema,
  workspaceIdSchema,
} from '@/lib/api/contracts/primitives'
import { defineRouteContract } from '@/lib/api/contracts/types'
import {
  v2CursorListResponse,
  v2DataResponse,
  v2PaginationFields,
  v2SortFields,
  v2TimestampSchema,
} from '@/lib/api/contracts/v2/shared'

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
    createdAt: v2TimestampSchema.describe('ISO 8601 timestamp when the workspace was created.'),
    updatedAt: v2TimestampSchema.describe(
      'ISO 8601 timestamp when the workspace was last updated.'
    ),
  })
  .strict()
  .meta({
    id: 'V2Workspace',
    title: 'Workspace',
    description: 'Public metadata for an accessible workspace.',
  })
export type V2Workspace = z.output<typeof v2WorkspaceSchema>

export const v2WorkspaceSortFields = ['name', 'createdAt', 'updatedAt'] as const
export type V2WorkspaceSortBy = (typeof v2WorkspaceSortFields)[number]

/**
 * Below the v2 default of 50. A personal key can reach every workspace its
 * owner belongs to, and an unbounded-feeling first page is the wrong default
 * for a list a caller usually scans to pick one; the cursor is there for more.
 */
export const V2_WORKSPACES_DEFAULT_PAGE_SIZE = 25

export const v2ListWorkspacesQuerySchema = z
  .object({
    ...v2SortFields(v2WorkspaceSortFields, { sortBy: 'createdAt', sortOrder: 'desc' }),
    ...v2PaginationFields({
      description: 'Maximum workspaces to return per page.',
      fallback: V2_WORKSPACES_DEFAULT_PAGE_SIZE,
    }),
  })
  .strict()

export type V2ListWorkspacesQuery = z.output<typeof v2ListWorkspacesQuerySchema>

export const v2WorkspaceMemberSchema = z
  .object({
    userId: z.string().describe('User identifier; use this identifier for member administration.'),
    email: z.email().describe('Member email address.'),
    name: z.string().describe('Member display name.'),
    image: z.string().nullable().describe('Member profile image URL, or null when absent.'),
    role: z.enum(['admin', 'write', 'read']).describe('Effective role in the workspace.'),
    isExternal: z
      .boolean()
      .describe(
        'Whether the member belongs to a different organization than the workspace. True only for an explicitly granted member whose own organization differs; inherited organization-administrator access is always reported as false, so this does not detect every outside caller.'
      ),
    joinedAt: v2TimestampSchema.describe('ISO 8601 timestamp when access was granted.'),
  })
  .meta({
    id: 'V2WorkspaceMember',
    title: 'Workspace member',
    description: 'An effective workspace member and their public access role.',
  })
export type V2WorkspaceMember = z.output<typeof v2WorkspaceMemberSchema>

export const v2ListWorkspaceMembersQuerySchema = z
  .object({
    ...v2PaginationFields({ description: 'Maximum members to return per page.' }),
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
  query: noInputSchema,
  params: v2WorkspaceParamsSchema,
  response: { mode: 'json', schema: v2DataResponse(v2WorkspaceSchema) },
})

const v2UpdateWorkspaceParamsSchema = z
  .object({ workspaceId: workspaceIdSchema.describe('Workspace to update.') })
  .strict()

const v2UpdateWorkspaceBodySchema = z
  .object({
    name: z
      .string()
      .trim()
      .min(1, 'name cannot be empty')
      .max(255, 'name must be at most 255 characters')
      .optional()
      .describe('New workspace display name.'),
    logoUrl: z
      .string()
      .regex(/^(\/$|\/[^/]|https:\/\/)/, 'logoUrl must be a root-relative path or an HTTPS URL')
      .nullable()
      .optional()
      .describe(
        'New workspace logo URL: a root-relative path (starting with /) or an https:// URL. Send null to remove the logo.'
      ),
  })
  .strict()
  .refine((body) => body.name !== undefined || body.logoUrl !== undefined, {
    message: 'Provide name or logoUrl',
  })
  .meta({ minProperties: 1 })

export const v2UpdateWorkspaceContract = defineRouteContract({
  method: 'PATCH',
  path: '/api/v2/workspaces/[workspaceId]',
  query: noInputSchema,
  params: v2UpdateWorkspaceParamsSchema,
  body: v2UpdateWorkspaceBodySchema,
  response: { mode: 'json', schema: v2DataResponse(v2WorkspaceSchema) },
})

export const v2ListWorkspacesContract = defineRouteContract({
  method: 'GET',
  path: '/api/v2/workspaces',
  query: v2ListWorkspacesQuerySchema,
  response: { mode: 'json', schema: v2CursorListResponse(v2WorkspaceSchema) },
})

export const v2ListWorkspaceMembersContract = defineRouteContract({
  method: 'GET',
  path: '/api/v2/workspaces/[workspaceId]/members',
  params: v2WorkspaceParamsSchema,
  query: v2ListWorkspaceMembersQuerySchema,
  response: { mode: 'json', schema: v2CursorListResponse(v2WorkspaceMemberSchema) },
})

const v2WorkspaceMemberParamsSchema = z
  .object({
    workspaceId: workspaceIdSchema.describe('Workspace the member belongs to.'),
    userId: requiredFieldSchema('User ID is required')
      .max(MAX_ID_LENGTH, 'User ID is too long')
      .describe('User identifier of the workspace member, as returned by List workspace members.'),
  })
  .strict()

const v2UpdateWorkspaceMemberBodySchema = z
  .object({
    role: z
      .enum(['admin', 'write', 'read'])
      .describe(
        'New workspace role. Inherited organization Admin access, the workspace owner, and the workspace billing account keep Admin and cannot be changed here.'
      ),
  })
  .strict()

export const v2UpdateWorkspaceMemberContract = defineRouteContract({
  method: 'PATCH',
  path: '/api/v2/workspaces/[workspaceId]/members/[userId]',
  params: v2WorkspaceMemberParamsSchema,
  query: noInputSchema,
  body: v2UpdateWorkspaceMemberBodySchema,
  response: { mode: 'json', schema: v2DataResponse(v2WorkspaceMemberSchema) },
})

export const v2RemoveWorkspaceMemberContract = defineRouteContract({
  method: 'DELETE',
  path: '/api/v2/workspaces/[workspaceId]/members/[userId]',
  params: v2WorkspaceMemberParamsSchema,
  query: noInputSchema,
  response: {
    mode: 'json',
    schema: v2DataResponse(
      z
        .object({
          userId: z.string().describe('User removed from the workspace.'),
          deleted: z.literal(true).describe('Whether workspace access was removed.'),
          organizationMembershipRemoved: z
            .boolean()
            .describe(
              'Whether this was the member’s last workspace in the organization, so their organization membership and seat were removed too.'
            ),
        })
        .strict()
        .meta({
          id: 'V2WorkspaceMemberDeletion',
          title: 'Workspace member removal',
          description: 'Acknowledges removal of a workspace member.',
        })
    ),
  },
})
