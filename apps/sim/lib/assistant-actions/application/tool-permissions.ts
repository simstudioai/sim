import { AuditAction, AuditResourceType } from '@sim/audit'
import { db } from '@sim/db'
import { loadAssistantAccountPolicyContext } from '@/lib/assistant-actions/application/context'
import { assistantActionOperations } from '@/lib/assistant-actions/application/operations'
import {
  loadAssistantToolPermissions,
  lockAssistantToolPermissions,
  resolveAssistantToolPolicy,
  saveAssistantToolPermissions,
} from '@/lib/assistant-actions/tool-permissions'
import type { AssistantToolPermissionChange } from '@/lib/assistant-actions/types'
import { acquireOrganizationUserMutationLocks } from '@/lib/billing/organizations/membership'
import {
  defineAuthorizedOrganizationUseCase,
  type OrganizationUseCaseContext,
} from '@/lib/core/application/authorized-organization-use-case'
import { authorizeOrganizationOperation } from '@/lib/core/application/organization-authorization'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { acquirePermissionGroupOrgReadLock } from '@/lib/permission-groups/locks'
import { getToolMetadata } from '@/tools/metadata'

interface AccountInput {
  organizationId: string
  credentialId: string
}

export const readOrganizationToolPermissions = defineAuthorizedOrganizationUseCase({
  operation: assistantActionOperations.readPermissions,
  async execute({
    input,
    context,
  }: {
    input: AccountInput
    context: { organizationId: string; userId: string }
  }) {
    const scope = {
      organizationId: context.organizationId,
      userId: context.userId,
      credentialId: input.credentialId,
    }
    const { account, tools, canAutoApprove } = await loadAssistantAccountPolicyContext(scope)
    const permissions = await loadAssistantToolPermissions(scope)
    return {
      account,
      revision: permissions.revision,
      readPolicy: permissions.readPolicy,
      writePolicy: permissions.writePolicy,
      canAutoApprove,
      tools: tools.flatMap(({ toolId, config }) =>
        config.assistant
          ? [
              {
                toolId,
                name: config.name,
                description: config.description,
                effect: config.assistant.effect,
                version: config.assistant.version,
                policy: resolveAssistantToolPolicy(permissions, toolId, config.assistant),
                inherited: permissions.overrides[toolId] === undefined,
              },
            ]
          : []
      ),
    }
  },
})

export const updateOrganizationToolPermissions = defineAuthorizedOrganizationUseCase({
  operation: assistantActionOperations.updatePermissions,
  async execute({
    principal,
    input,
    context,
  }: OrganizationUseCaseContext<
    AccountInput & { revision: number; change: AssistantToolPermissionChange }
  >) {
    const scope = {
      organizationId: context.organizationId,
      userId: context.userId,
      credentialId: input.credentialId,
    }
    return db.transaction(async (tx) => {
      await acquireOrganizationUserMutationLocks(tx, {
        userId: scope.userId,
        organizationIds: [scope.organizationId],
      })
      await lockAssistantToolPermissions(scope, tx)
      await acquirePermissionGroupOrgReadLock(tx, scope.organizationId)
      await authorizeOrganizationOperation(
        principal,
        assistantActionOperations.updatePermissions,
        input,
        { executor: tx, forUpdate: true }
      )
      const { account, tools, canAutoApprove } = await loadAssistantAccountPolicyContext(scope, tx)
      const permissions = await loadAssistantToolPermissions(scope, tx)
      if (permissions.revision !== input.revision)
        throw new OrchestrationError('conflict', 'Tool permissions changed. Refresh and try again.')
      const { change } = input
      if (change.policy === 'allow' && !account.active)
        throw new OrchestrationError(
          'forbidden',
          'Reconnect this account before allowing tools automatically.'
        )
      if (change.policy === 'allow' && !canAutoApprove)
        throw new OrchestrationError('forbidden', 'Your organization requires tool approval.')
      const next = {
        ...permissions,
        revision: permissions.revision + 1,
        overrides: { ...permissions.overrides },
      }
      if (change.kind === 'group') {
        next[change.effect === 'read' ? 'readPolicy' : 'writePolicy'] =
          change.policy === 'allow' ? 'ask' : change.policy
        for (const toolId of Object.keys(next.overrides)) {
          const operation = getToolMetadata(toolId)?.assistant
          if (!operation || operation.effect === change.effect) delete next.overrides[toolId]
        }
        for (const tool of tools) {
          if (tool.config.assistant?.effect !== change.effect) continue
          if (change.policy === 'allow')
            next.overrides[tool.toolId] = {
              version: tool.config.assistant.version,
              policy: 'allow',
            }
        }
      } else {
        const tool = tools.find((entry) => entry.toolId === change.toolId)
        if (!tool?.config.assistant)
          throw new OrchestrationError(
            'validation',
            'This Assistant operation is unavailable for this account.'
          )
        if (change.policy === null) delete next.overrides[change.toolId]
        else
          next.overrides[change.toolId] = {
            version: tool.config.assistant.version,
            policy: change.policy,
          }
      }
      await saveAssistantToolPermissions(scope, next, tx)
      return { revision: next.revision }
    })
  },
  projectAudit: ({ input, result }) => ({
    action: AuditAction.CREDENTIAL_UPDATED,
    resourceType: AuditResourceType.CREDENTIAL,
    resourceId: input.credentialId,
    description: 'Updated personal Assistant tool permissions',
    metadata: { change: input.change, revision: result.revision },
  }),
})
