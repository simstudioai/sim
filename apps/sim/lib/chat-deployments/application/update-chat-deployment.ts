import { AuditAction, AuditResourceType } from '@sim/audit'
import { type Principal, requirePrincipalSubjectUserId } from '@sim/auth/principal'
import { createLogger } from '@sim/logger'
import {
  assertedChatDeploymentWorkspaceId,
  resolveActiveChatDeploymentApplicationContext,
} from '@/lib/chat-deployments/application/context'
import {
  ChatIdentifierInUseError,
  chatIdentifierUniquenessConflict,
} from '@/lib/chat-deployments/application/errors'
import { chatDeploymentOperations } from '@/lib/chat-deployments/application/operations'
import {
  type ChatDeploymentView,
  toChatDeploymentView,
} from '@/lib/chat-deployments/application/read-chat-deployments'
import {
  type ChatDeploymentRow,
  getChatDeploymentIdOwningIdentifier,
  updateChatDeploymentRow,
} from '@/lib/chat-deployments/queries'
import { buildChatDeploymentUrl } from '@/lib/chat-deployments/urls'
import { defineAuthorizedWorkspaceUseCase } from '@/lib/core/application'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { encryptSecret } from '@/lib/core/security/encryption'
import { checkNeedsRedeployment } from '@/lib/workflows/deployment-status'
import { getWorkflowDeploymentSummary, performFullDeploy } from '@/lib/workflows/orchestration'
import { validateChatDeployAuth } from '@/ee/access-control/utils/permission-check'

const logger = createLogger('UpdateChatDeployment')

type ChatAuthType = 'public' | 'password' | 'email' | 'sso'

export interface UpdateChatDeploymentInput {
  chatDeploymentId: string
  assertedWorkspaceId?: string
  /** Accepted only when it equals the deployment's current workflow; see below. */
  workflowId?: string
  identifier?: string
  title?: string
  description?: string
  customizations?: { primaryColor?: string; welcomeMessage?: string; imageUrl?: string }
  authType?: ChatAuthType
  password?: string
  allowedEmails?: string[]
  outputConfigs?: Array<{ blockId: string; path: string }>
  includeThinking?: boolean
  includeToolCalls?: boolean
}

export interface UpdateChatDeploymentResult {
  deployment: ChatDeploymentView
  workspaceId: string
  chatUrl: string
}

/**
 * Resolves the password column from the requested change.
 *
 * Two rules, both of which shipped as bugs once:
 *
 * - A `password` auth type with no supplied password is only legal when one is
 *   already stored, otherwise the deployment fails closed at login with an
 *   opaque configuration error.
 * - A supplied password is stored *only* when the deployment ends up
 *   password-protected. Applying it unconditionally re-armed the secret the
 *   auth-type matrix had just cleared, so `PATCH { authType: 'email', password }`
 *   persisted a password on an email-gated chat.
 */
async function resolvePasswordUpdate(
  existing: ChatDeploymentRow,
  input: UpdateChatDeploymentInput
): Promise<string | null | undefined> {
  const effectiveAuthType = input.authType ?? (existing.authType as ChatAuthType)

  if (input.password) {
    if (effectiveAuthType !== 'password') return undefined
    const { encrypted } = await encryptSecret(input.password)
    return encrypted
  }

  if (input.authType === 'password' && (existing.authType !== 'password' || !existing.password)) {
    throw new OrchestrationError(
      'validation',
      'Password is required when using password protection'
    )
  }
  return undefined
}

/**
 * The auth-type field-clearing matrix.
 *
 * Each mode owns exactly one of the two gate columns, so switching modes must
 * clear the other — a leftover password on an email-gated chat, or a leftover
 * allow-list on a public one, is a stale gate nothing else erases.
 */
function clearedGateColumnsFor(authType: ChatAuthType): Partial<ChatDeploymentRow> {
  switch (authType) {
    case 'public':
      return { password: null, allowedEmails: [] }
    case 'password':
      return { allowedEmails: [] }
    case 'email':
    case 'sso':
      return { password: null }
  }
}

/**
 * Redeploys the underlying workflow when the draft has drifted, and refuses
 * while another attempt is in flight.
 *
 * Both refusals are conflicts rather than errors: the caller's request is
 * well-formed and will succeed once the pending deployment settles. The
 * post-deploy check is the load-bearing one — a deploy settles asynchronously
 * and `success` only admits the attempt, so advancing the chat row before
 * cutover would strand it on the previous version with no error. This is the
 * invariant `performChatDeploy` enforces on the create path; keeping both in
 * application code is what stops them drifting apart.
 */
async function redeployWorkflowIfDrifted(workflowId: string, userId: string): Promise<void> {
  const deploymentSummary = await getWorkflowDeploymentSummary(workflowId)
  const attemptStatus = deploymentSummary.latestDeploymentAttempt?.status
  if (attemptStatus === 'preparing' || attemptStatus === 'activating') {
    throw new OrchestrationError(
      'conflict',
      'A workflow deployment is still preparing. Retry the chat update after it becomes active.'
    )
  }

  const needsRedeploy =
    !deploymentSummary.activeDeployment || (await checkNeedsRedeployment(workflowId))
  if (!needsRedeploy) return

  const deployResult = await performFullDeploy({ workflowId, userId })
  if (!deployResult.success) {
    logger.warn(`Failed to redeploy workflow for chat update: ${deployResult.error}`)
    const message = deployResult.error || 'Failed to redeploy workflow'
    if (deployResult.errorCode === 'validation' || deployResult.errorCode === 'not_found') {
      throw new OrchestrationError(deployResult.errorCode, message)
    }
    throw new Error(message)
  }
  if (deployResult.latestDeploymentAttempt?.status !== 'active') {
    throw new OrchestrationError(
      'conflict',
      deployResult.warnings?.[0] ??
        'Workflow deployment is still preparing. Retry the chat update after it becomes active.'
    )
  }
  logger.info(`Redeployed workflow ${workflowId} for chat update (v${deployResult.version})`)
}

export const updateChatDeployment = defineAuthorizedWorkspaceUseCase({
  operation: chatDeploymentOperations.update,
  resolveContext: ({
    principal,
    input,
  }: {
    principal: Principal
    input: UpdateChatDeploymentInput
  }) =>
    resolveActiveChatDeploymentApplicationContext({
      chatDeploymentId: input.chatDeploymentId,
      assertedWorkspaceId: assertedChatDeploymentWorkspaceId(principal, input.assertedWorkspaceId),
    }),
  authorizationOptions: {},
  async execute({ principal, input, context }): Promise<UpdateChatDeploymentResult> {
    const existing = context.chatDeployment

    /**
     * A chat deployment is bound to its workflow for its whole life: the
     * deployed URL, the pinned version, and the generated input schema all
     * derive from it. Re-pointing one is a new deployment, not an edit.
     */
    if (input.workflowId && input.workflowId !== existing.workflowId) {
      throw new OrchestrationError(
        'validation',
        'Changing the workflow of a chat deployment is not allowed'
      )
    }

    const actingUserId = requirePrincipalSubjectUserId(principal)

    /**
     * The permission group's auth-mode allow-list applies only when the mode
     * actually changes, so a grandfathered mode already saved on this chat can
     * be re-saved by a title-only edit without a refusal.
     */
    if (input.authType && input.authType !== existing.authType) {
      await validateChatDeployAuth(actingUserId, context.workspaceId, input.authType)
    }

    if (input.identifier && input.identifier !== existing.identifier) {
      const owner = await getChatDeploymentIdOwningIdentifier(input.identifier)
      if (owner && owner !== existing.id) {
        throw new ChatIdentifierInUseError()
      }
    }

    const encryptedPassword = await resolvePasswordUpdate(existing, input)

    await redeployWorkflowIfDrifted(existing.workflowId, actingUserId)

    const values: Partial<ChatDeploymentRow> = {}
    if (input.identifier) values.identifier = input.identifier
    if (input.title) values.title = input.title
    if (input.description !== undefined) values.description = input.description
    if (input.customizations) values.customizations = input.customizations
    if (input.authType) {
      values.authType = input.authType
      Object.assign(values, clearedGateColumnsFor(input.authType))
    }
    if (encryptedPassword !== undefined) values.password = encryptedPassword
    if (input.allowedEmails) values.allowedEmails = input.allowedEmails
    if (input.outputConfigs) values.outputConfigs = input.outputConfigs
    if (input.includeThinking !== undefined) values.includeThinking = input.includeThinking
    /** Partial updates keep the stored value; a row predating the column reads false. */
    values.includeToolCalls = input.includeToolCalls ?? existing.includeToolCalls ?? false

    const updated = await updateChatDeploymentRow(existing.id, values).catch(
      chatIdentifierUniquenessConflict(values.identifier ?? existing.identifier)
    )
    if (!updated) throw new OrchestrationError('not_found', 'Chat deployment not found')

    return {
      deployment: toChatDeploymentView(updated),
      workspaceId: context.workspaceId,
      chatUrl: buildChatDeploymentUrl(updated.identifier),
    }
  },
  projectAudit: ({ result }) => ({
    action: AuditAction.CHAT_UPDATED,
    resourceType: AuditResourceType.CHAT,
    resourceId: result.deployment.id,
    resourceName: result.deployment.title,
    description: `Updated chat deployment "${result.deployment.title}"`,
    metadata: {
      identifier: result.deployment.identifier,
      authType: result.deployment.authType,
      workflowId: result.deployment.workflowId,
      chatUrl: result.chatUrl,
    },
  }),
})
