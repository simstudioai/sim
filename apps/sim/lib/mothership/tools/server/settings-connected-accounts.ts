import { z } from 'zod'
import {
  createCredentialGroupMcpConnectorBodySchema,
  managedMcpConnectorIdSchema,
  updateCredentialGroupBodySchema,
} from '@/lib/api/contracts/credential-groups'
import {
  ensureOrganizationAccountsBodySchema,
  inviteOrganizationAccountPeopleBodySchema,
  listOrganizationAccountPeopleQuerySchema,
  startOrganizationAccountConnectionBodySchema,
  updateOrganizationAccountIndexingBodySchema,
  updateOrganizationAccountWorkspaceAccessBodySchema,
} from '@/lib/api/contracts/organization-accounts'
import {
  getOrganizationAccountWorkspaceAccess,
  updateOrganizationAccountWorkspaceAccess,
} from '@/lib/credential-groups/application/organization-access'
import { updateOrganizationAccountIndexing } from '@/lib/credential-groups/application/organization-account-indexing'
import {
  addOrganizationAccountMcpProvider,
  inviteOrganizationAccountPeople,
  listOrganizationAccountPeople,
  removeOrganizationAccountMcpProvider,
  resendOrganizationAccountInvitation,
  revokeOrganizationAccountEnrollment,
} from '@/lib/credential-groups/application/organization-account-management'
import {
  ensureOrganizationAccounts,
  startOrganizationAccountConnection,
  updateOrganizationAccountsSettings,
} from '@/lib/credential-groups/application/organization-accounts'
import {
  settingsOperation,
  settingsOrganizationId,
} from '@/lib/mothership/tools/server/settings-operation'

export const connectedAccountSettingsActions = {
  setup: settingsOperation(
    'write',
    ensureOrganizationAccountsBodySchema,
    async (context, input) => {
      const result = await ensureOrganizationAccounts.execute({
        principal: context.principal,
        input: { ...input, organizationId: settingsOrganizationId(context) },
      })
      return { ...result, status: 'configured', connectionRequired: true }
    }
  ),
  update: settingsOperation(
    'write',
    z.strictObject({
      groupId: z.string().min(1).max(128),
      changes: updateCredentialGroupBodySchema,
    }),
    (context, { groupId, changes }) =>
      updateOrganizationAccountsSettings.execute({
        principal: context.principal,
        input: {
          organizationId: settingsOrganizationId(context),
          credentialGroupId: groupId,
          update: changes,
        },
      })
  ),
  connect: settingsOperation(
    'write',
    startOrganizationAccountConnectionBodySchema,
    async (context, input) => ({
      status: 'requires_user_setup',
      ...(await startOrganizationAccountConnection.execute({
        principal: context.principal,
        input: { ...input, organizationId: settingsOrganizationId(context) },
      })),
      instructions:
        'Place the authorization link at the end of the reply for the user. This starts setup; it does not establish a connection.',
    })
  ),
  list_people: settingsOperation(
    'read',
    listOrganizationAccountPeopleQuerySchema.strict(),
    (context, input) =>
      listOrganizationAccountPeople.execute({
        principal: context.principal,
        input: { ...input, organizationId: settingsOrganizationId(context) },
      })
  ),
  invite: settingsOperation(
    'write',
    inviteOrganizationAccountPeopleBodySchema.strict(),
    async (context, input) => {
      const result = await inviteOrganizationAccountPeople.execute({
        principal: context.principal,
        input: { ...input, organizationId: settingsOrganizationId(context) },
      })
      return {
        sentCount: result.sentCount,
        failedCount: result.failedCount,
        results: result.results.map((entry) =>
          entry.success
            ? { email: entry.email, success: true, enrollment: entry.enrollment }
            : {
                email: entry.email,
                success: false,
                error: 'Invitation could not be sent. Review Settings for details.',
              }
        ),
      }
    }
  ),
  resend_invitation: settingsOperation(
    'write',
    z.strictObject({
      enrollmentId: z.string().min(1).max(128),
      optionId: z.string().min(1).max(128).optional(),
    }),
    async (context, input) => ({
      enrollment: (
        await resendOrganizationAccountInvitation.execute({
          principal: context.principal,
          input: { ...input, organizationId: settingsOrganizationId(context) },
        })
      ).credentialGroupEnrollment,
    })
  ),
  revoke: settingsOperation(
    'write',
    z.strictObject({ enrollmentId: z.string().min(1).max(128) }),
    async (context, input) => ({
      enrollment: (
        await revokeOrganizationAccountEnrollment.execute({
          principal: context.principal,
          input: { ...input, organizationId: settingsOrganizationId(context) },
        })
      ).credentialGroupEnrollment,
    })
  ),
  workspace_access: settingsOperation('read', z.strictObject({}), (context) =>
    getOrganizationAccountWorkspaceAccess.execute({
      principal: context.principal,
      input: { organizationId: settingsOrganizationId(context) },
    })
  ),
  set_workspace_access: settingsOperation(
    'write',
    updateOrganizationAccountWorkspaceAccessBodySchema,
    async (context, input) => {
      const result = await updateOrganizationAccountWorkspaceAccess.execute({
        principal: context.principal,
        input: { ...input, organizationId: settingsOrganizationId(context) },
      })
      return { revision: result.revision, grants: result.grants }
    }
  ),
  set_indexing: settingsOperation(
    'write',
    updateOrganizationAccountIndexingBodySchema,
    async (context, input) => {
      const result = await updateOrganizationAccountIndexing.execute({
        principal: context.principal,
        input: { ...input, organizationId: settingsOrganizationId(context) },
      })
      return { enabled: result.enabled, knowledgeBaseIds: result.knowledgeBaseIds }
    }
  ),
  add_mcp_provider: settingsOperation(
    'write',
    z.union([
      createCredentialGroupMcpConnectorBodySchema.options[0],
      createCredentialGroupMcpConnectorBodySchema.options[1],
    ]),
    async (context, input) => ({
      mcpServer: (
        await addOrganizationAccountMcpProvider.execute({
          principal: context.principal,
          input: { ...input, organizationId: settingsOrganizationId(context) },
        })
      ).mcpServer,
    })
  ),
  remove_mcp_provider: settingsOperation(
    'write',
    z.strictObject({ connectorId: managedMcpConnectorIdSchema }),
    async (context, input) => ({
      mcpServer: (
        await removeOrganizationAccountMcpProvider.execute({
          principal: context.principal,
          input: { ...input, organizationId: settingsOrganizationId(context) },
        })
      ).mcpServer,
    })
  ),
}
