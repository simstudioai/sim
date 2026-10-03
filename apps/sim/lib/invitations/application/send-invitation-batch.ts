import {
  isUserCredentialPrincipal,
  type Principal,
  requirePrincipalSubjectUserId,
  toPrincipalActor,
} from '@sim/auth/principal'
import { db } from '@sim/db'
import { user } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { normalizeEmail } from '@sim/utils/string'
import { eq } from 'drizzle-orm'
import {
  assertOperationPrincipal,
  defineAuthorizedWorkspaceUseCase,
  ForbiddenOperationError,
  type OperationUseCase,
} from '@/lib/core/application'
import { authorizeOrganizationOperation } from '@/lib/core/application/organization-authorization'
import { defineOrganizationOperation } from '@/lib/core/application/organization-operation'
import {
  authorizeWorkspaceOperation,
  requireAllowedWorkspacePrincipal,
} from '@/lib/core/application/workspace-authorization'
import { defineWorkspaceOperation } from '@/lib/core/application/workspace-operation'
import {
  OrchestrationError,
  type OrchestrationRequestContext,
} from '@/lib/core/orchestration/types'
import {
  invitationAuthorityOperations,
  invitationOperations,
} from '@/lib/invitations/application/operations'
import { MAX_INVITE_EMAILS, MAX_INVITE_WORKSPACES } from '@/lib/invitations/limits'
import { prepareOrganizationInvitationContext } from '@/lib/invitations/organization-invitations'
import {
  createWorkspaceInvitation,
  type InvitationMembership,
  prepareWorkspaceInvitationContext,
  WorkspaceInvitationError,
  type WorkspaceInvitationResult,
} from '@/lib/invitations/workspace-invitations'
import { createOrganizationInvitation } from '@/lib/organizations/application/invitations'
import { assertWorkspaceCapability } from '@/lib/permission-groups/capability-assertions'
import { resolveActiveWorkspaceApplicationContext } from '@/lib/workspaces/application/workspace-context'
import { getWorkspaceInvitePolicy } from '@/lib/workspaces/policy'
import { InvitationsNotAllowedError } from '@/ee/access-control/utils/permission-check'

const logger = createLogger('InvitationBatch')

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
    requireAllowedWorkspacePrincipal(principal, invitationAuthorityOperations.workspace)
    assertOperationPrincipal(principal, invitationOperations.sendBatch)
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
  const authorizeCredential = async () => {
    if (!isUserCredentialPrincipal(principal)) return
    if (organizationOnly && input.organizationId) {
      await authorizeOrganizationOperation(
        principal,
        invitationAuthorityOperations.organization,
        {
          organizationId: input.organizationId,
        },
        { executor: db }
      )
    }
    for (const workspaceId of new Set(input.workspaceIds)) {
      const context = await resolveActiveWorkspaceApplicationContext(workspaceId)
      await authorizeWorkspaceOperation(
        principal,
        invitationAuthorityOperations.workspace,
        context,
        { executor: db }
      )
      await assertWorkspaceCapability(
        actorId,
        workspaceId,
        'invitations.send',
        context.workspaceOrganizationId,
        db
      )
    }
  }
  await authorizeCredential()
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
    ...(principal.kind !== 'session'
      ? {
          auditActor: {
            id: actorId,
            name: inviter.name || inviter.email || 'A user',
            email: inviter.email,
            metadata: {
              actor: toPrincipalActor(principal),
              operation: invitationOperations.sendBatch.id,
            },
          },
        }
      : {}),
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
    : await prepareWorkspaceInvitationContext({
        ...identity,
        workspaceIds: input.workspaceIds,
      }).catch((error: unknown) => {
        if (isUserCredentialPrincipal(principal) && error instanceof WorkspaceInvitationError) {
          if (error.status === 403) {
            throw new ForbiddenOperationError(
              error.upgradeRequired ? 'ORGANIZATION_PLAN_REQUIRED' : 'INSUFFICIENT_WORKSPACE_ROLE',
              error.message
            )
          }
          if (error.status === 404) throw new OrchestrationError('not_found', 'Workspace not found')
        }
        throw error
      })
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
      await authorizeCredential()
      const invitation = organizationContext
        ? await createOrganizationInvitation.execute({
            principal,
            input: {
              organizationId: organizationContext.organizationId,
              email,
              role: input.membership === 'admin' ? 'admin' : 'member',
            },
            request,
          })
        : workspaceContext
          ? await createWorkspaceInvitation({
              context: workspaceContext,
              email,
              permission: input.permission,
              membership: input.membership,
              request,
              validateLockedWorkspace: isUserCredentialPrincipal(principal)
                ? async (tx, workspace) => {
                    if (workspace.organizationId !== workspaceContext.organizationId) {
                      throw new WorkspaceInvitationError({
                        message:
                          'A selected workspace changed organizations. Review the selection and try again.',
                        status: 409,
                      })
                    }
                    await authorizeWorkspaceOperation(
                      principal,
                      invitationAuthorityOperations.workspace,
                      {
                        workspaceId: workspace.id,
                        workspaceOrganizationId: workspace.organizationId,
                        allowPersonalApiKeys: workspace.allowPersonalApiKeys,
                      },
                      { executor: tx, forUpdate: true }
                    )
                    await assertWorkspaceCapability(
                      actorId,
                      workspace.id,
                      'invitations.send',
                      workspace.organizationId,
                      tx
                    )
                    const policy = await getWorkspaceInvitePolicy(workspace, tx)
                    if (!policy.allowed) {
                      throw new WorkspaceInvitationError({
                        message: policy.reason ?? 'Invites are disabled for this workspace.',
                        status: 403,
                        upgradeRequired: policy.upgradeRequired,
                      })
                    }
                    return policy
                  }
                : undefined,
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
          error:
            isUserCredentialPrincipal(principal) &&
            error instanceof WorkspaceInvitationError &&
            error.status >= 500
              ? 'Unable to confirm invitation delivery. Check workspace members and invitations before retrying.'
              : error.message,
        })
      } else {
        logger.error('Invitation batch item failed', { email: normalizedEmail, error })
        result.failed.push({
          email: normalizedEmail,
          error: isUserCredentialPrincipal(principal)
            ? 'Unable to confirm the invitation outcome. Check workspace members and invitations before retrying.'
            : 'Failed to create invitation. Please try again.',
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

const organizationInvitationSendOperation = defineOrganizationOperation({
  id: 'organization_invitations.send_batch',
  minimumRole: 'admin',
  capability: 'invitations.send',
  principalKinds: ['session', 'organization_delegated'],
  delegationAudience: 'sim:settings',
  delegatedServices: ['copilot'],
})

/** Organization delegation can invite members, but cannot grant workspace access. */
export const sendOrganizationInvitationBatch: OperationUseCase<
  typeof organizationInvitationSendOperation,
  SendInvitationBatchInput,
  SendInvitationBatchResult
> = {
  operation: organizationInvitationSendOperation,
  async execute({ principal, input, request }) {
    if (!input.organizationId || input.workspaceIds.length !== 0)
      throw new OrchestrationError(
        'forbidden',
        'Organization invitation delegation cannot grant workspace access'
      )
    await authorizeOrganizationOperation(principal, organizationInvitationSendOperation, {
      organizationId: input.organizationId,
    })
    return executeInvitationBatch(principal, input, request)
  },
}
