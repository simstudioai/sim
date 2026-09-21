import { AuditAction, AuditResourceType } from '@sim/audit'
import { db } from '@sim/db'
import { user } from '@sim/db/schema'
import { eq } from 'drizzle-orm'
import {
  defineAuthorizedOrganizationUseCase,
  type OrganizationUseCaseContext,
} from '@/lib/core/application/authorized-organization-use-case'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import {
  createOrganizationInvitation as createOrganizationInvitationRecord,
  prepareOrganizationInvitationContext,
} from '@/lib/invitations/organization-invitations'
import { organizationOperations } from '@/lib/organizations/application/operations'

export interface CreateOrganizationInvitationInput {
  organizationId: string
  email: string
  role: 'member' | 'admin'
}

async function creationContext({
  input,
  context,
}: OrganizationUseCaseContext<CreateOrganizationInvitationInput>) {
  const [inviter] = await db
    .select({ name: user.name, email: user.email })
    .from(user)
    .where(eq(user.id, context.userId))
    .limit(1)
  if (!inviter) throw new OrchestrationError('not_found', 'Authenticated user not found')
  return prepareOrganizationInvitationContext({
    organizationId: input.organizationId,
    inviterId: context.userId,
    inviterName: inviter.name || inviter.email || 'A user',
    inviterEmail: inviter.email,
  })
}

export const createOrganizationInvitation = defineAuthorizedOrganizationUseCase({
  operation: organizationOperations.createInvitation,
  async execute(args: OrganizationUseCaseContext<CreateOrganizationInvitationInput>) {
    const context = await creationContext(args)
    return createOrganizationInvitationRecord({
      context,
      email: args.input.email,
      role: args.input.role,
    })
  },
  projectAudit: ({ input, result }) => ({
    action: AuditAction.MEMBER_INVITED,
    resourceType: AuditResourceType.ORGANIZATION,
    resourceId: input.organizationId,
    resourceName: result.email,
    description: `Invited ${result.email} as an organization ${input.role}`,
    metadata: { invitationId: result.id, targetEmail: result.email, organizationRole: input.role },
  }),
})
