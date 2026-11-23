import { AuditAction, AuditResourceType } from '@sim/audit'
import {
  type Principal,
  requirePrincipalSubjectUserId,
  resolvePrincipalAttribution,
  toPrincipalActor,
} from '@sim/auth/principal'
import { chatDeploymentDelegationPolicy } from '@/lib/chat-deployments/application/authorization'
import {
  requireWorkflowChatDeployment,
  resolveWorkflowChatDeploymentApplicationContext,
} from '@/lib/chat-deployments/application/context'
import {
  ChatIdentifierInUseError,
  chatIdentifierUniquenessConflict,
} from '@/lib/chat-deployments/application/errors'
import { chatDeploymentOperations } from '@/lib/chat-deployments/application/operations'
import {
  type ChatDeploymentView,
  toChatDeploymentView,
  toEffectiveChatDeploymentView,
} from '@/lib/chat-deployments/application/read-chat-deployments'
import {
  type ChatDeploymentRow,
  getChatDeploymentIdOwningIdentifier,
  getLiveChatDeploymentForWorkflow,
} from '@/lib/chat-deployments/queries'
import { buildChatDeploymentUrl } from '@/lib/chat-deployments/urls'
import { defineAuthorizedWorkspaceUseCase } from '@/lib/core/application'
import { resolveCopilotSecretReference } from '@/lib/core/application/environment-reference'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { withExpectedDraft } from '@/lib/workflows/application/deployments'
import { performChatDeploy, performChatUndeploy } from '@/lib/workflows/orchestration'
import { validateChatDeployAuth } from '@/ee/access-control/utils/permission-check'

/**
 * The chat singleton of a workflow.
 *
 * A chat deployment is strictly 1:1 with the workflow it publishes — `workflowId`
 * is `NOT NULL` and cascades, and nothing can re-point one — so the workflow
 * already addresses it uniquely and the deployment's own id is a synthetic key
 * for a resource that needs none. The public surface therefore addresses it as a
 * singleton, and a singleton has no separate create verb: `PUT` is
 * create-or-replace, which is the *only* write, so one effect cannot be reached
 * through two authorization paths.
 *
 * These are keyed on the workflow. The deployment-id-keyed use cases beside them
 * stay for the internal editor, which addresses a chat it already holds the id
 * of; both bind the same {@link chatDeploymentOperations}, so the policy for an
 * effect is stated once regardless of how the resource was named.
 */

type ChatAuthType = 'public' | 'password' | 'email' | 'sso'

/** Platform defaults for the presentation fields a replace may omit. */
export const DEFAULT_PRIMARY_COLOR = 'var(--brand-hover)'
export const DEFAULT_WELCOME_MESSAGE = 'Hi there! How can I help you today?'

export interface WorkflowChatDeploymentInput {
  workflowId: string
}

export interface ReplaceWorkflowChatDeploymentInput extends WorkflowChatDeploymentInput {
  identifier: string
  title: string
  description?: string
  customizations?: { primaryColor?: string; welcomeMessage?: string; imageUrl?: string }
  authType?: ChatAuthType
  password?: string
  allowedEmails?: string[]
  outputConfigs?: Array<{ blockId: string; path: string }>
  includeThinking?: boolean
  includeToolCalls?: boolean
  requestId: string
  /**
   * The `sf1:` fingerprint of the draft the caller vouches for: when the write must redeploy the
   * workflow (its draft differs from the live version), a draft that no longer has it is refused
   * with `conflict`, nothing deployed or written.
   */
  expectedDraftFingerprint?: string
}

export interface WorkflowChatDeploymentResult {
  deployment: ChatDeploymentView
  workspaceId: string
  workflowId: string
}

function resolveContext({ input }: { input: WorkflowChatDeploymentInput }) {
  return resolveWorkflowChatDeploymentApplicationContext({ workflowId: input.workflowId })
}

/**
 * GET — the workflow's chat, or a not-found when it publishes none.
 *
 * Bound to the same `chat_deployments.read` the deployment-id-keyed read is, so
 * the gate configuration this carries — `authType`, `hasPassword`, and the
 * `allowedEmails` allow-list — is admin-gated by the same policy on both paths.
 */
export const readWorkflowChatDeployment = defineAuthorizedWorkspaceUseCase({
  operation: chatDeploymentOperations.read,
  resolveContext,
  authorizationOptions: { delegation: chatDeploymentDelegationPolicy },
  async execute({ context }): Promise<WorkflowChatDeploymentResult> {
    return {
      deployment: toEffectiveChatDeploymentView(
        requireWorkflowChatDeployment(context),
        context.workflow.isDeployed
      ),
      workspaceId: context.workspaceId,
      workflowId: context.workflowId,
    }
  },
})

export interface WorkflowChatDeploymentStatus {
  isDeployed: boolean
  /** Enough to address the deployment, and nothing the detail read gates. */
  deployment: { id: string; identifier: string } | null
}

/**
 * Whether the workflow publishes a chat, for the editor's deploy affordance.
 *
 * Bound to `chat_deployments.list`, not `chat_deployments.read`, and narrowed
 * here in the use case rather than in the adapter. The editor needs to know a
 * chat exists and which one it is so it can then fetch the detail; everything
 * `V2_CHAT_DEPLOYMENT_GATED_FIELDS` withholds from the `read`-level list —
 * `allowedEmails`, `hasPassword`, `customizations` — is absent for the same
 * reason, so this cannot be used to route around the admin-gated detail read.
 * The `deploy.chat` capability comes with `list`: a group with the chat
 * deployment surface withheld should not still be told what is published.
 *
 * `isDeployed` is the chat row's own `isActive`, deliberately not
 * {@link toEffectiveChatDeploymentView}'s "chat and workflow both live" rule.
 * This answers "does this workflow already have a chat to update", which stays
 * true while the workflow is undeployed — the editor would otherwise offer to
 * launch a chat that already exists.
 */
export const readWorkflowChatDeploymentStatus = defineAuthorizedWorkspaceUseCase({
  operation: chatDeploymentOperations.list,
  resolveContext,
  authorizationOptions: { delegation: chatDeploymentDelegationPolicy },
  async execute({ context }): Promise<WorkflowChatDeploymentStatus> {
    const deployment = context.chatDeployment
    if (!deployment) return { isDeployed: false, deployment: null }
    return {
      isDeployed: deployment.isActive,
      deployment: { id: deployment.id, identifier: deployment.identifier },
    }
  },
})

/**
 * The permission group's auth-mode allow-list, applied only when the mode
 * actually changes.
 *
 * A mode already saved on this chat can be re-saved by a replace that does not
 * touch it, so a grandfathered configuration is not refused by an edit to some
 * other field.
 */
async function assertAuthModePermitted(
  existing: ChatDeploymentRow | null,
  principal: Principal,
  workspaceId: string,
  authType: ChatAuthType
): Promise<void> {
  if (authType === existing?.authType) return
  await validateChatDeployAuth(requirePrincipalSubjectUserId(principal), workspaceId, authType)
}

/** Whether a live chat other than `chatId` (any live chat, when there is none) holds `identifier`. */
async function isChatIdentifierHeldByAnotherChat(
  identifier: string,
  chatId: string | undefined
): Promise<boolean> {
  const owner = await getChatDeploymentIdOwningIdentifier(identifier)
  return Boolean(owner) && owner !== chatId
}

/**
 * Whether a live chat other than workflow `workflowId`'s holds `identifier` (any live chat, for a
 * workflow not created yet).
 */
export async function isChatIdentifierHeldElsewhere(
  identifier: string,
  workflowId: string | undefined
): Promise<boolean> {
  const existing = workflowId ? await getLiveChatDeploymentForWorkflow(workflowId) : null
  return isChatIdentifierHeldByAnotherChat(identifier, existing?.id)
}

/**
 * Refuses what a replace of workflow `workflowId`'s chat would refuse that the request alone
 * predicts: an identifier another live chat holds ({@link ChatIdentifierInUseError}) and an auth
 * mode the caller's permission group denies. A caller that commits another write before the
 * replace (workspace source sets the public API flag first) checks this before that write, so a
 * predictable refusal leaves nothing half-applied.
 */
export async function assertChatReplaceAllowed(
  principal: Principal,
  input: { workspaceId: string; workflowId: string; identifier: string; authType: ChatAuthType }
): Promise<void> {
  const existing = await getLiveChatDeploymentForWorkflow(input.workflowId)
  if (await isChatIdentifierHeldByAnotherChat(input.identifier, existing?.id)) {
    throw new ChatIdentifierInUseError()
  }
  await assertAuthModePermitted(existing, principal, input.workspaceId, input.authType)
}

/**
 * PUT — create the workflow's chat, or replace it wholesale.
 *
 * Replace, not merge: the stored deployment ends up as exactly what the body
 * describes, so an omitted optional field takes its platform default rather than
 * whatever the previous deployment happened to carry. That is what makes the
 * verb idempotent, and it is the reason `password` is required by the contract
 * whenever the result is password-gated — a write-only field cannot be read back
 * and re-sent, so carrying one over implicitly would be the one place replace
 * quietly stopped meaning replace.
 *
 * This also deploys the workflow, because a chat serves the live version: a
 * draft that has drifted is republished as part of the call, and a call landing
 * while another deployment attempt is still preparing is a `409` rather than a
 * second admitted version.
 */
export const replaceWorkflowChatDeployment = defineAuthorizedWorkspaceUseCase({
  operation: chatDeploymentOperations.replace,
  resolveContext: ({ input }: { input: ReplaceWorkflowChatDeploymentInput }) =>
    resolveWorkflowChatDeploymentApplicationContext({ workflowId: input.workflowId }),
  authorizationOptions: { delegation: chatDeploymentDelegationPolicy },
  async execute({ principal, input, context }) {
    const existing = context.chatDeployment
    const authType = input.authType ?? 'public'

    /**
     * The pre-check that turns the common collision into a clean refusal. The
     * uncommon one — another caller claiming the identifier between here and the
     * write — is caught by {@link chatIdentifierUniquenessConflict} below and
     * answers the same conflict.
     */
    if (await isChatIdentifierHeldByAnotherChat(input.identifier, existing?.id)) {
      throw new ChatIdentifierInUseError()
    }

    await assertAuthModePermitted(existing, principal, context.workspaceId, authType)

    /**
     * Replace semantics: a mode that owns no password stores none. Resolved
     * before {@link performChatDeploy}, so its password rules apply to the value
     * actually stored rather than to an agent's `{{NAME}}` placeholder.
     */
    const password =
      authType === 'password'
        ? await resolveCopilotSecretReference(
            principal,
            context.workspaceId,
            input.password,
            'password'
          )
        : null

    const allowedEmails = input.allowedEmails ?? []
    const outputConfigs = input.outputConfigs ?? []
    const customizations = {
      primaryColor: input.customizations?.primaryColor ?? DEFAULT_PRIMARY_COLOR,
      welcomeMessage: input.customizations?.welcomeMessage ?? DEFAULT_WELCOME_MESSAGE,
      ...(input.customizations?.imageUrl ? { imageUrl: input.customizations.imageUrl } : {}),
    }

    const attribution = resolvePrincipalAttribution(principal, {
      workspaceBillingOwnerUserId: context.billedAccountUserId,
    })
    const result = await withExpectedDraft(
      principal,
      context,
      input.expectedDraftFingerprint,
      (admission) =>
        performChatDeploy({
          workflowId: context.workflowId,
          userId: attribution.attributedUserId,
          actorId: attribution.attributedUserId,
          actor: toPrincipalActor(principal),
          identifier: input.identifier,
          title: input.title,
          description: input.description ?? '',
          customizations,
          authType,
          password,
          allowedEmails,
          outputConfigs,
          includeThinking: input.includeThinking ?? false,
          includeToolCalls: input.includeToolCalls ?? false,
          workspaceId: context.workspaceId,
          requestId: input.requestId,
          projectLegacyAudit: false,
          ...admission,
        }).catch(chatIdentifierUniquenessConflict(input.identifier))
    )

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

    /**
     * Re-read the settled row so callers present what was actually stored rather
     * than what was requested — the orchestration normalizes several fields on
     * the way in.
     */
    const deployment = await getLiveChatDeploymentForWorkflow(context.workflowId)
    if (!deployment) throw new Error('Chat deployment succeeded without leaving a deployment row')

    return {
      deployment: toChatDeploymentView(deployment),
      workspaceId: context.workspaceId,
      workflowId: context.workflowId,
      created: !existing,
    }
  },
  projectAudit: ({ result }) => ({
    action: AuditAction.CHAT_DEPLOYED,
    resourceType: AuditResourceType.CHAT,
    resourceId: result.deployment.id,
    resourceName: result.deployment.title,
    description: `${result.created ? 'Deployed' : 'Replaced'} chat "${result.deployment.title}"`,
    metadata: {
      workflowId: result.workflowId,
      identifier: result.deployment.identifier,
      authType: result.deployment.authType,
      chatUrl: buildChatDeploymentUrl(result.deployment.identifier),
      isUpdate: !result.created,
    },
  }),
})

/**
 * DELETE — stop serving the workflow's chat.
 *
 * The workflow's own deployment is untouched: it stays live and executable
 * through the workflow API. That is the whole distinction between this and
 * `DELETE /api/v2/workflows/{workflowId}/deployment`.
 */
export const deleteWorkflowChatDeployment = defineAuthorizedWorkspaceUseCase({
  operation: chatDeploymentOperations.delete,
  resolveContext,
  authorizationOptions: { delegation: chatDeploymentDelegationPolicy },
  async execute({ principal, context }): Promise<WorkflowChatDeploymentResult> {
    const deployment = requireWorkflowChatDeployment(context)
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
      /**
       * Only a genuinely absent deployment is concealed. `performChatUndeploy`
       * also fails for infrastructure reasons, and rendering one of those as a
       * `404` tells the caller the chat is gone while it is still serving.
       */
      const message = result.error ?? 'Failed to delete chat deployment'
      if (result.errorCode !== 'not_found') throw new Error(message)
      throw new OrchestrationError('not_found', message)
    }
    return {
      deployment: toChatDeploymentView(deployment),
      workspaceId: context.workspaceId,
      workflowId: context.workflowId,
    }
  },
  projectAudit: ({ result }) => ({
    action: AuditAction.CHAT_DELETED,
    resourceType: AuditResourceType.CHAT,
    resourceId: result.deployment.id,
    resourceName: result.deployment.title,
    description: `Deleted chat deployment "${result.deployment.title}"`,
    metadata: {
      workflowId: result.workflowId,
      identifier: result.deployment.identifier,
      authType: result.deployment.authType,
    },
  }),
})
