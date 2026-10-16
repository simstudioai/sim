import {
  type DelegatedPrincipal,
  type OrganizationDelegatedPrincipal,
  type PersonalChatDelegatedPrincipal,
  type Principal,
  resolvePrincipalSubjectUserId,
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

export type ChatCallbackPrincipal =
  | DelegatedPrincipal
  | OrganizationDelegatedPrincipal
  | PersonalChatDelegatedPrincipal

/** An invalid worker identity must not be rendered as an instruction to stop somebody's run. */
export class RunDelegationAuthorizationError extends OrchestrationError {
  constructor() {
    super('forbidden', 'Run delegation is no longer valid')
  }
}

/** Verifies the authenticated assertion before reading any persisted chat or run. */
export function requireRunDelegation(
  principal: Principal,
  audience: string,
  chatId: string,
  streamId?: string
): asserts principal is ChatCallbackPrincipal {
  if (
    principal.kind !== 'delegated' &&
    principal.kind !== 'organization_delegated' &&
    principal.kind !== 'personal_chat_delegated'
  )
    throw new RunDelegationAuthorizationError()
  const now = Date.now()
  const scopedChat =
    principal.resourceScope && 'chatId' in principal.resourceScope
      ? principal.resourceScope.chatId
      : undefined
  if (
    principal.serviceId !== 'copilot' ||
    principal.audience !== audience ||
    !Number.isFinite(principal.issuedAt.getTime()) ||
    !Number.isFinite(principal.expiresAt.getTime()) ||
    principal.issuedAt.getTime() > now ||
    principal.expiresAt.getTime() <= now ||
    (scopedChat !== undefined && scopedChat !== chatId) ||
    (principal.kind !== 'delegated' && !scopedChat) ||
    (streamId !== undefined &&
      principal.executionStreamId !== undefined &&
      principal.executionStreamId !== streamId)
  )
    throw new RunDelegationAuthorizationError()
}

/** Original admission is compared with the caller, never with the mutable chat owner. */
function requireOriginalRunScope(
  principal: ChatCallbackPrincipal,
  run: { workspaceId: string | null; organizationId: string | null }
) {
  const workspaceId = principal.kind === 'delegated' ? principal.workspaceId : null
  const organizationId =
    principal.kind === 'organization_delegated' ? principal.organizationId : null
  if (
    (run.workspaceId && run.organizationId) ||
    run.workspaceId !== workspaceId ||
    run.organizationId !== organizationId
  )
    throw new RunDelegationAuthorizationError()
}

/** Current chat eligibility and target permissions do not select or replace the execution's payer. */
async function authorizeCurrentExecutionChat(
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

/** Converts verified original admission into current chat authority for this one operation only. */
export async function bindCurrentChatCallback(
  principal: Principal,
  audience: string,
  capability: OperationDeclarableCapability | 'none'
): Promise<Principal> {
  if (
    principal.kind !== 'delegated' &&
    principal.kind !== 'organization_delegated' &&
    principal.kind !== 'personal_chat_delegated'
  )
    return principal
  if (principal.executionStreamId === undefined) return principal
  const chatId =
    principal.resourceScope && 'chatId' in principal.resourceScope
      ? principal.resourceScope.chatId
      : undefined
  if (!chatId) throw new RunDelegationAuthorizationError()
  const { context } = await authorizeOriginalRun({
    principal,
    audience,
    capability,
    chatId,
    streamId: principal.executionStreamId,
  })
  const identity = {
    serviceId: 'copilot' as const,
    subjectUserId: context.userId,
    delegationId: principal.delegationId,
    audience: principal.audience,
    issuedAt: principal.issuedAt,
    expiresAt: principal.expiresAt,
    resourceScope: { chatId },
  }
  if (context.organizationId)
    return { ...identity, kind: 'organization_delegated', organizationId: context.organizationId }
  if (context.workspaceId)
    return { ...identity, kind: 'delegated', workspaceId: context.workspaceId }
  return { ...identity, kind: 'personal_chat_delegated' }
}
