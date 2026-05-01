import { z } from 'zod'
import { defineRouteContract } from '@/lib/api/contracts/types'
import { permissionGroupConfigSchema } from '@/lib/permission-groups/types'

export const permissionGroupFullConfigSchema = z.object({
  allowedIntegrations: z.array(z.string()).nullable(),
  allowedModelProviders: z.array(z.string()).nullable(),
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
  hideDeployApi: z.boolean(),
  hideDeployMcp: z.boolean(),
  hideDeployA2a: z.boolean(),
  hideDeployChatbot: z.boolean(),
  hideDeployTemplate: z.boolean(),
})

export const addPermissionGroupMemberBodySchema = z.object({
  userId: z.string().min(1),
})

export const permissionGroupParamsSchema = z.object({
  id: z.string().min(1),
})

export const permissionGroupDetailParamsSchema = z.object({
  id: z.string().min(1),
  groupId: z.string().min(1),
})

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
  autoAddNewMembers: z.boolean(),
})
export type PermissionGroup = z.output<typeof permissionGroupSchema>

export const permissionGroupWriteSchema = z.object({
  id: z.string(),
  workspaceId: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  config: permissionGroupFullConfigSchema,
  createdBy: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
  autoAddNewMembers: z.boolean(),
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
})
export type UserPermissionConfig = z.output<typeof userPermissionConfigSchema>

export const createPermissionGroupBodySchema = z.object({
  name: z.string().trim().min(1).max(100),
  description: z.string().max(500).optional(),
  config: permissionGroupConfigSchema.optional(),
  autoAddNewMembers: z.boolean().optional(),
})

export const updatePermissionGroupBodySchema = z.object({
  name: z.string().trim().min(1).max(100).optional(),
  description: z.string().max(500).nullable().optional(),
  config: permissionGroupConfigSchema.optional(),
  autoAddNewMembers: z.boolean().optional(),
})

export const removePermissionGroupMemberQuerySchema = z.object({
  memberId: z.string().min(1),
})

export const bulkAddPermissionGroupMembersBodySchema = z.object({
  userIds: z.array(z.string()).optional(),
  addAllWorkspaceMembers: z.boolean().optional(),
})

const successResponseSchema = z.object({
  success: z.literal(true),
})

export const listPermissionGroupsContract = defineRouteContract({
  method: 'GET',
  path: '/api/workspaces/[id]/permission-groups',
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
  path: '/api/workspaces/[id]/permission-groups',
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
  path: '/api/workspaces/[id]/permission-groups/[groupId]',
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
  path: '/api/workspaces/[id]/permission-groups/[groupId]',
  params: permissionGroupDetailParamsSchema,
  response: {
    mode: 'json',
    schema: successResponseSchema,
  },
})

export const listPermissionGroupMembersContract = defineRouteContract({
  method: 'GET',
  path: '/api/workspaces/[id]/permission-groups/[groupId]/members',
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
  path: '/api/workspaces/[id]/permission-groups/[groupId]/members',
  params: permissionGroupDetailParamsSchema,
  query: removePermissionGroupMemberQuerySchema,
  response: {
    mode: 'json',
    schema: successResponseSchema,
  },
})

export const addPermissionGroupMemberContract = defineRouteContract({
  method: 'POST',
  path: '/api/workspaces/[id]/permission-groups/[groupId]/members',
  params: permissionGroupDetailParamsSchema,
  body: addPermissionGroupMemberBodySchema,
  response: {
    mode: 'json',
    schema: z.object({
      member: z.object({
        id: z.string(),
        permissionGroupId: z.string(),
        workspaceId: z.string(),
        userId: z.string(),
        assignedBy: z.string(),
        assignedAt: z.string(),
      }),
    }),
  },
})

export const bulkAddPermissionGroupMembersContract = defineRouteContract({
  method: 'POST',
  path: '/api/workspaces/[id]/permission-groups/[groupId]/members/bulk',
  params: permissionGroupDetailParamsSchema,
  body: bulkAddPermissionGroupMembersBodySchema,
  response: {
    mode: 'json',
    schema: z.object({
      added: z.number(),
      moved: z.number(),
    }),
  },
})
