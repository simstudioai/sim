import { z } from 'zod'
import { defineRouteContract } from '@/lib/api/contracts/types'

export const credentialSetSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  providerId: z.string().nullable(),
  createdBy: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
  creatorName: z.string().nullable(),
  creatorEmail: z.string().nullable(),
  memberCount: z.number(),
})

export const credentialSetWriteSchema = z.object({
  id: z.string(),
  organizationId: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  providerId: z.string().nullable(),
  createdBy: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
})

export const credentialSetMembershipSchema = z.object({
  membershipId: z.string(),
  status: z.string(),
  joinedAt: z.string().nullable(),
  credentialSetId: z.string(),
  credentialSetName: z.string(),
  credentialSetDescription: z.string().nullable(),
  providerId: z.string().nullable(),
  organizationId: z.string(),
  organizationName: z.string(),
})

export const credentialSetInvitationSchema = z.object({
  invitationId: z.string(),
  token: z.string(),
  status: z.string(),
  expiresAt: z.string(),
  createdAt: z.string(),
  credentialSetId: z.string(),
  credentialSetName: z.string(),
  providerId: z.string().nullable(),
  organizationId: z.string(),
  organizationName: z.string(),
  invitedByName: z.string().nullable(),
  invitedByEmail: z.string().nullable(),
})

export const credentialSetInvitationDetailSchema = z.object({
  id: z.string(),
  credentialSetId: z.string(),
  email: z.string().nullable(),
  token: z.string(),
  status: z.string(),
  expiresAt: z.string(),
  createdAt: z.string(),
  invitedBy: z.string(),
})

export const credentialSetInvitePreviewSchema = z.object({
  credentialSetName: z.string(),
  organizationName: z.string(),
  providerId: z.string().nullable(),
  email: z.string().nullable(),
})

export const credentialSetMemberSchema = z.object({
  id: z.string(),
  userId: z.string(),
  status: z.string(),
  joinedAt: z.string().nullable(),
  createdAt: z.string(),
  userName: z.string().nullable(),
  userEmail: z.string().nullable(),
  userImage: z.string().nullable(),
  credentials: z.array(
    z.object({
      providerId: z.string(),
      accountId: z.string(),
    })
  ),
})

export type CredentialSet = z.output<typeof credentialSetSchema>
export type CredentialSetMembership = z.output<typeof credentialSetMembershipSchema>
export type CredentialSetInvitation = z.output<typeof credentialSetInvitationSchema>
export type CredentialSetMember = z.output<typeof credentialSetMemberSchema>
export type CredentialSetInvitationDetail = z.output<typeof credentialSetInvitationDetailSchema>
export type CredentialSetInvitePreview = z.output<typeof credentialSetInvitePreviewSchema>

export const listCredentialSetsQuerySchema = z.object({
  organizationId: z.string().min(1),
})

export const createCredentialSetBodySchema = z.object({
  organizationId: z.string().min(1),
  name: z.string().trim().min(1).max(100),
  description: z.string().max(500).optional(),
  providerId: z.enum(['google-email', 'outlook']),
})

export type CreateCredentialSetData = z.input<typeof createCredentialSetBodySchema>

export const credentialSetIdParamsSchema = z.object({
  id: z.string().min(1),
})

export const credentialSetInviteTokenParamsSchema = z.object({
  token: z.string().min(1),
})

export const credentialSetInvitationParamsSchema = z.object({
  id: z.string().min(1),
  invitationId: z.string().min(1),
})

export const createCredentialSetInvitationBodySchema = z.object({
  email: z.string().email().optional(),
})

export const removeCredentialSetMemberQuerySchema = z.object({
  memberId: z.string().min(1),
})

export const leaveCredentialSetQuerySchema = z.object({
  credentialSetId: z.string().min(1),
})

export const cancelCredentialSetInvitationQuerySchema = z.object({
  invitationId: z.string().min(1),
})

export const updateCredentialSetBodySchema = z.object({
  name: z.string().trim().min(1).max(100).optional(),
  description: z.string().max(500).nullable().optional(),
})

const successResponseSchema = z.object({
  success: z.literal(true),
})

export const listCredentialSetsContract = defineRouteContract({
  method: 'GET',
  path: '/api/credential-sets',
  query: listCredentialSetsQuerySchema,
  response: {
    mode: 'json',
    schema: z.object({
      credentialSets: z.array(credentialSetSchema).optional(),
    }),
  },
})

export const createCredentialSetContract = defineRouteContract({
  method: 'POST',
  path: '/api/credential-sets',
  body: createCredentialSetBodySchema,
  response: {
    mode: 'json',
    schema: z.object({
      credentialSet: credentialSetSchema,
    }),
  },
})

export const getCredentialSetContract = defineRouteContract({
  method: 'GET',
  path: '/api/credential-sets/[id]',
  params: credentialSetIdParamsSchema,
  response: {
    mode: 'json',
    schema: z.object({
      credentialSet: credentialSetSchema.optional(),
    }),
  },
})

export const deleteCredentialSetContract = defineRouteContract({
  method: 'DELETE',
  path: '/api/credential-sets/[id]',
  params: credentialSetIdParamsSchema,
  response: {
    mode: 'json',
    schema: successResponseSchema,
  },
})

export const updateCredentialSetContract = defineRouteContract({
  method: 'PUT',
  path: '/api/credential-sets/[id]',
  params: credentialSetIdParamsSchema,
  body: updateCredentialSetBodySchema,
  response: {
    mode: 'json',
    schema: z.object({
      credentialSet: credentialSetWriteSchema.passthrough().optional(),
    }),
  },
})

export const listCredentialSetMembershipsContract = defineRouteContract({
  method: 'GET',
  path: '/api/credential-sets/memberships',
  response: {
    mode: 'json',
    schema: z.object({
      memberships: z.array(credentialSetMembershipSchema).optional(),
    }),
  },
})

export const listCredentialSetInvitationsContract = defineRouteContract({
  method: 'GET',
  path: '/api/credential-sets/invitations',
  response: {
    mode: 'json',
    schema: z.object({
      invitations: z.array(credentialSetInvitationSchema).optional(),
    }),
  },
})

export const listCredentialSetMembersContract = defineRouteContract({
  method: 'GET',
  path: '/api/credential-sets/[id]/members',
  params: credentialSetIdParamsSchema,
  response: {
    mode: 'json',
    schema: z.object({
      members: z.array(credentialSetMemberSchema).optional(),
    }),
  },
})

export const listCredentialSetInvitationDetailsContract = defineRouteContract({
  method: 'GET',
  path: '/api/credential-sets/[id]/invite',
  params: credentialSetIdParamsSchema,
  response: {
    mode: 'json',
    schema: z.object({
      invitations: z.array(credentialSetInvitationDetailSchema).optional(),
    }),
  },
})

export const getCredentialSetInvitationContract = defineRouteContract({
  method: 'GET',
  path: '/api/credential-sets/invite/[token]',
  params: credentialSetInviteTokenParamsSchema,
  response: {
    mode: 'json',
    schema: z.object({
      invitation: credentialSetInvitePreviewSchema,
    }),
  },
})

export const acceptCredentialSetInvitationContract = defineRouteContract({
  method: 'POST',
  path: '/api/credential-sets/invite/[token]',
  params: credentialSetInviteTokenParamsSchema,
  response: {
    mode: 'json',
    schema: successResponseSchema.extend({
      credentialSetId: z.string(),
      providerId: z.string().nullable(),
    }),
  },
})

export const createCredentialSetInvitationContract = defineRouteContract({
  method: 'POST',
  path: '/api/credential-sets/[id]/invite',
  params: credentialSetIdParamsSchema,
  body: createCredentialSetInvitationBodySchema,
  response: {
    mode: 'json',
    schema: z.object({
      invitation: credentialSetInvitationDetailSchema.extend({
        inviteUrl: z.string(),
      }),
    }),
  },
})

export const removeCredentialSetMemberContract = defineRouteContract({
  method: 'DELETE',
  path: '/api/credential-sets/[id]/members',
  params: credentialSetIdParamsSchema,
  query: removeCredentialSetMemberQuerySchema,
  response: {
    mode: 'json',
    schema: successResponseSchema,
  },
})

export const leaveCredentialSetContract = defineRouteContract({
  method: 'DELETE',
  path: '/api/credential-sets/memberships',
  query: leaveCredentialSetQuerySchema,
  response: {
    mode: 'json',
    schema: successResponseSchema,
  },
})

export const cancelCredentialSetInvitationContract = defineRouteContract({
  method: 'DELETE',
  path: '/api/credential-sets/[id]/invite',
  params: credentialSetIdParamsSchema,
  query: cancelCredentialSetInvitationQuerySchema,
  response: {
    mode: 'json',
    schema: successResponseSchema,
  },
})

export const resendCredentialSetInvitationContract = defineRouteContract({
  method: 'POST',
  path: '/api/credential-sets/[id]/invite/[invitationId]',
  params: credentialSetInvitationParamsSchema,
  response: {
    mode: 'json',
    schema: successResponseSchema,
  },
})
