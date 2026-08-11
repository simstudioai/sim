import { AuditAction, AuditResourceType } from '@sim/audit'
import {
  type Principal,
  requirePrincipalSubjectUserId,
  resolvePrincipalAttribution,
  toPrincipalActor,
} from '@sim/auth/principal'
import { chat, db } from '@sim/db'
import { and, eq, isNull } from 'drizzle-orm'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { defineAuthorizedWorkflowUseCase } from '@/lib/workflows/application/authorized-workflow-use-case'
import { resolveActiveWorkflowApplicationContext } from '@/lib/workflows/application/context'
import { workflowOperations } from '@/lib/workflows/application/operations'
import { assertedWorkflowWorkspaceId } from '@/lib/workflows/application/principal-scope'
import { performChatDeploy, performChatUndeploy } from '@/lib/workflows/orchestration'
import {
  ChatDeployAuthNotAllowedError,
  validateChatDeployAuth,
} from '@/ee/access-control/utils/permission-check'

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
  versionDescription: string
  versionName: string
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
    const [existingDeployment] = await db
      .select()
      .from(chat)
      .where(and(eq(chat.workflowId, context.workflowId), isNull(chat.archivedAt)))
      .limit(1)

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

    const [identifierOwner] = await db
      .select({ id: chat.id })
      .from(chat)
      .where(and(eq(chat.identifier, identifier), isNull(chat.archivedAt)))
      .limit(1)
    if (identifierOwner && identifierOwner.id !== existingDeployment?.id) {
      throw new OrchestrationError('conflict', 'Identifier already in use')
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

    const subjectUserId = requirePrincipalSubjectUserId(principal)
    if (authType !== existingDeployment?.authType) {
      try {
        await validateChatDeployAuth(subjectUserId, context.workspaceId, authType)
      } catch (error) {
        if (error instanceof ChatDeployAuthNotAllowedError) {
          throw new OrchestrationError('forbidden', error.message)
        }
        throw error
      }
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
    })
    if (!result.success || !result.chatId || !result.chatUrl) {
      throw new OrchestrationError('validation', result.error ?? 'Failed to deploy chat')
    }
    return {
      ...result,
      chatId: result.chatId,
      chatUrl: result.chatUrl,
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
    const [deployment] = await db
      .select()
      .from(chat)
      .where(and(eq(chat.workflowId, context.workflowId), isNull(chat.archivedAt)))
      .limit(1)
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
      throw new OrchestrationError('not_found', result.error ?? 'Failed to undeploy chat')
    }
    return { workflowId: context.workflowId, deployment }
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
