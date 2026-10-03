import { organizationRoleSchema } from '@/lib/api/contracts/primitives'
import { v2OrganizationInvitationSchema } from '@/lib/api/contracts/v2/organizations'

export function presentOrganization(organization: {
  id: string
  name: string
  slug: string
  logo: string | null
  createdAt: Date
  role: string
}) {
  return {
    id: organization.id,
    name: organization.name,
    slug: organization.slug,
    logo: organization.logo,
    role: organizationRoleSchema.parse(organization.role),
    createdAt: organization.createdAt.toISOString(),
  }
}

export function presentOrganizationMember(member: {
  userId: string
  userName: string
  userEmail: string
  role: string
  createdAt: Date
}) {
  return {
    userId: member.userId,
    name: member.userName,
    email: member.userEmail,
    role: organizationRoleSchema.parse(member.role),
    joinedAt: member.createdAt.toISOString(),
  }
}

export function presentOrganizationInvitation(invitation: {
  id: string
  organizationId: string | null
  email: string
  role: string
  kind: string
  membershipIntent: string
  status: string
  createdAt: Date
  expiresAt: Date
}) {
  return v2OrganizationInvitationSchema.parse({
    id: invitation.id,
    organizationId: invitation.organizationId,
    email: invitation.email,
    role: invitation.role,
    kind: invitation.kind,
    membershipIntent: invitation.membershipIntent,
    status: invitation.status,
    createdAt: invitation.createdAt.toISOString(),
    expiresAt: invitation.expiresAt.toISOString(),
  })
}
