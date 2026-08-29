import { AuditAction, AuditResourceType } from '@sim/audit'
import {
  type Principal,
  requirePrincipalSubjectUserId,
  resolvePrincipalAttribution,
  toPrincipalActor,
} from '@sim/auth/principal'
import {
  ChatIdentifierInUseError,
  chatIdentifierUniquenessConflict,
} from '@/lib/chat-deployments/application/errors'
import { toChatDeploymentView } from '@/lib/chat-deployments/application/read-chat-deployments'
import {
  getChatDeploymentIdOwningIdentifier,
  getLiveChatDeploymentForWorkflow,
} from '@/lib/chat-deployments/queries'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { defineAuthorizedWorkflowUseCase } from '@/lib/workflows/application/authorized-workflow-use-case'
import { resolveActiveWorkflowApplicationContext } from '@/lib/workflows/application/context'
import { workflowOperations } from '@/lib/workflows/application/operations'
import { assertedWorkflowWorkspaceId } from '@/lib/workflows/application/principal-scope'
import { performChatDeploy, performChatUndeploy } from '@/lib/workflows/orchestration'
import { validateChatDeployAuth } from '@/ee/access-control/utils/permission-check'

type ChatAuthType = 'public' | 'password' | 'email' | 'sso'
type ChatOutputConfig = { blockId: string; path: string }
type ChatCustomizations = {
  primaryColor?: string
  welcomeMessage?: string
  imageUrl?: string
}

export interface DeployWorkflowChatInput {
  workflowId: string
  assertedWorkspaceId?: string
  identifier?: string
  title?: string
  description?: string
  /**
   * Optional because only the Copilot surface accepts them: `deploy_as_chat`
   * requires both and refuses the tool call without them, while neither HTTP
   * create contract declares a way to send one.
   */
  versionDescription?: string
  versionName?: string
  customizations?: ChatCustomizations
  authType?: ChatAuthType
  password?: string | null
  allowedEmails?: string[]
  outputConfigs?: unknown[]
  includeThinking?: boolean
  includeToolCalls?: boolean
  requestId: string
  idempotencyKey?: string
}

export interface UndeployWorkflowChatInput {
  workflowId: string
  assertedWorkspaceId?: string
}

function parseChatOutputConfigs(value: unknown[] | undefined): ChatOutputConfig[] | undefined {
  if (value === undefined) return undefined
  if (
    !value.every(
      (entry): entry is ChatOutputConfig =>
        typeof entry === 'object' &&
        entry !== null &&
        'blockId' in entry &&
        typeof entry.blockId === 'string' &&
        entry.blockId.length > 0 &&
        'path' in entry &&
        typeof entry.path === 'string'
    )
  ) {
    throw new OrchestrationError('validation', 'Invalid chat output configuration')
  }
  return value
}

function resolveWorkflowContext<I extends { workflowId: string; assertedWorkspaceId?: string }>({
  principal,
  input,
}: {
  principal: Principal
  input: I
}) {
  return resolveActiveWorkflowApplicationContext({
    workflowId: input.workflowId,
    assertedWorkspaceId: assertedWorkflowWorkspaceId(principal, input.assertedWorkspaceId),
  })
}

export const deployWorkflowChat = defineAuthorizedWorkflowUseCase({
  operation: workflowOperations.deployChat,
  resolveContext: resolveWorkflowContext<DeployWorkflowChatInput>,
  async execute({ principal, input, context }) {
    const existingDeployment = await getLiveChatDeploymentForWorkflow(context.workflowId)

    const identifier = (input.identifier || existingDeployment?.identifier || '').trim()
    const title = (input.title || existingDeployment?.title || '').trim()
    if (!identifier || !title) {
      throw new OrchestrationError('validation', 'Chat identifier and title are required')
    }
    if (!/^[a-z0-9-]+$/.test(identifier)) {
      throw new OrchestrationError(
        'validation',
        'Identifier can only contain lowercase letters, numbers, and hyphens'
      )
    }

    const identifierOwnerId = await getChatDeploymentIdOwningIdentifier(identifier)
    if (identifierOwnerId && identifierOwnerId !== existingDeployment?.id) {
      throw new ChatIdentifierInUseError()
    }

    const existingCustomizations =
      (existingDeployment?.customizations as ChatCustomizations | null) ?? {}
    const description = input.description ?? existingDeployment?.description ?? ''
    const authType = input.authType ?? (existingDeployment?.authType as ChatAuthType) ?? 'public'
    const allowedEmails =
      input.allowedEmails ?? (existingDeployment?.allowedEmails as string[] | null) ?? []
    const outputConfigs =
      parseChatOutputConfigs(input.outputConfigs) ??
      (existingDeployment?.outputConfigs as ChatOutputConfig[] | null) ??
      []
    const includeThinking = input.includeThinking ?? existingDeployment?.includeThinking ?? false
    const includeToolCalls = input.includeToolCalls ?? existingDeployment?.includeToolCalls ?? false
    const customizations = {
      primaryColor:
        input.customizations?.primaryColor ??
        existingCustomizations.primaryColor ??
        'var(--brand-hover)',
      welcomeMessage:
        input.customizations?.welcomeMessage ??
        existingCustomizations.welcomeMessage ??
        'Hi there! How can I help you today?',
      ...((input.customizations?.imageUrl ?? existingCustomizations.imageUrl)
        ? { imageUrl: input.customizations?.imageUrl ?? existingCustomizations.imageUrl }
        : {}),
    }

    /**
     * An email- or SSO-gated chat with an empty allow-list is unenterable: the
     * login form has nothing to match, so the deployment fails closed for
     * everyone. Enforced here rather than at the HTTP boundary because the
     * Copilot tool reaches this use case without one.
     */
    if ((authType === 'email' || authType === 'sso') && allowedEmails.length === 0) {
      throw new OrchestrationError(
        'validation',
        authType === 'email'
          ? 'At least one email or domain is required when using email access control'
          : 'At least one email or domain is required when using SSO access control'
      )
    }

    const subjectUserId = requirePrincipalSubjectUserId(principal)
    if (authType !== existingDeployment?.authType) {
      await validateChatDeployAuth(subjectUserId, context.workspaceId, authType)
    }

    const attribution = resolvePrincipalAttribution(principal, {
      workspaceBillingOwnerUserId: context.billedAccountUserId,
    })
    const result = await performChatDeploy({
      workflowId: context.workflowId,
      userId: attribution.attributedUserId,
      actorId: attribution.attributedUserId,
      actor: toPrincipalActor(principal),
      identifier,
      title,
      description,
      versionDescription: input.versionDescription,
      versionName: input.versionName,
      customizations,
      authType,
      password: input.password,
      allowedEmails,
      outputConfigs,
      includeThinking,
      includeToolCalls,
      workspaceId: context.workspaceId,
      requestId: input.requestId,
      idempotencyKey: input.idempotencyKey,
      projectLegacyAudit: false,
      ...(principal.kind === 'delegated'
        ? { captureDeploymentAnalytics: false as const, captureLegacyTelemetry: false }
        : {}),
    }).catch(chatIdentifierUniquenessConflict(identifier))
    if (!result.success) {
      /**
       * Classified by the orchestration rather than flattened to a `400`: an
       * in-flight deployment is a `409` the caller can retry, and an invariant
       * failure is a `500` rather than a claim that the request was malformed.
       */
      const message = result.error ?? 'Failed to deploy chat'
      if (!result.errorCode || result.errorCode === 'internal') throw new Error(message)
      throw new OrchestrationError(result.errorCode, message)
    }
    if (!result.chatId || !result.chatUrl) {
      throw new Error('Chat deployment succeeded without a chat id or URL')
    }
    /**
     * Re-read the settled row so callers present what was actually stored
     * rather than what was requested — the orchestration normalizes several
     * fields (the gate columns, the customization defaults) on the way in.
     */
    const deployment = await getLiveChatDeploymentForWorkflow(context.workflowId)
    if (!deployment) {
      throw new Error('Chat deployment succeeded without leaving a deployment row')
    }
    return {
      ...result,
      chatId: result.chatId,
      chatUrl: result.chatUrl,
      deployment: toChatDeploymentView(deployment),
      workspaceId: context.workspaceId,
      workflowId: context.workflowId,
      identifier,
      title,
      description,
      authType,
      allowedEmails,
      outputConfigs,
      includeThinking,
      includeToolCalls,
      customizations,
    }
  },
  projectAudit: ({ result }) => ({
    action: AuditAction.CHAT_DEPLOYED,
    resourceType: AuditResourceType.CHAT,
    resourceId: result.chatId,
    resourceName: result.title,
    description: `Deployed chat "${result.title}"`,
    metadata: {
      workflowId: result.workflowId,
      identifier: result.identifier,
      authType: result.authType,
      chatUrl: result.chatUrl,
      isUpdate: result.isUpdate,
      hasOutputConfigs: result.outputConfigs.length > 0,
      hasCustomizations: Object.keys(result.customizations).length > 0,
    },
  }),
})

export const undeployWorkflowChat = defineAuthorizedWorkflowUseCase({
  operation: workflowOperations.undeployChat,
  resolveContext: resolveWorkflowContext<UndeployWorkflowChatInput>,
  async execute({ principal, context }) {
    const deployment = await getLiveChatDeploymentForWorkflow(context.workflowId)
    if (!deployment) {
      throw new OrchestrationError('not_found', 'No active chat deployment found for this workflow')
    }

    const attribution = resolvePrincipalAttribution(principal, {
      workspaceBillingOwnerUserId: context.billedAccountUserId,
    })
    const result = await performChatUndeploy({
      chatId: deployment.id,
      userId: attribution.attributedUserId,
      workspaceId: context.workspaceId,
      projectLegacyAudit: false,
    })
    if (!result.success) {
      /** Only a genuinely absent deployment is concealed; anything else propagates. */
      const message = result.error ?? 'Failed to undeploy chat'
      if (result.errorCode !== 'not_found') throw new Error(message)
      throw new OrchestrationError('not_found', message)
    }
    return { workflowId: context.workflowId, deployment: toChatDeploymentView(deployment) }
  },
  projectAudit: ({ result }) => ({
    action: AuditAction.CHAT_DELETED,
    resourceType: AuditResourceType.CHAT,
    resourceId: result.deployment.id,
    resourceName: result.deployment.title || result.deployment.id,
    description: `Deleted chat deployment "${result.deployment.title || result.deployment.id}"`,
    metadata: {
      workflowId: result.workflowId,
      identifier: result.deployment.identifier || undefined,
      authType: result.deployment.authType || undefined,
    },
  }),
})
