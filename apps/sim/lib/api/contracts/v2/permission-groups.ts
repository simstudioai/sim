import { z } from 'zod'
import {
  createPermissionGroupBodySchema,
  permissionGroupFullConfigSchema,
  updatePermissionGroupBodySchema,
} from '@/lib/api/contracts/permission-groups'
import {
  noInputSchema,
  nonEmptyIdSchema,
  organizationIdSchema,
} from '@/lib/api/contracts/primitives'
import { defineRouteContract } from '@/lib/api/contracts/types'
import {
  v2CursorListResponse,
  v2DataResponse,
  v2PaginationFields,
  v2SearchSchema,
  v2SortFields,
  v2TimestampSchema,
} from '@/lib/api/contracts/v2/shared'
import { MAX_PERMISSION_GROUP_BULK_MEMBERS } from '@/lib/permission-groups/constants'
import { permissionGroupConfigSchema } from '@/lib/permission-groups/fields'

export const v2PermissionGroupOrganizationParamsSchema = z.object({
  organizationId: organizationIdSchema.describe('Organization that owns the permission groups.'),
})
export type V2PermissionGroupOrganizationParams = z.input<
  typeof v2PermissionGroupOrganizationParamsSchema
>
export const v2PermissionGroupParamsSchema = v2PermissionGroupOrganizationParamsSchema.extend({
  groupId: nonEmptyIdSchema.describe('Permission group identifier.'),
})
export type V2PermissionGroupParams = z.input<typeof v2PermissionGroupParamsSchema>
export const v2PermissionGroupMemberParamsSchema = v2PermissionGroupParamsSchema.extend({
  userId: nonEmptyIdSchema.describe('User identifier of the member to remove.'),
})
export type V2PermissionGroupMemberParams = z.input<typeof v2PermissionGroupMemberParamsSchema>

export const v2PermissionGroupSchema = z
  .object({
    id: z.string().describe('Permission group identifier.'),
    organizationId: z.string().describe('Organization that owns the group.'),
    name: z.string().describe('Group name, unique within the organization.'),
    description: z.string().nullable().describe('Optional description of the group.'),
    config: permissionGroupFullConfigSchema.describe(
      'Resolved restrictions. True disables a boolean capability; null allowlists permit every value and empty allowlists permit none.'
    ),
    isDefault: z
      .boolean()
      .describe(
        'Whether this is the organization default, which applies to everyone across all its workspaces regardless of member assignments.'
      ),
    membershipMode: z
      .string()
      .describe(
        'An empty inherit group governs everyone in its workspaces; an empty explicit group governs nobody.'
      ),
    workspaceIds: z
      .array(z.string())
      .describe('Workspaces governed by a non-default group. Empty for the default group.'),
    createdBy: z.string().describe('User who created the group.'),
    createdAt: v2TimestampSchema.describe('When the group was created.'),
    updatedAt: v2TimestampSchema.describe('When the group was last updated.'),
  })
  .meta({
    id: 'V2PermissionGroup',
    title: 'Permission group',
    description: 'An organization permission group and its resolved restrictions.',
  })
export type V2PermissionGroup = z.output<typeof v2PermissionGroupSchema>

export const v2PermissionGroupMemberSchema = z
  .object({
    id: z.string().describe('Membership assignment identifier.'),
    userId: z.string().describe('Organization member assigned to the group.'),
    assignedAt: v2TimestampSchema.describe('When the member was assigned.'),
    userName: z.string().nullable().describe('Member display name.'),
    userEmail: z.string().nullable().describe('Member email address.'),
    userImage: z.string().nullable().describe('Member avatar URL.'),
  })
  .meta({
    id: 'V2PermissionGroupMember',
    title: 'Permission group member',
    description: 'An explicit permission-group membership assignment.',
  })
export type V2PermissionGroupMember = z.output<typeof v2PermissionGroupMemberSchema>

export const v2ListPermissionGroupsQuerySchema = z
  .object({
    search: v2SearchSchema.describe('Case-insensitive substring match against the group name.'),
    ...v2SortFields(['name', 'createdAt', 'updatedAt'] as const, {
      sortBy: 'createdAt',
      sortOrder: 'desc',
    }),
    ...v2PaginationFields({ description: 'Maximum permission groups to return per page.' }),
  })
  .strict()
export type V2ListPermissionGroupsQuery = z.output<typeof v2ListPermissionGroupsQuerySchema>
export const v2ListPermissionGroupMembersQuerySchema = z
  .object({
    ...v2SortFields(['assignedAt', 'userId'] as const, { sortBy: 'assignedAt', sortOrder: 'asc' }),
    ...v2PaginationFields({ description: 'Maximum group members to return per page.' }),
  })
  .strict()
export type V2ListPermissionGroupMembersQuery = z.output<
  typeof v2ListPermissionGroupMembersQuerySchema
>

const configPatchSchema = permissionGroupConfigSchema.strict()

export const v2CreatePermissionGroupBodySchema = createPermissionGroupBodySchema
  .safeExtend({
    workspaceIds: createPermissionGroupBodySchema.shape.workspaceIds.describe(
      'Workspace IDs targeted by a non-default group. Required when creating a non-default group; omit for a default group.'
    ),
    config: configPatchSchema
      .describe(
        'Permission restrictions to set. Omitted keys use the default permission configuration.'
      )
      .optional(),
  })
  .strict()
  .refine((body) => body.isDefault === true || Boolean(body.workspaceIds?.length), {
    path: ['workspaceIds'],
    message: 'Select at least one workspace when the group targets specific workspaces',
  })
export type V2CreatePermissionGroupBody = z.input<typeof v2CreatePermissionGroupBodySchema>
export const v2UpdatePermissionGroupBodySchema = updatePermissionGroupBodySchema
  .safeExtend({
    config: configPatchSchema
      .describe(
        'Patch of permission restrictions. Omitted keys remain unchanged; each supplied array replaces that entire list.'
      )
      .optional(),
  })
  .strict()
  .refine((body) => Object.values(body).some((value) => value !== undefined), {
    message: 'At least one permission group field is required',
  })
export type V2UpdatePermissionGroupBody = z.input<typeof v2UpdatePermissionGroupBodySchema>
export const v2AddPermissionGroupMemberBodySchema = z
  .object({
    userId: nonEmptyIdSchema.describe('Existing organization member to add.'),
  })
  .strict()
export type V2AddPermissionGroupMemberBody = z.input<typeof v2AddPermissionGroupMemberBodySchema>
export const v2BulkAddPermissionGroupMembersBodySchema = z
  .object({
    userIds: z
      .array(nonEmptyIdSchema)
      .min(1, 'userIds cannot be empty')
      .max(
        MAX_PERMISSION_GROUP_BULK_MEMBERS,
        'userIds cannot exceed 1000; split the members into batches'
      )
      .optional()
      .describe(
        'Organization member identifiers. Existing group members are skipped; users outside the organization are ignored.'
      ),
    addAllOrganizationMembers: z
      .boolean()
      .optional()
      .describe(
        'Add every current organization member in bounded batches within one transaction. Cannot be combined with userIds.'
      ),
  })
  .strict()
  .superRefine((body, ctx) => {
    if (
      body.addAllOrganizationMembers === true ? body.userIds !== undefined : !body.userIds?.length
    )
      ctx.addIssue({
        code: 'custom',
        path: ['userIds'],
        message: 'Provide userIds or set addAllOrganizationMembers to true, but not both',
      })
  })
export type V2BulkAddPermissionGroupMembersBody = z.input<
  typeof v2BulkAddPermissionGroupMembersBodySchema
>

export const v2ListPermissionGroupsContract = defineRouteContract({
  method: 'GET',
  path: '/api/v2/organizations/[organizationId]/permission-groups',
  params: v2PermissionGroupOrganizationParamsSchema,
  query: v2ListPermissionGroupsQuerySchema,
  response: { mode: 'json', schema: v2CursorListResponse(v2PermissionGroupSchema) },
})
export const v2CreatePermissionGroupContract = defineRouteContract({
  method: 'POST',
  path: '/api/v2/organizations/[organizationId]/permission-groups',
  params: v2PermissionGroupOrganizationParamsSchema,
  query: noInputSchema,
  body: v2CreatePermissionGroupBodySchema,
  response: { mode: 'json', schema: v2DataResponse(v2PermissionGroupSchema), status: 201 },
})
export const v2GetPermissionGroupContract = defineRouteContract({
  method: 'GET',
  path: '/api/v2/organizations/[organizationId]/permission-groups/[groupId]',
  params: v2PermissionGroupParamsSchema,
  query: noInputSchema,
  response: { mode: 'json', schema: v2DataResponse(v2PermissionGroupSchema) },
})
export const v2UpdatePermissionGroupContract = defineRouteContract({
  method: 'PATCH',
  path: '/api/v2/organizations/[organizationId]/permission-groups/[groupId]',
  params: v2PermissionGroupParamsSchema,
  query: noInputSchema,
  body: v2UpdatePermissionGroupBodySchema,
  response: { mode: 'json', schema: v2DataResponse(v2PermissionGroupSchema) },
})
export const v2DeletePermissionGroupContract = defineRouteContract({
  method: 'DELETE',
  path: '/api/v2/organizations/[organizationId]/permission-groups/[groupId]',
  params: v2PermissionGroupParamsSchema,
  query: noInputSchema,
  response: {
    mode: 'json',
    schema: v2DataResponse(
      z
        .object({
          id: z.string().describe('Deleted permission group identifier.'),
          deleted: z.literal(true).describe('Whether the group was permanently deleted.'),
        })
        .meta({
          id: 'V2PermissionGroupDeletion',
          title: 'Permission group deletion',
          description: 'Acknowledges permanent group deletion.',
        })
    ),
  },
})
export const v2ListPermissionGroupMembersContract = defineRouteContract({
  method: 'GET',
  path: '/api/v2/organizations/[organizationId]/permission-groups/[groupId]/members',
  params: v2PermissionGroupParamsSchema,
  query: v2ListPermissionGroupMembersQuerySchema,
  response: { mode: 'json', schema: v2CursorListResponse(v2PermissionGroupMemberSchema) },
})
export const v2AddPermissionGroupMemberContract = defineRouteContract({
  method: 'POST',
  path: '/api/v2/organizations/[organizationId]/permission-groups/[groupId]/members',
  params: v2PermissionGroupParamsSchema,
  query: noInputSchema,
  body: v2AddPermissionGroupMemberBodySchema,
  response: {
    mode: 'json',
    status: 201,
    schema: v2DataResponse(
      z
        .object({
          id: z.string().describe('Membership assignment identifier.'),
          permissionGroupId: z.string().describe('Group receiving the member.'),
          organizationId: z.string().describe('Organization that owns the group.'),
          userId: z.string().describe('User assigned to the group.'),
          assignedBy: z.string().describe('User who made the assignment.'),
          assignedAt: v2TimestampSchema.describe('When the assignment was created.'),
        })
        .meta({
          id: 'V2PermissionGroupAssignment',
          title: 'Permission group assignment',
          description: 'The newly created membership assignment.',
        })
    ),
  },
})
export const v2RemovePermissionGroupMemberContract = defineRouteContract({
  method: 'DELETE',
  path: '/api/v2/organizations/[organizationId]/permission-groups/[groupId]/members/[userId]',
  params: v2PermissionGroupMemberParamsSchema,
  query: noInputSchema,
  response: {
    mode: 'json',
    schema: v2DataResponse(
      z
        .object({
          userId: z.string().describe('User whose membership assignment was removed.'),
          deleted: z.literal(true).describe('Whether the assignment was removed.'),
        })
        .meta({
          id: 'V2PermissionGroupMemberDeletion',
          title: 'Permission group member deletion',
          description: 'Acknowledges membership removal.',
        })
    ),
  },
})
export const v2BulkAddPermissionGroupMembersContract = defineRouteContract({
  method: 'POST',
  path: '/api/v2/organizations/[organizationId]/permission-groups/[groupId]/members/bulk',
  params: v2PermissionGroupParamsSchema,
  query: noInputSchema,
  body: v2BulkAddPermissionGroupMembersBodySchema,
  response: {
    mode: 'json',
    schema: v2DataResponse(
      z
        .object({
          added: z.number().describe('Number of members added.'),
          skipped: z
            .number()
            .describe('Number of selected organization members already in the group.'),
        })
        .meta({
          id: 'V2PermissionGroupBulkAdd',
          title: 'Permission group bulk addition',
          description: 'Counts of added and already assigned organization members.',
        })
    ),
  },
})
