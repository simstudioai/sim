import { z } from 'zod'
import { organizationIdSchema } from '@/lib/api/contracts/primitives'
import { shareAuthTypeSchema } from '@/lib/api/contracts/public-shares'
import { defineRouteContract } from '@/lib/api/contracts/types'
import { permissionGroupConfigSchema } from '@/lib/permission-groups/types'

export const permissionGroupFullConfigSchema = z.object({
  allowedIntegrations: z.array(z.string()).nullable(),
  allowedModelProviders: z.array(z.string()).nullable(),
  deniedModels: z.array(z.string()).default([]),
  deniedTools: z.array(z.string()).default([]),
  hideTraceSpans: z.boolean(),
  hideKnowledgeBaseTab: z.boolean(),
  hideTablesTab: z.boolean(),
  hideCopilot: z.boolean(),
  hideIntegrationsTab: z.boolean(),
  hideSecretsTab: z.boolean(),
  hideApiKeysTab: z.boolean(),
  hideInboxTab: z.boolean(),
  hideFilesTab: z.boolean(),
  disableMcpTools: z.boolean(),
  disableCustomTools: z.boolean(),
  disableSkills: z.boolean(),
  disableInvitations: z.boolean(),
  disablePublicApi: z.boolean(),
  disablePublicFileSharing: z.boolean(),
  allowedFileShareAuthTypes: z.array(shareAuthTypeSchema).nullable(),
  hideDeployApi: z.boolean(),
  hideDeployMcp: z.boolean(),
  hideDeployChatbot: z.boolean(),
  hideDeployTemplate: z.boolean(),
})

export const addPermissionGroupMemberBodySchema = z.object({
  userId: z.string().min(1),
})

/** Route params for organization-scoped permission-group collection routes (`id` = organizationId). */
export const permissionGroupParamsSchema = z.object({
  id: organizationIdSchema,
})

/** Route params for a single permission group (`id` = organizationId, `groupId` = permission group id). */
export const permissionGroupDetailParamsSchema = z.object({
  id: organizationIdSchema,
  groupId: z.string().min(1),
})

/** A workspace a permission group targets (id + display name). */
export const permissionGroupWorkspaceRefSchema = z.object({
  id: z.string(),
  name: z.string(),
})
export type PermissionGroupWorkspaceRef = z.output<typeof permissionGroupWorkspaceRefSchema>

export const permissionGroupSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  config: permissionGroupFullConfigSchema,
  createdBy: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
  creatorName: z.string().nullable(),
  creatorEmail: z.string().nullable(),
  memberCount: z.number(),
  isDefault: z.boolean(),
  /**
   * Workspaces this group targets. Empty for the default group (which governs
   * every workspace) and for a non-default group scoped to nothing.
   */
  workspaces: z.array(permissionGroupWorkspaceRefSchema),
})
export type PermissionGroup = z.output<typeof permissionGroupSchema>

export const permissionGroupWriteSchema = z.object({
  id: z.string(),
  organizationId: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  config: permissionGroupFullConfigSchema,
  createdBy: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
  isDefault: z.boolean(),
  /** Ids of targeted workspaces (empty for the default group). */
  workspaceIds: z.array(z.string()),
})
export type PermissionGroupWrite = z.output<typeof permissionGroupWriteSchema>

export const permissionGroupMemberSchema = z.object({
  id: z.string(),
  userId: z.string(),
  assignedAt: z.string(),
  userName: z.string().nullable(),
  userEmail: z.string().nullable(),
  userImage: z.string().nullable(),
})
export type PermissionGroupMember = z.output<typeof permissionGroupMemberSchema>

export const userPermissionConfigQuerySchema = z.object({
  workspaceId: z.string().min(1),
})

export const userPermissionConfigSchema = z.object({
  permissionGroupId: z.string().nullable(),
  groupName: z.string().nullable(),
  config: permissionGroupFullConfigSchema.nullable(),
  entitled: z.boolean(),
  /** The workspace's owning organization id (null when the workspace has no org). */
  organizationId: z.string().nullable(),
  /** Whether the caller is an owner/admin of the workspace's owning organization. */
  isOrgAdmin: z.boolean(),
})
export type UserPermissionConfig = z.output<typeof userPermissionConfigSchema>

/** Upper bound on how many workspaces a single group can explicitly target. */
export const MAX_PERMISSION_GROUP_WORKSPACES = 500

const workspaceIdsSchema = z.array(z.string().min(1)).max(MAX_PERMISSION_GROUP_WORKSPACES)

/**
 * The one cross-field scope rule shared by create and update: the organization
 * default group governs every workspace, so it cannot also name specific
 * workspaces (they would be silently dropped server-side). "Org-wide" is
 * definitionally `isDefault` — there is no separate flag — so a default group
 * with no `workspaceIds` is already the all-workspaces case and needs no
 * assertion here.
 *
 * Everything else is left to the routes: a non-default group targets the
 * workspaces in `workspaceIds` (empty is allowed on update — the group then
 * governs nothing, since the resolver inner-joins the workspace link table), and
 * the create route requires at least one workspace up front.
 */
function refineWorkspaceScope(
  body: { workspaceIds?: string[]; isDefault?: boolean },
  ctx: z.RefinementCtx
) {
  if (body.isDefault === true && body.workspaceIds && body.workspaceIds.length > 0) {
    ctx.addIssue({
      code: 'custom',
      path: ['workspaceIds'],
      message: 'The default group governs all workspaces and cannot target specific workspaces',
    })
  }
}

export const createPermissionGroupBodySchema = z
  .object({
    name: z.string().trim().min(1).max(100),
    description: z.string().max(500).optional(),
    config: permissionGroupConfigSchema.optional(),
    isDefault: z.boolean().optional(),
    workspaceIds: workspaceIdsSchema.optional(),
  })
  .superRefine(refineWorkspaceScope)

export const updatePermissionGroupBodySchema = z
  .object({
    name: z.string().trim().min(1).max(100).optional(),
    description: z.string().max(500).nullable().optional(),
    config: permissionGroupConfigSchema.optional(),
    isDefault: z.boolean().optional(),
    workspaceIds: workspaceIdsSchema.optional(),
  })
  .superRefine(refineWorkspaceScope)

export const removePermissionGroupMemberQuerySchema = z.object({
  memberId: z.string().min(1),
})

export const bulkAddPermissionGroupMembersBodySchema = z.object({
  userIds: z.array(z.string()).optional(),
  addAllOrganizationMembers: z.boolean().optional(),
})

const successResponseSchema = z.object({
  success: z.literal(true),
})

export const listPermissionGroupsContract = defineRouteContract({
  method: 'GET',
  path: '/api/organizations/[id]/permission-groups',
  params: permissionGroupParamsSchema,
  response: {
    mode: 'json',
    schema: z.object({
      permissionGroups: z.array(permissionGroupSchema).optional(),
    }),
  },
})

export const createPermissionGroupContract = defineRouteContract({
  method: 'POST',
  path: '/api/organizations/[id]/permission-groups',
  params: permissionGroupParamsSchema,
  body: createPermissionGroupBodySchema,
  response: {
    mode: 'json',
    schema: z.object({
      permissionGroup: permissionGroupWriteSchema,
    }),
  },
})

export const getUserPermissionConfigContract = defineRouteContract({
  method: 'GET',
  path: '/api/permission-groups/user',
  query: userPermissionConfigQuerySchema,
  response: {
    mode: 'json',
    schema: userPermissionConfigSchema,
  },
})

export const updatePermissionGroupContract = defineRouteContract({
  method: 'PUT',
  path: '/api/organizations/[id]/permission-groups/[groupId]',
  params: permissionGroupDetailParamsSchema,
  body: updatePermissionGroupBodySchema,
  response: {
    mode: 'json',
    schema: z.object({
      permissionGroup: permissionGroupWriteSchema,
    }),
  },
})

export const deletePermissionGroupContract = defineRouteContract({
  method: 'DELETE',
  path: '/api/organizations/[id]/permission-groups/[groupId]',
  params: permissionGroupDetailParamsSchema,
  response: {
    mode: 'json',
    schema: successResponseSchema,
  },
})

export const listPermissionGroupMembersContract = defineRouteContract({
  method: 'GET',
  path: '/api/organizations/[id]/permission-groups/[groupId]/members',
  params: permissionGroupDetailParamsSchema,
  response: {
    mode: 'json',
    schema: z.object({
      members: z.array(permissionGroupMemberSchema).optional(),
    }),
  },
})

export const removePermissionGroupMemberContract = defineRouteContract({
  method: 'DELETE',
  path: '/api/organizations/[id]/permission-groups/[groupId]/members',
  params: permissionGroupDetailParamsSchema,
  query: removePermissionGroupMemberQuerySchema,
  response: {
    mode: 'json',
    schema: successResponseSchema,
  },
})

export const addPermissionGroupMemberContract = defineRouteContract({
  method: 'POST',
  path: '/api/organizations/[id]/permission-groups/[groupId]/members',
  params: permissionGroupDetailParamsSchema,
  body: addPermissionGroupMemberBodySchema,
  response: {
    mode: 'json',
    schema: z.object({
      member: z.object({
        id: z.string(),
        permissionGroupId: z.string(),
        organizationId: z.string(),
        userId: z.string(),
        assignedBy: z.string(),
        assignedAt: z.string(),
      }),
    }),
  },
})

export const bulkAddPermissionGroupMembersContract = defineRouteContract({
  method: 'POST',
  path: '/api/organizations/[id]/permission-groups/[groupId]/members/bulk',
  params: permissionGroupDetailParamsSchema,
  body: bulkAddPermissionGroupMembersBodySchema,
  response: {
    mode: 'json',
    schema: z.object({
      added: z.number(),
      // Users not added because they were already in this group. A conflicting
      // selection fails the whole request (409) rather than being skipped, so
      // the add is all-or-nothing for conflicts.
      skipped: z.number(),
    }),
  },
})

/**
 * List the workspaces belonging to an organization, used to populate the
 * workspace multi-select when scoping a permission group to specific workspaces.
 */
export const listOrganizationWorkspacesContract = defineRouteContract({
  method: 'GET',
  path: '/api/organizations/[id]/workspaces',
  params: permissionGroupParamsSchema,
  response: {
    mode: 'json',
    schema: z.object({
      workspaces: z.array(permissionGroupWorkspaceRefSchema),
    }),
  },
})
