import { AuditAction, AuditResourceType } from '@sim/audit'
import {
  defineAuthorizedPermissionGroupUseCase,
  type PermissionGroupInput,
  type PermissionGroupOrganizationInput,
} from '@/lib/permission-groups/application/authorized-permission-group-use-case'
import { permissionGroupOperations } from '@/lib/permission-groups/application/operations'
import { parsePermissionGroupConfig } from '@/lib/permission-groups/fields'
import {
  createPermissionGroupRecord,
  deletePermissionGroupRecord,
  type PermissionGroupChanges,
  requirePermissionGroup,
  updatePermissionGroupRecord,
} from '@/lib/permission-groups/group-manager'
import {
  listPermissionGroupMemberRecords,
  listPermissionGroupRecords,
  listPermissionGroupWorkspaceRecords,
  type PermissionGroupListOptions,
  type PermissionGroupMemberSortBy,
  type PermissionGroupSortBy,
  type PermissionGroupWorkspaceSortBy,
} from '@/lib/permission-groups/list'
import {
  addPermissionGroupMemberRecord,
  type BulkAddPermissionGroupMembersInput,
  bulkAddPermissionGroupMemberRecords,
  removePermissionGroupMemberRecord,
} from '@/lib/permission-groups/member-manager'
import { getGroupWorkspaces } from '@/lib/permission-groups/repository'

export const listPermissionGroups = defineAuthorizedPermissionGroupUseCase({
  operation: permissionGroupOperations.list,
  execute: ({
    input,
  }: {
    input: PermissionGroupOrganizationInput &
      PermissionGroupListOptions<PermissionGroupSortBy> & { search?: string }
  }) => listPermissionGroupRecords(input.organizationId, input),
})

export const getPermissionGroup = defineAuthorizedPermissionGroupUseCase({
  operation: permissionGroupOperations.read,
  async execute({ input }: { input: PermissionGroupInput }) {
    const group = await requirePermissionGroup(input.organizationId, input.groupId)
    const workspaces = group.isDefault ? [] : await getGroupWorkspaces(group.id)
    return {
      ...group,
      config: parsePermissionGroupConfig(group.config),
      workspaces,
      workspaceIds: workspaces.map((workspace) => workspace.id),
    }
  },
})

export const createPermissionGroup = defineAuthorizedPermissionGroupUseCase({
  operation: permissionGroupOperations.create,
  execute: ({
    input,
    context,
  }: {
    input: PermissionGroupOrganizationInput & { changes: PermissionGroupChanges & { name: string } }
    context: { userId: string }
  }) => createPermissionGroupRecord(input.organizationId, context.userId, input.changes),
  projectAudit: ({ result }) => ({
    action: AuditAction.PERMISSION_GROUP_CREATED,
    resourceType: AuditResourceType.PERMISSION_GROUP,
    resourceId: result.id,
    resourceName: result.name,
    description: `Created permission group "${result.name}"`,
    metadata: { isDefault: result.isDefault, workspaceCount: result.workspaceIds.length },
  }),
})

export const updatePermissionGroup = defineAuthorizedPermissionGroupUseCase({
  operation: permissionGroupOperations.update,
  execute: ({ input }: { input: PermissionGroupInput & { changes: PermissionGroupChanges } }) =>
    updatePermissionGroupRecord(input.organizationId, input.groupId, input.changes),
  projectAudit: ({ input, result }) => ({
    action: AuditAction.PERMISSION_GROUP_UPDATED,
    resourceType: AuditResourceType.PERMISSION_GROUP,
    resourceId: result.id,
    resourceName: result.name,
    description: `Updated permission group "${result.name}"`,
    metadata: {
      updatedFields: Object.keys(input.changes).filter(
        (key) => input.changes[key as keyof PermissionGroupChanges] !== undefined
      ),
    },
  }),
})

export const deletePermissionGroup = defineAuthorizedPermissionGroupUseCase({
  operation: permissionGroupOperations.delete,
  execute: ({ input }: { input: PermissionGroupInput }) =>
    deletePermissionGroupRecord(input.organizationId, input.groupId),
  projectAudit: ({ result }) => ({
    action: AuditAction.PERMISSION_GROUP_DELETED,
    resourceType: AuditResourceType.PERMISSION_GROUP,
    resourceId: result.id,
    resourceName: result.name,
    description: `Deleted permission group "${result.name}"`,
  }),
})

export const listPermissionGroupMembers = defineAuthorizedPermissionGroupUseCase({
  operation: permissionGroupOperations.listMembers,
  async execute({
    input,
  }: {
    input: PermissionGroupInput & PermissionGroupListOptions<PermissionGroupMemberSortBy>
  }) {
    const group = await requirePermissionGroup(input.organizationId, input.groupId)
    return listPermissionGroupMemberRecords(group.id, input)
  },
})

export const addPermissionGroupMember = defineAuthorizedPermissionGroupUseCase({
  operation: permissionGroupOperations.addMember,
  execute: ({
    input,
    context,
  }: {
    input: PermissionGroupInput & { userId: string }
    context: { userId: string }
  }) =>
    addPermissionGroupMemberRecord(
      input.organizationId,
      input.groupId,
      input.userId,
      context.userId
    ),
  projectAudit: ({ result }) => ({
    action: AuditAction.PERMISSION_GROUP_MEMBER_ADDED,
    resourceType: AuditResourceType.PERMISSION_GROUP,
    resourceId: result.group.id,
    resourceName: result.group.name,
    description: `Added member ${result.member.userId} to permission group "${result.group.name}"`,
    metadata: { targetUserId: result.member.userId, permissionGroupId: result.group.id },
  }),
})

export const removePermissionGroupMember = defineAuthorizedPermissionGroupUseCase({
  operation: permissionGroupOperations.removeMember,
  execute: ({ input }: { input: PermissionGroupInput & { memberId: string } }) =>
    removePermissionGroupMemberRecord(input.organizationId, input.groupId, input.memberId),
  projectAudit: ({ result }) => ({
    action: AuditAction.PERMISSION_GROUP_MEMBER_REMOVED,
    resourceType: AuditResourceType.PERMISSION_GROUP,
    resourceId: result.group.id,
    resourceName: result.group.name,
    description: `Removed member ${result.member.userId} from permission group "${result.group.name}"`,
    metadata: {
      targetUserId: result.member.userId,
      targetEmail: result.member.email ?? undefined,
      memberId: result.member.id,
      permissionGroupId: result.group.id,
    },
  }),
})

export const bulkAddPermissionGroupMembers = defineAuthorizedPermissionGroupUseCase({
  operation: permissionGroupOperations.bulkAddMembers,
  execute: ({
    input,
    context,
  }: {
    input: PermissionGroupInput & BulkAddPermissionGroupMembersInput
    context: { userId: string }
  }) =>
    bulkAddPermissionGroupMemberRecords(input.organizationId, input.groupId, input, context.userId),
  projectAudit: ({ result }) =>
    result.added
      ? [
          {
            action: AuditAction.PERMISSION_GROUP_MEMBER_ADDED,
            resourceType: AuditResourceType.PERMISSION_GROUP,
            resourceId: result.group.id,
            resourceName: result.group.name,
            description: `Bulk added ${result.added} member(s) to permission group "${result.group.name}"`,
            metadata: {
              permissionGroupId: result.group.id,
              addedUserIds: result.addedUserIds,
              skipped: result.skipped,
            },
          },
        ]
      : [],
})

export const listPermissionGroupWorkspaces = defineAuthorizedPermissionGroupUseCase({
  operation: permissionGroupOperations.listWorkspaces,
  execute: ({
    input,
  }: {
    input: PermissionGroupOrganizationInput &
      PermissionGroupListOptions<PermissionGroupWorkspaceSortBy> & { search?: string }
  }) => listPermissionGroupWorkspaceRecords(input.organizationId, input),
})
