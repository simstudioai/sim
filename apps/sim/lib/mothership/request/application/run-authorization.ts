import {
  delegatedChatId,
  isUserChatDelegation,
  isWorkspaceDelegation,
  type OrganizationDelegatedPrincipal,
  type Principal,
  principalWorkspaceId,
  resolvePrincipalSubjectUserId,
  type SubjectDelegatedPrincipal,
  type WorkspaceSubjectDelegation,
} from '@sim/auth/principal'
import type { OperationDeclarableCapability } from '@/lib/core/application/operation'
import { requireOrganizationSubjectMembership } from '@/lib/core/application/organization-authorization'
import { requireCurrentHumanRole } from '@/lib/core/application/workspace-authorization'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { getLatestRunForStream } from '@/lib/mothership/async-runs/repository'
import { resolveOwnedChatContext } from '@/lib/mothership/chat/application/context'
import { requireOrganizationBuildPermission } from '@/lib/mothership/chat/organization-chats'
import { isPlanModeEnabled } from '@/lib/mothership/feature-flags'
import { assertWorkspaceCapability } from '@/lib/permission-groups/capability-assertions'
import { resolveActiveWorkspaceApplicationContext } from '@/lib/workspaces/application/context'

type UserChatPrincipal = SubjectDelegatedPrincipal & {
  serviceId: 'copilot'
  invocation: { kind: 'chat'; chatId: string }
  grant: { kind: 'entity'; owner: { entityType: 'user'; entityId: string }; fileId?: undefined }
}

export type ChatCallbackPrincipal =
  | (WorkspaceSubjectDelegation & { serviceId: 'copilot' })
  | OrganizationDelegatedPrincipal
  | UserChatPrincipal

/** An invalid worker identity must not be rendered as an instruction to stop somebody's run. */
export class RunDelegationAuthorizationError extends OrchestrationError {
  constructor() {
    super('forbidden', 'Run delegation is no longer valid')
  }
}

function isChatCallbackPrincipal(principal: Principal): principal is ChatCallbackPrincipal {
  if (principal.kind === 'organization_delegated') return principal.serviceId === 'copilot'
  return (
    principal.kind === 'delegated' &&
    principal.serviceId === 'copilot' &&
    (isWorkspaceDelegation(principal) || isUserChatDelegation(principal))
  )
}

/** Verifies the authenticated assertion before reading any persisted chat or run. */
export function requireRunDelegation(
  principal: Principal,
  audience: string,
  chatId: string,
  streamId?: string
): asserts principal is ChatCallbackPrincipal {
  if (!isChatCallbackPrincipal(principal)) throw new RunDelegationAuthorizationError()
  const now = Date.now()
  const scopedChat = delegatedChatId(principal)
  if (
    principal.audience !== audience ||
    !Number.isFinite(principal.issuedAt.getTime()) ||
    !Number.isFinite(principal.expiresAt.getTime()) ||
    principal.issuedAt.getTime() > now ||
    principal.expiresAt.getTime() <= now ||
    (scopedChat !== undefined && scopedChat !== chatId) ||
    (!isWorkspaceDelegation(principal) && !scopedChat) ||
    (streamId !== undefined &&
      principal.executionStreamId !== undefined &&
      principal.executionStreamId !== streamId)
  )
    throw new RunDelegationAuthorizationError()
}

/** Original admission is compared with the caller, never with the mutable chat owner. */
function admittedRunScope(principal: ChatCallbackPrincipal): {
  workspaceId: string | null
  organizationId: string | null
} {
  if (principal.kind === 'organization_delegated')
    return { workspaceId: null, organizationId: principal.organizationId }
  if (isUserChatDelegation(principal)) return { workspaceId: null, organizationId: null }
  return { workspaceId: principalWorkspaceId(principal), organizationId: null }
}

/** Original admission is compared with the caller, never with the mutable chat owner. */
export function requireOriginalRunScope(
  principal: ChatCallbackPrincipal,
  run: { workspaceId: string | null; organizationId: string | null }
) {
  const admitted = admittedRunScope(principal)
  if (
    (run.workspaceId && run.organizationId) ||
    run.workspaceId !== admitted.workspaceId ||
    run.organizationId !== admitted.organizationId
  )
    throw new RunDelegationAuthorizationError()
}

/** Current chat eligibility and target permissions do not select or replace the execution's payer. */
export async function authorizeCurrentExecutionChat(
  principal: Principal,
  chatId: string,
  capability: OperationDeclarableCapability | 'none',
  options: { allowBlockedOwner?: boolean; mode?: 'assistant' | 'agent' | 'plan' } = {}
) {
  const context = await resolveOwnedChatContext(principal, chatId, {
    ...options,
    allowPersonal: true,
  })
  if (context.organizationId) {
    const membership = await requireOrganizationSubjectMembership(
      context.userId,
      context.organizationId,
      'member',
      capability
    )
    if (options.mode === 'agent' || options.mode === 'plan')
      await requireOrganizationBuildPermission({
        organizationId: context.organizationId,
        role: membership.role,
      })
    if (options.mode === 'plan' && !(await isPlanModeEnabled(context.userId)))
      throw new OrchestrationError('not_found', 'Plan mode is unavailable')
  } else if (context.workspaceId) {
    await requireCurrentHumanRole(context.userId, context, 'read')
    if (capability !== 'none')
      await assertWorkspaceCapability(
        context.userId,
        context.workspaceId,
        capability,
        context.workspaceOrganizationId
      )
  }
  return context
}

/** Loads exact admitted execution, then independently checks its chat's current eligibility. */
export async function authorizeOriginalRun(args: {
  principal: Principal
  chatId: string
  streamId: string
  audience: string
  capability: OperationDeclarableCapability | 'none'
  mode?: 'assistant' | 'agent' | 'plan'
}) {
  const { principal, chatId, streamId, audience, capability } = args
  requireRunDelegation(principal, audience, chatId, streamId)
  const userId = resolvePrincipalSubjectUserId(principal)
  const run = userId ? await getLatestRunForStream(streamId, userId) : null
  if (!run || run.chatId !== chatId || run.userId !== userId)
    throw new OrchestrationError('not_found', 'Stream not found')
  requireOriginalRunScope(principal, run)
  const context = await authorizeCurrentExecutionChat(principal, chatId, capability, {
    mode: args.mode,
  })
  /** A legacy workspace admission still stops when that source or its access disappears. */
  if (run.workspaceId && run.workspaceId !== context.workspaceId) {
    const source = await resolveActiveWorkspaceApplicationContext(run.workspaceId)
    await requireCurrentHumanRole(context.userId, source, 'read')
  }
  requireRunDelegation(principal, audience, chatId, streamId)
  return { context, run }
}

function narrowDelegatedChat(principal: ChatCallbackPrincipal, chatId: string): Principal {
  if (principal.kind === 'organization_delegated' || isUserChatDelegation(principal)) {
    if (delegatedChatId(principal) !== chatId) throw new RunDelegationAuthorizationError()
    return principal
  }
  if (principal.invocation.kind === 'chat') {
    if (principal.invocation.chatId !== chatId || principal.grant.restrictions?.chatId !== chatId)
      throw new RunDelegationAuthorizationError()
    return principal
  }
  if (principal.invocation.workspaceId !== principal.grant.owner.entityId)
    throw new RunDelegationAuthorizationError()
  return {
    ...principal,
    invocation: { kind: 'chat', chatId },
    grant: {
      ...principal.grant,
      restrictions: { ...principal.grant.restrictions, chatId },
    },
  }
}

/**
 * Keeps the admitted principal. A workspace grant whose invocation is only the workspace
 * is narrowed to the chat this operation addresses.
 */
export async function bindCurrentChatCallback(
  principal: Principal,
  audience: string,
  capability: OperationDeclarableCapability | 'none'
): Promise<Principal> {
  if (principal.kind !== 'delegated' && principal.kind !== 'organization_delegated')
    return principal
  if (principal.executionStreamId === undefined) return principal
  const chatId = delegatedChatId(principal)
  if (!chatId) throw new RunDelegationAuthorizationError()
  await authorizeOriginalRun({
    principal,
    audience,
    capability,
    chatId,
    streamId: principal.executionStreamId,
  })
  requireRunDelegation(principal, audience, chatId, principal.executionStreamId)
  return narrowDelegatedChat(principal, chatId)
}

/** Current target access may narrow an admitted turn; it cannot give it a different scope. */
export async function requireAdmittedWorkspaceTarget(
  principal: Principal | undefined,
  workspaceId: string
) {
  if (!principal || !('executionStreamId' in principal) || !principal.executionStreamId) return
  const target = await resolveActiveWorkspaceApplicationContext(workspaceId)
  if (principal.kind === 'organization_delegated') {
    if (principal.organizationId !== target.workspaceOrganizationId)
      throw new OrchestrationError('not_found', 'Workspace not found in the admitted execution')
    return
  }
  if (isWorkspaceDelegation(principal)) {
    if (principalWorkspaceId(principal) !== target.workspaceId)
      throw new OrchestrationError('not_found', 'Workspace not found in the admitted execution')
    return
  }
  if (isUserChatDelegation(principal) && target.workspaceOrganizationId !== null)
    throw new OrchestrationError('not_found', 'Workspace not found in the admitted execution')
}
