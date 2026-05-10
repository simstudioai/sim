import { z } from 'zod'
import { defineRouteContract } from '@/lib/api/contracts/types'
import { workspacePermissionSchema } from '@/lib/api/contracts/workspaces'

export const invitationParamsSchema = z.object({
  id: z.string({ error: 'Invitation ID is required' }).min(1, 'Invitation ID is required'),
})

export const invitationQuerySchema = z.object({
  token: z.string().min(1).optional(),
})

export const invitationGrantSchema = z.object({
  workspaceId: z.string().min(1),
  permission: workspacePermissionSchema,
})

export const updateInvitationBodySchema = z
  .object({
    role: z.enum(['admin', 'member']).optional(),
    grants: z.array(invitationGrantSchema).optional(),
  })
  .refine((data) => data.role !== undefined || (data.grants && data.grants.length > 0), {
    message: 'Provide a role or at least one grant update',
  })

export const pendingWorkspaceInvitationSchema = z
  .object({
    id: z.string(),
    workspaceId: z.string(),
    email: z.string(),
    permission: workspacePermissionSchema,
    membershipIntent: z.enum(['internal', 'external']).optional(),
    status: z.string(),
    createdAt: z.string(),
  })
  .passthrough()

export const batchWorkspaceInvitationBodySchema = z.object({
  workspaceId: z.string().min(1, 'Workspace ID is required'),
  invitations: z
    .array(
      z.object({
        email: z.string().trim().min(1, 'Invitation email is required'),
        permission: workspacePermissionSchema.optional(),
      })
    )
    .min(1, 'At least one invitation is required'),
})

export const batchInvitationResultSchema = z
  .object({
    success: z.boolean(),
    successful: z.array(z.string()),
    failed: z.array(z.object({ email: z.string(), error: z.string() })),
    invitations: z.array(z.record(z.string(), z.unknown())),
  })
  .passthrough()

export const removeWorkspaceMemberBodySchema = z.object({
  workspaceId: z.string().uuid(),
})

export const invitationActionParamsSchema = z.object({
  id: z.string({ error: 'Invitation ID is required' }).min(1, 'Invitation ID is required'),
})

export const invitationActionBodySchema = z.object({
  token: z.string().min(1).optional(),
})

export const invitationDetailsSchema = z.object({
  id: z.string(),
  kind: z.enum(['organization', 'workspace']),
  email: z.string(),
  organizationId: z.string().nullable(),
  organizationName: z.string().nullable(),
  membershipIntent: z.enum(['internal', 'external']),
  role: z.string(),
  status: z.string(),
  expiresAt: z.string(),
  createdAt: z.string(),
  inviterName: z.string().nullable(),
  inviterEmail: z.string().nullable(),
  grants: z.array(
    z.object({
      workspaceId: z.string(),
      workspaceName: z.string().nullable(),
      permission: workspacePermissionSchema,
    })
  ),
})

export const acceptInvitationResponseSchema = z.object({
  success: z.literal(true),
  redirectPath: z.string(),
  invitation: z.object({
    id: z.string(),
    kind: z.enum(['organization', 'workspace']),
    organizationId: z.string().nullable(),
    acceptedWorkspaceIds: z.array(z.string()),
  }),
})

const successResponseSchema = z
  .object({
    success: z.boolean(),
  })
  .passthrough()

export const listWorkspaceInvitationsContract = defineRouteContract({
  method: 'GET',
  path: '/api/workspaces/invitations',
  response: {
    mode: 'json',
    schema: z.object({
      invitations: z.array(pendingWorkspaceInvitationSchema),
    }),
  },
})

export const batchWorkspaceInvitationsContract = defineRouteContract({
  method: 'POST',
  path: '/api/workspaces/invitations/batch',
  body: batchWorkspaceInvitationBodySchema,
  response: {
    mode: 'json',
    schema: batchInvitationResultSchema,
  },
})

export const updateInvitationContract = defineRouteContract({
  method: 'PATCH',
  path: '/api/invitations/[id]',
  params: invitationParamsSchema,
  body: updateInvitationBodySchema,
  response: {
    mode: 'json',
    schema: successResponseSchema,
  },
})

export const getInvitationContract = defineRouteContract({
  method: 'GET',
  path: '/api/invitations/[id]',
  params: invitationParamsSchema,
  query: invitationQuerySchema,
  response: {
    mode: 'json',
    schema: z.object({
      invitation: invitationDetailsSchema,
    }),
  },
})

export const acceptInvitationContract = defineRouteContract({
  method: 'POST',
  path: '/api/invitations/[id]/accept',
  params: invitationActionParamsSchema,
  body: invitationActionBodySchema,
  response: {
    mode: 'json',
    schema: acceptInvitationResponseSchema,
  },
})

export const rejectInvitationContract = defineRouteContract({
  method: 'POST',
  path: '/api/invitations/[id]/reject',
  params: invitationActionParamsSchema,
  body: invitationActionBodySchema,
  response: {
    mode: 'json',
    schema: successResponseSchema,
  },
})

export const cancelInvitationContract = defineRouteContract({
  method: 'DELETE',
  path: '/api/invitations/[id]',
  params: invitationParamsSchema,
  response: {
    mode: 'json',
    schema: successResponseSchema,
  },
})

export const resendInvitationContract = defineRouteContract({
  method: 'POST',
  path: '/api/invitations/[id]/resend',
  params: invitationParamsSchema,
  response: {
    mode: 'json',
    schema: successResponseSchema,
  },
})

export const removeWorkspaceMemberContract = defineRouteContract({
  method: 'DELETE',
  path: '/api/workspaces/members/[id]',
  params: invitationParamsSchema,
  body: removeWorkspaceMemberBodySchema,
  response: {
    mode: 'json',
    schema: successResponseSchema,
  },
})

export type PendingInvitationRow = z.infer<typeof pendingWorkspaceInvitationSchema>
export type BatchInvitationResult = z.infer<typeof batchInvitationResultSchema>
export type InvitationDetails = z.infer<typeof invitationDetailsSchema>
