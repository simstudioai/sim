import { db } from '@sim/db'
import { user } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { normalizeEmail } from '@sim/utils/string'
import { eq } from 'drizzle-orm'
import {
  assertOperationPrincipal,
  defineOperation,
  ForbiddenOperationError,
  type OperationUseCase,
} from '@/lib/core/application'
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
import { InvitationsNotAllowedError } from '@/ee/access-control/utils/permission-check'

const logger = createLogger('InvitationBatch')

export const invitationOperations = {
  sendBatch: defineOperation({
    id: 'invitations.send_batch',
    capability: 'invitations.send',
    principalKinds: ['session'],
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
    assertOperationPrincipal(principal, invitationOperations.sendBatch)
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
      .where(eq(user.id, principal.userId))
      .limit(1)
    if (!inviter)
      throw new WorkspaceInvitationError({ message: 'Authenticated user not found.', status: 401 })
    const identity = {
      inviterId: principal.userId,
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
  },
}
