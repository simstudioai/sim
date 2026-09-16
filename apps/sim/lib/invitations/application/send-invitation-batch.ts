import { type Principal, requirePrincipalSubjectUserId } from '@sim/auth/principal'
import { db } from '@sim/db'
import { user } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { normalizeEmail } from '@sim/utils/string'
import { eq } from 'drizzle-orm'
import {
  defineAuthorizedWorkspaceUseCase,
  ForbiddenOperationError,
  type OperationUseCase,
} from '@/lib/core/application'
import { authorizeOrganizationOperation } from '@/lib/core/application/organization-authorization'
import { defineOrganizationOperation } from '@/lib/core/application/organization-operation'
import { defineWorkspaceOperation } from '@/lib/core/application/workspace-operation'
import {
  OrchestrationError,
  type OrchestrationRequestContext,
} from '@/lib/core/orchestration/types'
import { MAX_INVITE_EMAILS, MAX_INVITE_WORKSPACES } from '@/lib/invitations/limits'
import {
  createOrganizationInvitation,
  prepareOrganizationInvitationContext,
} from '@/lib/invitations/organization-invitations'
import {
  createWorkspaceInvitation,
  type InvitationMembership,
  prepareWorkspaceInvitationContext,
  WorkspaceInvitationError,
  type WorkspaceInvitationResult,
} from '@/lib/invitations/workspace-invitations'
import { resolveActiveWorkspaceApplicationContext } from '@/lib/workspaces/application/workspace-context'
import { InvitationsNotAllowedError } from '@/ee/access-control/utils/permission-check'

const logger = createLogger('InvitationBatch')

export const invitationOperations = {
  sendBatch: defineOrganizationOperation({
    id: 'invitations.send_batch',
    capability: 'invitations.send',
    principalKinds: ['session', 'organization_delegated'],
    minimumRole: 'admin',
    delegationAudience: 'sim:settings',
    delegatedServices: ['copilot'],
  }),
} as const

export interface SendInvitationBatchInput {
  workspaceIds: string[]
  organizationId?: string
  emails: string[]
  permission?: 'admin' | 'write' | 'read'
  membership?: InvitationMembership
}

interface SendInvitationBatchResult {
  success: boolean
  successful: string[]
  added: string[]
  failed: { email: string; error: string }[]
  invitations: WorkspaceInvitationResult[]
}

/**
 * A bounded sequential batch with per-email outcomes. Each item owns its
 * transaction, delivery compensation and audit, so later failures preserve
 * invitations already delivered. Organization-only sends require org admin;
 * workspace sends retain authorization on every canonical target workspace.
 */
export const sendInvitationBatch: OperationUseCase<
  typeof invitationOperations.sendBatch,
  SendInvitationBatchInput,
  SendInvitationBatchResult
> = {
  operation: invitationOperations.sendBatch,
  async execute({ principal, input, request }) {
    if (principal.kind !== 'session' && principal.kind !== 'organization_delegated')
      throw new Error(
        `Operation ${invitationOperations.sendBatch.id} reached by principal kind ${principal.kind}, which its policy does not name`
      )
    if (principal.kind === 'organization_delegated') {
      if (!input.organizationId || input.workspaceIds.length !== 0)
        throw new OrchestrationError(
          'forbidden',
          'Organization invitation delegation cannot grant workspace access'
        )
      await authorizeOrganizationOperation(principal, invitationOperations.sendBatch, {
        organizationId: input.organizationId,
      })
    }
    if (input.workspaceIds.length > 0) {
      return sendWorkspaceInvitationBatch.execute({ principal, input, request })
    }
    return executeInvitationBatch(principal, input, request)
  },
}

async function executeInvitationBatch(
  principal: Principal,
  input: SendInvitationBatchInput,
  request?: OrchestrationRequestContext
): Promise<SendInvitationBatchResult> {
  const actorId = requirePrincipalSubjectUserId(principal)
  if (
    input.emails.length === 0 ||
    input.emails.length > MAX_INVITE_EMAILS ||
    input.workspaceIds.length > MAX_INVITE_WORKSPACES
  ) {
    throw new WorkspaceInvitationError({ message: 'Invalid invitation batch size.', status: 400 })
  }
  const organizationOnly = input.workspaceIds.length === 0
  if (organizationOnly && (!input.organizationId || input.membership === 'external')) {
    throw new WorkspaceInvitationError({
      message: 'An organization member invitation requires an organization.',
      status: 400,
    })
  }
  const [inviter] = await db
    .select({ name: user.name, email: user.email })
    .from(user)
    .where(eq(user.id, actorId))
    .limit(1)
  if (!inviter)
    throw new WorkspaceInvitationError({ message: 'Authenticated user not found.', status: 401 })
  const identity = {
    inviterId: actorId,
    inviterName: inviter.name || inviter.email || 'A user',
    inviterEmail: inviter.email,
  }
  const organizationContext =
    organizationOnly && input.organizationId
      ? await prepareOrganizationInvitationContext({
          ...identity,
          organizationId: input.organizationId,
        })
      : null
  const workspaceContext = organizationOnly
    ? null
    : await prepareWorkspaceInvitationContext({ ...identity, workspaceIds: input.workspaceIds })
  if (
    workspaceContext &&
    input.organizationId &&
    workspaceContext.organizationId !== input.organizationId
  ) {
    throw new WorkspaceInvitationError({
      message: 'Selected workspaces do not belong to this organization.',
      status: 400,
    })
  }
  const result: SendInvitationBatchResult = {
    success: true,
    successful: [],
    added: [],
    failed: [],
    invitations: [],
  }
  const seenEmails = new Set<string>()
  for (const email of input.emails) {
    const normalizedEmail = normalizeEmail(email)
    if (seenEmails.has(normalizedEmail)) {
      result.failed.push({
        email: normalizedEmail,
        error: `${normalizedEmail} appears more than once in this invitation batch`,
      })
      continue
    }
    seenEmails.add(normalizedEmail)
    try {
      const invitation = organizationContext
        ? await createOrganizationInvitation({
            context: organizationContext,
            email,
            role: input.membership === 'admin' ? 'admin' : 'member',
            request,
          })
        : workspaceContext
          ? await createWorkspaceInvitation({
              context: workspaceContext,
              email,
              permission: input.permission,
              membership: input.membership,
              request,
            })
          : null
      if (!invitation) throw new Error('Invitation batch has no authorized context')
      if (invitation.instantAdd) {
        if (invitation.outcome === 'added') result.added.push(invitation.email)
      } else {
        result.successful.push(invitation.email)
      }
      result.invitations.push(invitation)
    } catch (error) {
      if (
        error instanceof WorkspaceInvitationError ||
        error instanceof InvitationsNotAllowedError ||
        error instanceof ForbiddenOperationError
      ) {
        result.failed.push({
          email:
            error instanceof WorkspaceInvitationError
              ? (error.email ?? normalizedEmail)
              : normalizedEmail,
          error: error.message,
        })
      } else {
        logger.error('Invitation batch item failed', { email: normalizedEmail, error })
        result.failed.push({
          email: normalizedEmail,
          error: 'Failed to create invitation. Please try again.',
        })
      }
    }
  }
  result.success = result.failed.length === 0
  return result
}

export const workspaceInvitationSendOperation = defineWorkspaceOperation({
  id: 'workspace_invitations.send_batch',
  minimumRole: 'admin',
  capability: 'invitations.send',
  workspaceApiKey: 'deny',
  principalKinds: ['session', 'delegated'],
  delegatedServices: ['copilot'],
})

/** Workspace batches retain per-target admission checks and per-email outcomes. */
export const sendWorkspaceInvitationBatch = defineAuthorizedWorkspaceUseCase({
  operation: workspaceInvitationSendOperation,
  resolveContext: ({
    principal,
    input,
  }: {
    principal: Principal
    input: SendInvitationBatchInput
  }) => {
    if (input.workspaceIds.length === 0 || input.workspaceIds.length > MAX_INVITE_WORKSPACES)
      throw new WorkspaceInvitationError({ message: 'Invalid invitation batch size.', status: 400 })
    if (
      principal.kind === 'delegated' &&
      input.workspaceIds.some((id) => id !== principal.workspaceId)
    )
      throw new OrchestrationError(
        'forbidden',
        'Workspace invitation targets must stay within the delegated workspace'
      )
    return resolveActiveWorkspaceApplicationContext(input.workspaceIds[0])
  },
  authorizationOptions: { delegation: { audience: 'sim:settings', isWithinScope: () => true } },
  execute: ({ principal, input, request }) => executeInvitationBatch(principal, input, request),
})
