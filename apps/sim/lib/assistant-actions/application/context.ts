import type { Principal } from '@sim/auth/principal'
import { db } from '@sim/db'
import {
  copilotChats,
  copilotRuns,
  credential,
  credentialGroup,
  credentialGroupEnrollment,
} from '@sim/db/schema'
import { toRecord } from '@sim/utils/object'
import { and, eq, isNull } from 'drizzle-orm'
import { resolveAssistantActionBinding } from '@/lib/assistant-actions/binding'
import { loadAssistantIntegrationTools } from '@/lib/assistant-actions/catalog'
import {
  loadAssistantAccount,
  loadAssistantToolPermissions,
  lockAssistantToolPermissions,
  resolveAssistantToolPolicy,
} from '@/lib/assistant-actions/tool-permissions'
import type { AssistantToolPermissionScope } from '@/lib/assistant-actions/types'
import { acquireOrganizationUserMutationLocks } from '@/lib/billing/organizations/membership'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { lockCredentialGroupEnrollmentLifecycle } from '@/lib/credential-groups/enrollments'
import type { DbOrTx, DbTransaction } from '@/lib/db/types'
import { SIM_TOOL_EXECUTION_VERSION } from '@/lib/mothership/async-runs/lifecycle'
import { TERMINAL_RUN_STATUSES } from '@/lib/mothership/async-runs/repository'
import { providerIdsForService } from '@/lib/oauth/utils'
import { capabilityDeniedBy } from '@/lib/permission-groups/capability-assertions'
import { acquirePermissionGroupOrgReadLock } from '@/lib/permission-groups/locks'

/** The same visible operation catalog governs settings and execution admission. */
export async function loadAssistantAccountPolicyContext(
  scope: AssistantToolPermissionScope,
  executor: DbOrTx = db
) {
  const account = await loadAssistantAccount(scope, executor)
  if (!account) throw new OrchestrationError('not_found', 'Connected account not found')
  const catalog = await loadAssistantIntegrationTools(scope, executor)
  const tools = catalog.tools.filter(
    ({ config: tool }) =>
      tool.oauth && providerIdsForService(tool.oauth.provider).includes(account.providerId)
  )
  const config = catalog.config
  const canAutoApprove = !capabilityDeniedBy('copilot.tool_auto_approval', config)
  return { account, tools, canAutoApprove }
}

/** A transaction retains the chat lock until its decision or claim commits, before locking the run. */
export async function requireAssistantRun(
  principal: Principal,
  input: { organizationId: string; runId: string; chatId?: string },
  userId: string,
  executor: DbOrTx = db
) {
  const chatId =
    principal.kind === 'session'
      ? input.chatId
      : principal.kind === 'organization_delegated' && principal.serviceId === 'copilot'
        ? principal.resourceScope.chatId
        : undefined
  if (!chatId)
    throw new OrchestrationError('forbidden', 'Assistant actions require a private conversation.')
  const [run] = await executor
    .select({
      runId: copilotRuns.id,
      streamId: copilotRuns.streamId,
      currentStreamId: copilotChats.conversationId,
      config: copilotChats.config,
      version: copilotRuns.toolExecutionVersion,
      closedAt: copilotRuns.toolAdmissionClosedAt,
      status: copilotRuns.status,
    })
    .from(copilotRuns)
    .innerJoin(copilotChats, eq(copilotChats.id, copilotRuns.chatId))
    .where(
      and(
        eq(copilotRuns.id, input.runId),
        eq(copilotRuns.organizationId, input.organizationId),
        eq(copilotRuns.userId, userId),
        eq(copilotChats.userId, userId),
        eq(copilotChats.organizationId, input.organizationId),
        eq(copilotChats.id, chatId),
        isNull(copilotChats.deletedAt)
      )
    )
    .limit(1)
    .for('share', { of: copilotChats })
  if (
    !run ||
    toRecord(run.config).conversationMode !== 'assistant' ||
    run.version !== SIM_TOOL_EXECUTION_VERSION
  )
    throw new OrchestrationError('not_found', 'Assistant conversation is unavailable.')
  if (
    run.currentStreamId !== run.streamId ||
    run.closedAt ||
    TERMINAL_RUN_STATUSES.includes(run.status)
  )
    throw new OrchestrationError('conflict', 'This conversation is no longer accepting actions.')
  return { runId: run.runId, streamId: run.streamId }
}

export async function resolveAssistantActionPolicy(
  scope: AssistantToolPermissionScope,
  input: { toolId: string; args: Record<string, unknown> },
  executor: DbOrTx = db
) {
  const binding = resolveAssistantActionBinding(input.toolId, input.args)
  const { account, tools, canAutoApprove } = await loadAssistantAccountPolicyContext(
    scope,
    executor
  )
  const operation = tools.find((tool) => tool.toolId === input.toolId)?.config.assistant
  if (!account.active || !operation || binding.credentialId !== scope.credentialId)
    throw new OrchestrationError(
      'forbidden',
      'This operation requires your active connected account.'
    )
  const permissions = await loadAssistantToolPermissions(scope, executor)
  const policy = resolveAssistantToolPolicy(permissions, input.toolId, operation)
  if (policy === 'block')
    throw new OrchestrationError('forbidden', 'This tool is blocked in your account permissions.')
  return { binding, policy: policy === 'allow' && !canAutoApprove ? ('ask' as const) : policy }
}

/** Locks account lifecycle before policy, then rows in the same order as revocation and OAuth completion. */
export async function lockAssistantActionScope(
  scope: AssistantToolPermissionScope,
  tx: DbTransaction
) {
  await acquireOrganizationUserMutationLocks(tx, {
    userId: scope.userId,
    organizationIds: [scope.organizationId],
  })
  const [identity] = await tx
    .select({
      groupId: credentialGroupEnrollment.credentialGroupId,
      enrollmentId: credentialGroupEnrollment.id,
    })
    .from(credential)
    .innerJoin(
      credentialGroupEnrollment,
      eq(credentialGroupEnrollment.id, credential.credentialGroupEnrollmentId)
    )
    .where(
      and(
        eq(credential.id, scope.credentialId),
        eq(credential.organizationId, scope.organizationId),
        eq(credentialGroupEnrollment.userId, scope.userId)
      )
    )
    .limit(1)
  if (!identity) throw new OrchestrationError('not_found', 'Connected account not found.')
  await lockCredentialGroupEnrollmentLifecycle(tx, identity.enrollmentId)
  await lockAssistantToolPermissions(scope, tx)
  await acquirePermissionGroupOrgReadLock(tx, scope.organizationId)
  await tx
    .select({ id: credentialGroup.id })
    .from(credentialGroup)
    .where(eq(credentialGroup.id, identity.groupId))
    .for('share')
  await tx
    .select({ id: credentialGroupEnrollment.id })
    .from(credentialGroupEnrollment)
    .where(eq(credentialGroupEnrollment.id, identity.enrollmentId))
    .for('share')
  await tx
    .select({ id: credential.id })
    .from(credential)
    .where(eq(credential.id, scope.credentialId))
    .for('share')
}
