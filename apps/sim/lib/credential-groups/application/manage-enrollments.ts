import { AuditAction, AuditResourceType } from '@sim/audit'
import { defineAuthorizedWorkspaceUseCase } from '@/lib/core/application'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import {
  requireCredentialGroupSettingsAvailable,
  resolveCredentialGroupSettingsContext,
} from '@/lib/credential-groups/application/context'
import { credentialGroupOperations } from '@/lib/credential-groups/application/operations'
import { validateCredentialGroupInvitationEmails } from '@/lib/credential-groups/application/validation'
import {
  CredentialGroupEnrollmentError,
  deleteCredentialGroupEnrollment,
  inviteCredentialGroupEnrollments,
  loadCredentialGroupInviterIdentity,
  resendCredentialGroupEnrollment,
} from '@/lib/credential-groups/enrollments'
import { mcpService } from '@/lib/mcp/service'

interface CredentialGroupEnrollmentSettingsInput {
  assertedWorkspaceId: string
  credentialGroupId: string
}

function normalizeEnrollmentError(error: unknown): never {
  if (error instanceof CredentialGroupEnrollmentError) {
    if (error.status === 404) throw new OrchestrationError('not_found', error.message)
    if (error.status === 409) throw new OrchestrationError('conflict', error.message)
  }
  throw error
}

async function requireInviterIdentity(userId: string): Promise<string> {
  const inviter = await loadCredentialGroupInviterIdentity(userId)
  const inviterName = inviter?.name?.trim() || inviter?.email
  if (!inviterName) {
    throw new OrchestrationError('conflict', 'Inviting user has no display identity')
  }
  return inviterName
}

export interface InviteCredentialGroupEnrollmentsSettingsInput
  extends CredentialGroupEnrollmentSettingsInput {
  emails: string[]
}

export const inviteCredentialGroupEnrollmentsSettings = defineAuthorizedWorkspaceUseCase({
  operation: credentialGroupOperations.inviteBatch,
  resolveContext: ({ input }: { input: InviteCredentialGroupEnrollmentsSettingsInput }) =>
    resolveCredentialGroupSettingsContext(input.credentialGroupId, input.assertedWorkspaceId),
  authorizationOptions: {},
  async execute({ principal, input, context }) {
    await requireCredentialGroupSettingsAvailable(context.workspaceId)
    const inviterName = await requireInviterIdentity(principal.userId)
    const emails = validateCredentialGroupInvitationEmails(input.emails)
    try {
      return await inviteCredentialGroupEnrollments(
        context.workspaceId,
        context.credentialGroupId,
        principal.userId,
        inviterName,
        { emails }
      )
    } catch (error) {
      normalizeEnrollmentError(error)
    }
  },
  projectAudit: ({ context, result }) => ({
    action: AuditAction.CREDENTIAL_GROUP_UPDATED,
    resourceType: AuditResourceType.CREDENTIAL_GROUP,
    resourceId: context.credentialGroupId,
    resourceName: context.name,
    description: `Sent ${result.sentCount} Credential Group invitation${result.sentCount === 1 ? '' : 's'}`,
    metadata: { sentCount: result.sentCount, failedCount: result.failedCount },
  }),
})

export interface ResendCredentialGroupEnrollmentSettingsInput
  extends CredentialGroupEnrollmentSettingsInput {
  enrollmentId: string
}

export const resendCredentialGroupEnrollmentSettings = defineAuthorizedWorkspaceUseCase({
  operation: credentialGroupOperations.resendEnrollment,
  resolveContext: ({ input }: { input: ResendCredentialGroupEnrollmentSettingsInput }) =>
    resolveCredentialGroupSettingsContext(input.credentialGroupId, input.assertedWorkspaceId),
  authorizationOptions: {},
  async execute({ principal, input, context }) {
    await requireCredentialGroupSettingsAvailable(context.workspaceId)
    const inviterName = await requireInviterIdentity(principal.userId)
    try {
      const credentialGroupEnrollment = await resendCredentialGroupEnrollment(
        context.workspaceId,
        context.credentialGroupId,
        input.enrollmentId,
        principal.userId,
        inviterName
      )
      return { credentialGroupEnrollment }
    } catch (error) {
      normalizeEnrollmentError(error)
    }
  },
  projectAudit: ({ context, result }) => ({
    action: AuditAction.CREDENTIAL_GROUP_UPDATED,
    resourceType: AuditResourceType.CREDENTIAL_GROUP,
    resourceId: context.credentialGroupId,
    resourceName: context.name,
    description: `Resent a Credential Group invitation to ${result.credentialGroupEnrollment.email}`,
    metadata: { enrollmentId: result.credentialGroupEnrollment.id },
  }),
})

export interface DeleteCredentialGroupEnrollmentSettingsInput
  extends CredentialGroupEnrollmentSettingsInput {
  enrollmentId: string
}

export const deleteCredentialGroupEnrollmentSettings = defineAuthorizedWorkspaceUseCase({
  operation: credentialGroupOperations.deleteEnrollment,
  resolveContext: ({ input }: { input: DeleteCredentialGroupEnrollmentSettingsInput }) =>
    resolveCredentialGroupSettingsContext(input.credentialGroupId, input.assertedWorkspaceId),
  authorizationOptions: {},
  async execute({ input, context }) {
    await requireCredentialGroupSettingsAvailable(context.workspaceId)
    try {
      return await deleteCredentialGroupEnrollment(
        context.workspaceId,
        context.credentialGroupId,
        input.enrollmentId
      )
    } catch (error) {
      normalizeEnrollmentError(error)
    }
  },
  projectAudit: ({ context, result }) => ({
    action: AuditAction.CREDENTIAL_GROUP_UPDATED,
    resourceType: AuditResourceType.CREDENTIAL_GROUP,
    resourceId: context.credentialGroupId,
    resourceName: context.name,
    description: `Deleted ${result.credentialGroupEnrollment.email} from the Credential Group`,
    metadata: { enrollmentId: result.credentialGroupEnrollment.id },
  }),
  afterSuccess: ({ result }) =>
    Promise.all(
      result.retiredMcpConnectionIds.map((connectionId) =>
        mcpService.evictServerConnections(connectionId, 'credential_group_enrollment_deleted')
      )
    ).then(() => undefined),
})
