import { z } from 'zod'
import {
  batchWorkspaceInvitationBodySchema,
  invitationMembershipSchema,
} from '@/lib/api/contracts/invitations'
import { updateOrganizationMemberRoleBodySchema } from '@/lib/api/contracts/organization'
import {
  organizationUsageBreakdownQuerySchema,
  organizationUsageEventsQuerySchema,
  organizationUsageSummaryQuerySchema,
} from '@/lib/api/contracts/organization-usage'
import {
  addPermissionGroupMemberBodySchema,
  createPermissionGroupBodySchema,
  updatePermissionGroupBodySchema,
} from '@/lib/api/contracts/permission-groups'
import { updateWorkspacePermissionsBodySchema } from '@/lib/api/contracts/workspaces'
import { getOrganizationUsageBreakdown } from '@/lib/billing/application/organization-usage/get-organization-usage-breakdown'
import { getOrganizationUsageSummary } from '@/lib/billing/application/organization-usage/get-organization-usage-summary'
import { listOrganizationUsageEvents } from '@/lib/billing/application/organization-usage/list-organization-usage-events'
import {
  dataDrainToolPatchSchema,
  projectDataDrainForTool,
  projectDataDrainRunForTool,
} from '@/lib/data-drains/application/tool-projection'
import {
  deleteDataDrain,
  getDataDrain,
  listDataDrainRuns,
  runDataDrain,
  testDataDrain,
  updateDataDrain,
} from '@/lib/data-drains/application/use-cases'
import { listWorkspaceInvitations } from '@/lib/invitations/application/list-workspace-invitations'
import {
  cancelInvitation,
  cancelWorkspaceInvitation,
  resendInvitation,
  resendWorkspaceInvitation,
} from '@/lib/invitations/application/manage-invitation'
import {
  sendInvitationBatch,
  sendWorkspaceInvitationBatch,
} from '@/lib/invitations/application/send-invitation-batch'
import {
  configureSlackSearchInstallation,
  removeSlackSearchInstallation,
} from '@/lib/knowledge/application/slack-search/installations'
import { slackSearchSettingsPatchSchema } from '@/lib/knowledge/application/slack-search/settings-projection'
import {
  memberUsageLimitSettingsActions,
  usageLimitSettingsActions,
} from '@/lib/mothership/tools/server/settings-billing'
import { archivedChatSettingsActions } from '@/lib/mothership/tools/server/settings-chats'
import {
  projectSettingsGroupMember,
  projectSettingsWorkspace,
  readSettingsGroups,
  readSettingsRoster,
  readSettingsRosterAccess,
  settingsPage,
  settingsPageSchema,
} from '@/lib/mothership/tools/server/settings-collections'
import { connectedAccountSettingsActions } from '@/lib/mothership/tools/server/settings-connected-accounts'
import { customBlockSettingsActions } from '@/lib/mothership/tools/server/settings-custom-blocks'
import {
  organizationByokSettingsActions,
  personalKeySettingsActions,
  workspaceByokSettingsActions,
  workspaceKeySettingsActions,
} from '@/lib/mothership/tools/server/settings-keys'
import {
  type SettingsOperation,
  settingsOperation,
  settingsOrganizationId,
  settingsWorkspaceId,
} from '@/lib/mothership/tools/server/settings-operation'
import { organizationDomainSettingsActions } from '@/lib/mothership/tools/server/settings-security'
import { removeOrganizationMember } from '@/lib/organizations/application/member-removal'
import { updateOrganizationMemberRole } from '@/lib/organizations/application/member-role'
import {
  createPermissionGroup,
  deletePermissionGroup,
  getPermissionGroup,
  listPermissionGroupWorkspaces,
  updatePermissionGroup,
} from '@/lib/permission-groups/application/management'
import {
  addPermissionGroupMember,
  listPermissionGroupMembers,
  removePermissionGroupMember,
} from '@/lib/permission-groups/application/management-members'
import { updateWorkspacePermissions } from '@/lib/workspaces/application/manage-permissions'
import { removeWorkspaceMember } from '@/lib/workspaces/application/remove-member'

function dates<T extends { startDate?: string; endDate?: string }>(input: T) {
  return {
    ...input,
    startDate: input.startDate ? new Date(input.startDate) : undefined,
    endDate: input.endDate ? new Date(input.endDate) : undefined,
  }
}

/** Collection actions are selected from code, never arbitrary routes, operation IDs or permission tags. */
export const settingsOperations: Record<string, Record<string, SettingsOperation>> = {
  'workspace/custom-blocks': customBlockSettingsActions,
  'organization/sso': organizationDomainSettingsActions,
  'account/billing': usageLimitSettingsActions,
  'organization/billing': {
    ...usageLimitSettingsActions,
    ...memberUsageLimitSettingsActions,
  },
  'workspace/recently-deleted': archivedChatSettingsActions,
  'organization/recently-deleted': archivedChatSettingsActions,
  'account/api-keys': personalKeySettingsActions,
  'workspace/api-keys': workspaceKeySettingsActions,
  'workspace/byok': workspaceByokSettingsActions,
  'organization/byok': organizationByokSettingsActions,
  'organization/search-slack': {
    configure: settingsOperation('write', slackSearchSettingsPatchSchema, (context, input) =>
      configureSlackSearchInstallation.execute({
        principal: context.principal,
        input: { ...input, organizationId: settingsOrganizationId(context) },
      })
    ),
    remove: settingsOperation(
      'write',
      z.strictObject({ installationId: z.string().min(1).max(200) }),
      (context, input) =>
        removeSlackSearchInstallation.execute({
          principal: context.principal,
          input: { ...input, organizationId: settingsOrganizationId(context) },
        })
    ),
  },
  'workspace/teammates': {
    list_invitations: settingsOperation('read', z.strictObject({}), (context) =>
      listWorkspaceInvitations.execute({
        principal: context.principal,
        input: { workspaceId: settingsWorkspaceId(context) },
      })
    ),
    invite: settingsOperation(
      'write',
      z.strictObject({
        emails: batchWorkspaceInvitationBodySchema.shape.emails,
        permission: batchWorkspaceInvitationBodySchema.shape.permission,
        membership: batchWorkspaceInvitationBodySchema.shape.membership,
      }),
      (context, input) =>
        sendWorkspaceInvitationBatch.execute({
          principal: context.principal,
          input: { ...input, workspaceIds: [settingsWorkspaceId(context)] },
        })
    ),
    resend_invitation: settingsOperation(
      'write',
      z.strictObject({ invitationId: z.string().min(1).max(200) }),
      (context, input) =>
        resendWorkspaceInvitation.execute({
          principal: context.principal,
          input: { ...input, workspaceId: settingsWorkspaceId(context) },
        })
    ),
    cancel_invitation: settingsOperation(
      'write',
      z.strictObject({ invitationId: z.string().min(1).max(200) }),
      (context, input) =>
        cancelWorkspaceInvitation.execute({
          principal: context.principal,
          input: { ...input, workspaceId: settingsWorkspaceId(context) },
        })
    ),
    remove: settingsOperation(
      'write',
      z.strictObject({ userId: z.string().min(1).max(200) }),
      (context, input) =>
        removeWorkspaceMember.execute({
          principal: context.principal,
          input: { ...input, workspaceId: settingsWorkspaceId(context) },
        })
    ),
    set_permissions: settingsOperation(
      'write',
      updateWorkspacePermissionsBodySchema.strict(),
      (context, input) =>
        updateWorkspacePermissions.execute({
          principal: context.principal,
          input: { ...input, workspaceId: settingsWorkspaceId(context) },
        })
    ),
  },
  'organization/connected-accounts': connectedAccountSettingsActions,
  'organization/data-drains': {
    get: settingsOperation(
      'read',
      z.strictObject({ drainId: z.string().min(1) }),
      async (context, input) =>
        projectDataDrainForTool(
          await getDataDrain.execute({
            principal: context.principal,
            input: { ...input, organizationId: settingsOrganizationId(context) },
          })
        )
    ),
    update: settingsOperation(
      'write',
      z.strictObject({ drainId: z.string().min(1), changes: dataDrainToolPatchSchema }),
      async (context, { drainId, changes }) =>
        projectDataDrainForTool(
          await updateDataDrain.execute({
            principal: context.principal,
            input: { drainId, organizationId: settingsOrganizationId(context), body: changes },
          })
        )
    ),
    delete: settingsOperation(
      'write',
      z.strictObject({ drainId: z.string().min(1) }),
      async (context, input) => ({
        deleted: (
          await deleteDataDrain.execute({
            principal: context.principal,
            input: { ...input, organizationId: settingsOrganizationId(context) },
          })
        ).deleted,
      })
    ),
    runs: settingsOperation(
      'read',
      z.strictObject({
        drainId: z.string().min(1),
        limit: z.number().int().min(1).max(200).default(25),
      }),
      async (context, input) =>
        (
          await listDataDrainRuns.execute({
            principal: context.principal,
            input: { ...input, organizationId: settingsOrganizationId(context) },
          })
        ).map(projectDataDrainRunForTool)
    ),
    run: settingsOperation(
      'write',
      z.strictObject({ drainId: z.string().min(1) }),
      async (context, input) => ({
        status: 'queued',
        jobId: (
          await runDataDrain.execute({
            principal: context.principal,
            input: { ...input, organizationId: settingsOrganizationId(context) },
          })
        ).jobId,
      })
    ),
    test: settingsOperation(
      'read',
      z.strictObject({ drainId: z.string().min(1) }),
      async (context, input) => {
        const result = await testDataDrain.execute({
          principal: context.principal,
          input: { ...input, organizationId: settingsOrganizationId(context) },
        })
        return result.ok
          ? { ok: true }
          : {
              ok: false,
              error: 'Connection test failed. Review the secure Settings form for details.',
            }
      }
    ),
  },
  'organization/access-control': {
    list_groups: settingsOperation('read', settingsPageSchema, readSettingsGroups),
    list_group_workspaces: settingsOperation(
      'read',
      settingsPageSchema.extend({ groupId: z.string().min(1).max(200) }),
      async (context, input) => {
        const result = await getPermissionGroup.execute({
          principal: context.principal,
          input: { groupId: input.groupId, organizationId: settingsOrganizationId(context) },
        })
        return settingsPage(
          result.permissionGroup.workspaces.map(projectSettingsWorkspace),
          input,
          (row) => row.id
        )
      }
    ),
    get_group: settingsOperation(
      'read',
      z.strictObject({ groupId: z.string().min(1) }),
      async (context, input) => {
        const result = await getPermissionGroup.execute({
          principal: context.principal,
          input: { ...input, organizationId: settingsOrganizationId(context) },
        })
        const { workspaces, ...group } = result.permissionGroup
        return {
          permissionGroup: {
            ...group,
            name: group.name.slice(0, 300),
            description: group.description?.slice(0, 300) ?? null,
            workspaceCount: workspaces.length,
          },
          workspaceAccess: 'Use list_group_workspaces for paginated workspace scope.',
        }
      }
    ),
    create_group: settingsOperation(
      'write',
      createPermissionGroupBodySchema.strict(),
      (context, settings) =>
        createPermissionGroup.execute({
          principal: context.principal,
          input: { settings, organizationId: settingsOrganizationId(context) },
        })
    ),
    update_group: settingsOperation(
      'write',
      z.strictObject({
        groupId: z.string().min(1),
        settings: updatePermissionGroupBodySchema.strict(),
      }),
      (context, input) =>
        updatePermissionGroup.execute({
          principal: context.principal,
          input: { ...input, organizationId: settingsOrganizationId(context) },
        })
    ),
    delete_group: settingsOperation(
      'write',
      z.strictObject({ groupId: z.string().min(1) }),
      async (context, input) => ({
        success: (
          await deletePermissionGroup.execute({
            principal: context.principal,
            input: { ...input, organizationId: settingsOrganizationId(context) },
          })
        ).success,
      })
    ),
    list_workspaces: settingsOperation('read', settingsPageSchema, async (context, input) => {
      const result = await listPermissionGroupWorkspaces.execute({
        principal: context.principal,
        input: { organizationId: settingsOrganizationId(context) },
      })
      return settingsPage(result.workspaces.map(projectSettingsWorkspace), input, (row) => row.id)
    }),
    list_members: settingsOperation(
      'read',
      settingsPageSchema.extend({ groupId: z.string().min(1).max(200) }),
      async (context, input) => {
        const result = await listPermissionGroupMembers.execute({
          principal: context.principal,
          input: { groupId: input.groupId, organizationId: settingsOrganizationId(context) },
        })
        return settingsPage(result.members.map(projectSettingsGroupMember), input, (row) => row.id)
      }
    ),
    add_member: settingsOperation(
      'write',
      addPermissionGroupMemberBodySchema.extend({ groupId: z.string().min(1) }).strict(),
      async (context, input) => ({
        member: (
          await addPermissionGroupMember.execute({
            principal: context.principal,
            input: { ...input, organizationId: settingsOrganizationId(context) },
          })
        ).member,
      })
    ),
    remove_member: settingsOperation(
      'write',
      z.strictObject({ groupId: z.string().min(1), memberId: z.string().min(1) }),
      async (context, input) => ({
        success: (
          await removePermissionGroupMember.execute({
            principal: context.principal,
            input: { ...input, organizationId: settingsOrganizationId(context) },
          })
        ).success,
      })
    ),
  },
  'organization/members': {
    list_page: settingsOperation('read', settingsPageSchema, readSettingsRoster),
    list_member_workspaces: settingsOperation(
      'read',
      settingsPageSchema.extend({ userId: z.string().min(1).max(200) }),
      readSettingsRosterAccess
    ),
    list_invitation_workspaces: settingsOperation(
      'read',
      settingsPageSchema.extend({ invitationId: z.string().min(1).max(200) }),
      readSettingsRosterAccess
    ),
    resend_invitation: settingsOperation(
      'write',
      z.strictObject({ invitationId: z.string().min(1) }),
      (context, input) =>
        resendInvitation.execute({
          principal: context.principal,
          input: { ...input, organizationId: settingsOrganizationId(context) },
        })
    ),
    cancel_invitation: settingsOperation(
      'write',
      z.strictObject({ invitationId: z.string().min(1) }),
      (context, input) =>
        cancelInvitation.execute({
          principal: context.principal,
          input: { ...input, organizationId: settingsOrganizationId(context) },
        })
    ),
    remove: settingsOperation(
      'write',
      z.strictObject({ userId: z.string().min(1) }),
      (context, input) =>
        removeOrganizationMember.execute({
          principal: context.principal,
          input: { ...input, organizationId: settingsOrganizationId(context) },
        })
    ),
    invite: settingsOperation(
      'write',
      z.strictObject({
        emails: batchWorkspaceInvitationBodySchema.shape.emails,
        membership: invitationMembershipSchema.extract(['admin', 'member']).default('member'),
      }),
      (context, input) =>
        sendInvitationBatch.execute({
          principal: context.principal,
          input: { ...input, organizationId: settingsOrganizationId(context), workspaceIds: [] },
        })
    ),
    set_role: settingsOperation(
      'write',
      updateOrganizationMemberRoleBodySchema.extend({ userId: z.string().min(1) }).strict(),
      (context, input) =>
        updateOrganizationMemberRole.execute({
          principal: context.principal,
          input: { ...input, organizationId: settingsOrganizationId(context) },
        })
    ),
  },
  'organization/usage': {
    summary: settingsOperation(
      'read',
      organizationUsageSummaryQuerySchema.strict(),
      (context, input) =>
        getOrganizationUsageSummary.execute({
          principal: context.principal,
          input: { ...dates(input), organizationId: settingsOrganizationId(context) },
        })
    ),
    breakdown: settingsOperation(
      'read',
      organizationUsageBreakdownQuerySchema.strict(),
      (context, input) =>
        getOrganizationUsageBreakdown.execute({
          principal: context.principal,
          input: { ...dates(input), organizationId: settingsOrganizationId(context) },
        })
    ),
    events: settingsOperation(
      'read',
      organizationUsageEventsQuerySchema.strict(),
      (context, input) =>
        listOrganizationUsageEvents.execute({
          principal: context.principal,
          input: { ...dates(input), organizationId: settingsOrganizationId(context) },
        })
    ),
  },
}
