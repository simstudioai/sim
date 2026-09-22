import { z } from 'zod'
import {
  noInputSchema,
  nonEmptyIdSchema,
  organizationIdSchema,
  organizationRoleSchema,
} from '@/lib/api/contracts/primitives'
import { defineRouteContract } from '@/lib/api/contracts/types'
import {
  v2CursorListResponse,
  v2DataResponse,
  v2PaginationFields,
  v2SearchSchema,
  v2SortFields,
  v2TimestampSchema,
} from '@/lib/api/contracts/v2/shared'
import { workspacePermissionSchema } from '@/lib/api/contracts/workspaces'

export const v2OrganizationParamsSchema = z
  .object({
    organizationId: organizationIdSchema.describe('Organization identifier.'),
  })
  .strict()
export type V2OrganizationParams = z.input<typeof v2OrganizationParamsSchema>
export const v2OrganizationMemberParamsSchema = v2OrganizationParamsSchema.extend({
  userId: nonEmptyIdSchema.describe('User identifier of the organization member.'),
})
export type V2OrganizationMemberParams = z.input<typeof v2OrganizationMemberParamsSchema>
export const v2OrganizationInvitationParamsSchema = v2OrganizationParamsSchema.extend({
  invitationId: nonEmptyIdSchema.describe('Invitation identifier.'),
})
export type V2OrganizationInvitationParams = z.input<typeof v2OrganizationInvitationParamsSchema>

export const v2OrganizationSchema = z
  .object({
    id: z.string().describe('Organization identifier.'),
    name: z.string().describe('Organization display name.'),
    slug: z.string().describe('Organization slug.'),
    logo: z.string().nullable().describe('Organization logo URL, or null when unset.'),
    role: organizationRoleSchema.describe('The acting user’s role in this organization.'),
    createdAt: v2TimestampSchema.describe('When the organization was created.'),
  })
  .meta({
    id: 'V2Organization',
    title: 'Organization',
    description: 'An organization the acting user belongs to.',
  })
export type V2Organization = z.output<typeof v2OrganizationSchema>

export const v2OrganizationMemberSchema = z
  .object({
    userId: z
      .string()
      .describe('User identifier; use this identifier to update or remove the member.'),
    name: z.string().describe('Member display name.'),
    email: z.string().describe('Member email address.'),
    role: organizationRoleSchema.describe(
      'Organization role; separate from workspace permissions.'
    ),
    joinedAt: v2TimestampSchema.describe('When the user joined the organization.'),
  })
  .meta({
    id: 'V2OrganizationMember',
    title: 'Organization member',
    description: 'An organization membership identified by user ID.',
  })
export type V2OrganizationMember = z.output<typeof v2OrganizationMemberSchema>

export const v2OrganizationWorkspaceSchema = z
  .object({
    id: z.string().describe('Workspace identifier.'),
    name: z.string().describe('Workspace display name.'),
  })
  .meta({
    id: 'V2OrganizationWorkspace',
    title: 'Organization workspace',
    description: 'A workspace owned by the organization.',
  })
export type V2OrganizationWorkspace = z.output<typeof v2OrganizationWorkspaceSchema>

export const v2OrganizationInvitationWorkspaceSchema = v2OrganizationWorkspaceSchema
  .extend({
    permission: workspacePermissionSchema.describe(
      'Workspace permission offered by the invitation.'
    ),
    archivedAt: v2TimestampSchema
      .nullable()
      .describe('When the workspace was archived, or null while active.'),
  })
  .meta({
    id: 'V2OrganizationInvitationWorkspace',
    title: 'Organization invitation workspace',
    description:
      'A workspace grant attached to an invitation, separate from organization membership.',
  })
export type V2OrganizationInvitationWorkspace = z.output<
  typeof v2OrganizationInvitationWorkspaceSchema
>

export const v2OrganizationInvitationSchema = z
  .object({
    id: z.string().describe('Invitation identifier.'),
    organizationId: z.string().describe('Organization that owns the invitation.'),
    email: z.string().describe('Email address of the invitee.'),
    role: z.enum(['member', 'admin']).describe('Organization role offered to an internal invitee.'),
    kind: z
      .enum(['organization', 'workspace'])
      .describe('Whether the invitation originated from organization or workspace administration.'),
    membershipIntent: z
      .enum(['internal', 'external'])
      .describe('Whether acceptance joins the organization or grants workspace access only.'),
    status: z
      .enum(['pending', 'accepted', 'rejected', 'cancelled', 'expired'])
      .describe('Current invitation status; elapsed pending invitations are reported as expired.'),
    createdAt: v2TimestampSchema.describe('When the invitation was created.'),
    expiresAt: v2TimestampSchema.describe('When the invitation expires.'),
  })
  .meta({
    id: 'V2OrganizationInvitation',
    title: 'Organization invitation',
    description: 'Invitation metadata without its acceptance token.',
  })
export type V2OrganizationInvitation = z.output<typeof v2OrganizationInvitationSchema>

export const v2ListOrganizationsQuerySchema = z
  .object({
    search: v2SearchSchema.describe(
      'Case-insensitive substring match against the organization name.'
    ),
    ...v2SortFields(['name', 'createdAt'] as const, { sortBy: 'name', sortOrder: 'asc' }),
    ...v2PaginationFields({ description: 'Maximum organizations to return per page.' }),
  })
  .strict()
export type V2ListOrganizationsQuery = z.output<typeof v2ListOrganizationsQuerySchema>
export const v2ListOrganizationMembersQuerySchema = z
  .object({
    search: v2SearchSchema.describe(
      'Case-insensitive substring match against member name or email.'
    ),
    ...v2SortFields(['name', 'email', 'joinedAt'] as const, { sortBy: 'name', sortOrder: 'asc' }),
    ...v2PaginationFields({ description: 'Maximum members to return per page.' }),
  })
  .strict()
export type V2ListOrganizationMembersQuery = z.output<typeof v2ListOrganizationMembersQuerySchema>
export const v2ListOrganizationWorkspacesQuerySchema = z
  .object({
    search: v2SearchSchema.describe('Case-insensitive substring match against the workspace name.'),
    ...v2SortFields(['name', 'id'] as const, { sortBy: 'name', sortOrder: 'asc' }),
    ...v2PaginationFields({ description: 'Maximum workspaces to return per page.' }),
  })
  .strict()
export type V2ListOrganizationWorkspacesQuery = z.output<
  typeof v2ListOrganizationWorkspacesQuerySchema
>
export const v2ListOrganizationInvitationWorkspacesQuerySchema =
  v2ListOrganizationWorkspacesQuerySchema
export type V2ListOrganizationInvitationWorkspacesQuery = z.output<
  typeof v2ListOrganizationInvitationWorkspacesQuerySchema
>
export const v2ListOrganizationInvitationsQuerySchema = z
  .object({
    search: v2SearchSchema.describe('Case-insensitive substring match against the invitee email.'),
    status: z
      .enum(['pending', 'accepted', 'rejected', 'cancelled', 'expired'])
      .optional()
      .describe('Filter by current invitation status. Omit to include all statuses.'),
    ...v2SortFields(['email', 'createdAt'] as const, { sortBy: 'createdAt', sortOrder: 'desc' }),
    ...v2PaginationFields({ description: 'Maximum invitations to return per page.' }),
  })
  .strict()
export type V2ListOrganizationInvitationsQuery = z.output<
  typeof v2ListOrganizationInvitationsQuerySchema
>
export const v2UpdateOrganizationMemberBodySchema = z
  .object({
    role: z
      .enum(['member', 'admin'])
      .describe('New organization role. Ownership transfers use a separate operation.'),
  })
  .strict()
export type V2UpdateOrganizationMemberBody = z.input<typeof v2UpdateOrganizationMemberBodySchema>
export const v2CreateOrganizationInvitationBodySchema = z
  .object({
    email: z
      .string()
      .trim()
      .min(1, 'email is required')
      .max(254, 'email cannot exceed 254 characters')
      .email('email must be a valid email address')
      .describe('Email address of the person to invite.'),
    role: z
      .enum(['member', 'admin'])
      .default('member')
      .describe(
        'Organization role to offer. Defaults to member; grants no workspace-specific permissions.'
      ),
  })
  .strict()
export type V2CreateOrganizationInvitationBody = z.input<
  typeof v2CreateOrganizationInvitationBodySchema
>

export const v2ListOrganizationsContract = defineRouteContract({
  method: 'GET',
  path: '/api/v2/organizations',
  query: v2ListOrganizationsQuerySchema,
  response: { mode: 'json', schema: v2CursorListResponse(v2OrganizationSchema) },
})
export const v2GetOrganizationContract = defineRouteContract({
  method: 'GET',
  path: '/api/v2/organizations/[organizationId]',
  params: v2OrganizationParamsSchema,
  query: noInputSchema,
  response: { mode: 'json', schema: v2DataResponse(v2OrganizationSchema) },
})
export const v2ListOrganizationWorkspacesContract = defineRouteContract({
  method: 'GET',
  path: '/api/v2/organizations/[organizationId]/workspaces',
  params: v2OrganizationParamsSchema,
  query: v2ListOrganizationWorkspacesQuerySchema,
  response: { mode: 'json', schema: v2CursorListResponse(v2OrganizationWorkspaceSchema) },
})
export const v2ListOrganizationMembersContract = defineRouteContract({
  method: 'GET',
  path: '/api/v2/organizations/[organizationId]/members',
  params: v2OrganizationParamsSchema,
  query: v2ListOrganizationMembersQuerySchema,
  response: { mode: 'json', schema: v2CursorListResponse(v2OrganizationMemberSchema) },
})
export const v2UpdateOrganizationMemberContract = defineRouteContract({
  method: 'PATCH',
  path: '/api/v2/organizations/[organizationId]/members/[userId]',
  params: v2OrganizationMemberParamsSchema,
  query: noInputSchema,
  body: v2UpdateOrganizationMemberBodySchema,
  response: { mode: 'json', schema: v2DataResponse(v2OrganizationMemberSchema) },
})
export const v2RemoveOrganizationMemberContract = defineRouteContract({
  method: 'DELETE',
  path: '/api/v2/organizations/[organizationId]/members/[userId]',
  params: v2OrganizationMemberParamsSchema,
  query: noInputSchema,
  response: {
    mode: 'json',
    schema: v2DataResponse(
      z
        .object({
          userId: z.string().describe('User removed from the organization.'),
          deleted: z
            .literal(true)
            .describe('Whether membership and organization workspace access were removed.'),
        })
        .meta({
          id: 'V2OrganizationMemberDeletion',
          title: 'Organization member removal',
          description: 'Acknowledges removal of an organization member.',
        })
    ),
  },
})
export const v2ListOrganizationInvitationsContract = defineRouteContract({
  method: 'GET',
  path: '/api/v2/organizations/[organizationId]/invitations',
  params: v2OrganizationParamsSchema,
  query: v2ListOrganizationInvitationsQuerySchema,
  response: { mode: 'json', schema: v2CursorListResponse(v2OrganizationInvitationSchema) },
})
export const v2CreateOrganizationInvitationContract = defineRouteContract({
  method: 'POST',
  path: '/api/v2/organizations/[organizationId]/invitations',
  params: v2OrganizationParamsSchema,
  query: noInputSchema,
  body: v2CreateOrganizationInvitationBodySchema,
  response: { mode: 'json', schema: v2DataResponse(v2OrganizationInvitationSchema), status: 201 },
})
export const v2GetOrganizationInvitationContract = defineRouteContract({
  method: 'GET',
  path: '/api/v2/organizations/[organizationId]/invitations/[invitationId]',
  params: v2OrganizationInvitationParamsSchema,
  query: noInputSchema,
  response: { mode: 'json', schema: v2DataResponse(v2OrganizationInvitationSchema) },
})
export const v2ListOrganizationInvitationWorkspacesContract = defineRouteContract({
  method: 'GET',
  path: '/api/v2/organizations/[organizationId]/invitations/[invitationId]/workspaces',
  params: v2OrganizationInvitationParamsSchema,
  query: v2ListOrganizationInvitationWorkspacesQuerySchema,
  response: { mode: 'json', schema: v2CursorListResponse(v2OrganizationInvitationWorkspaceSchema) },
})
export const v2RevokeOrganizationInvitationContract = defineRouteContract({
  method: 'DELETE',
  path: '/api/v2/organizations/[organizationId]/invitations/[invitationId]',
  params: v2OrganizationInvitationParamsSchema,
  query: noInputSchema,
  response: {
    mode: 'json',
    schema: v2DataResponse(
      z
        .object({
          id: z.string().describe('Revoked invitation identifier.'),
          status: z
            .literal('cancelled')
            .describe('Revocation cancels the invitation and prevents acceptance.'),
        })
        .meta({
          id: 'V2OrganizationInvitationRevocation',
          title: 'Organization invitation revocation',
          description: 'Acknowledges cancellation of a pending invitation.',
        })
    ),
  },
})
export const v2ResendOrganizationInvitationContract = defineRouteContract({
  method: 'POST',
  path: '/api/v2/organizations/[organizationId]/invitations/[invitationId]/resend',
  params: v2OrganizationInvitationParamsSchema,
  query: noInputSchema,
  body: noInputSchema.optional().default({}),
  response: { mode: 'json', schema: v2DataResponse(v2OrganizationInvitationSchema) },
})
