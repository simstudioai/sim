import { z } from 'zod'
import { workspaceIdSchema } from '@/lib/api/contracts/primitives'
import { defineRouteContract } from '@/lib/api/contracts/types'
import { workspacePermissionSchema } from '@/lib/api/contracts/workspaces'

/**
 * Shared cap for the disclosure token: the preview's id list and the accept
 * body's echo of it must agree, or a large owned-workspace set would produce a
 * preview the accept endpoint rejects as over-long.
 */
export const DISCLOSED_WORKSPACE_ID_LIMIT = 500

/** One invitation authorizes and stamps each workspace, so the fan-out is bounded. */
export const MAX_INVITE_WORKSPACES = 50
export const MAX_INVITE_EMAILS = 100

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
    token: z.string(),
    permission: workspacePermissionSchema,
    membershipIntent: z.enum(['internal', 'external']).optional(),
    status: z.string(),
    createdAt: z.string(),
  })
  .passthrough()

/**
 * What the invitee becomes in the workspaces' organization. `member` and
 * `admin` are organization roles that consume a seat; `external` grants the
 * workspaces only and is restricted to invitees already on a paid plan.
 */
export const invitationMembershipSchema = z.enum(['member', 'admin', 'external'])

export const batchWorkspaceInvitationBodySchema = z.object({
  workspaceIds: z
    .array(workspaceIdSchema)
    .min(1, 'Select at least one workspace')
    .max(MAX_INVITE_WORKSPACES, `Select at most ${MAX_INVITE_WORKSPACES} workspaces`),
  emails: z
    .array(z.string().trim().min(1, 'Invitation email is required'))
    .min(1, 'At least one invitation is required')
    .max(MAX_INVITE_EMAILS, `Invite at most ${MAX_INVITE_EMAILS} people at a time`),
  /** Workspace access level applied to every selected workspace. */
  permission: workspacePermissionSchema.optional(),
  membership: invitationMembershipSchema.optional(),
})

export const batchInvitationResultSchema = z.object({
  success: z.boolean(),
  /** Emails that received a pending invitation. */
  successful: z.array(z.string()),
  /** Emails that were existing organization members and got access immediately. */
  added: z.array(z.string()),
  failed: z.array(z.object({ email: z.string(), error: z.string() })),
  invitations: z.array(
    z.object({
      id: z.string(),
      email: z.string(),
      workspaceIds: z.array(z.string()),
      permission: workspacePermissionSchema,
      membershipIntent: z.enum(['internal', 'external']),
      instantAdd: z.boolean().optional(),
      outcome: z.enum(['added', 'unchanged']).optional(),
    })
  ),
})

export const removeWorkspaceMemberBodySchema = z.object({
  workspaceId: z.string().uuid(),
})

export const invitationActionParamsSchema = z.object({
  id: z.string({ error: 'Invitation ID is required' }).min(1, 'Invitation ID is required'),
})

export const invitationActionBodySchema = z.object({
  token: z.string().min(1).optional(),
  /**
   * The workspace ids the accept screen disclosed as moving (from the join
   * preview). When present, acceptance fails with `disclosure-outdated` if
   * the set it would actually sweep differs — consent is only valid for the
   * set the user saw.
   */
  disclosedWorkspaceIds: z.array(z.string()).max(DISCLOSED_WORKSPACE_ID_LIMIT).optional(),
  /**
   * The membership outcome the accept screen disclosed. The workspace-id list
   * alone cannot express it — a no-join preview and a will-join preview for
   * someone who owns nothing both disclose `[]` — so consent to becoming a
   * seat-consuming member is carried explicitly.
   */
  disclosedWillJoinOrganization: z.boolean().optional(),
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

export const invitationJoinPreviewSchema = z.object({
  willJoinOrganization: z.boolean(),
  /**
   * The invitee is already a member of the organization acceptance lands in, so
   * only workspace access changes. Reported separately because it shares
   * `willJoinOrganization: false` with the external case, which means something
   * different to the person accepting.
   */
  alreadyMemberOfOrganization: z.boolean(),
  /** Name of the organization acceptance will actually join. */
  organizationName: z.string().nullable(),
  workspacesToMove: z.array(z.string()).max(DISCLOSED_WORKSPACE_ID_LIMIT),
  /**
   * Stable ids behind `workspacesToMove`, echoed back on accept as the
   * disclosure token: acceptance rejects when the set it would sweep no
   * longer matches what this preview disclosed. Capped at the same limit as
   * the accept body's echo so a large owned set can never render an invite
   * permanently un-acceptable.
   */
  workspaceIdsToMove: z.array(z.string()).max(DISCLOSED_WORKSPACE_ID_LIMIT),
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
      /** Invitee-only preview of what accepting will do; null for other viewers. */
      joinPreview: invitationJoinPreviewSchema.nullable(),
      /**
       * True when the preview could not be computed for a pending
       * invitee-viewed invitation. Accepting may still move owned workspaces,
       * so the client must fall back to a generic migration notice rather
       * than treating the missing preview as "nothing moves".
       */
      joinPreviewUnavailable: z.boolean().optional(),
    }),
  },
})

/**
 * A pending invitation plus what accepting it will actually do. The preview
 * rides along so the in-app list can disclose the workspace migration and echo
 * `disclosedWorkspaceIds` on accept, exactly like the emailed `/invite` page —
 * an accept surface without it would sweep workspaces without consent. `null`
 * when the preview could not be computed; the client then shows the generic
 * notice rather than treating it as "nothing moves".
 */
export const myInvitationSchema = invitationDetailsSchema.extend({
  joinPreview: invitationJoinPreviewSchema.nullable(),
})

export type MyInvitation = z.output<typeof myInvitationSchema>

export const listMyInvitationsContract = defineRouteContract({
  method: 'GET',
  path: '/api/invitations',
  response: {
    mode: 'json',
    schema: z.object({
      invitations: z.array(myInvitationSchema),
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

/**
 * `workspaceId` scopes the revocation to one granted workspace, which is all a
 * workspace-level member list can authorize. Omitting it revokes the entire
 * invitation and requires authority over all of it — see the route.
 */
export const cancelInvitationQuerySchema = z.object({
  workspaceId: workspaceIdSchema.optional(),
})

export const cancelInvitationContract = defineRouteContract({
  method: 'DELETE',
  path: '/api/invitations/[id]',
  params: invitationParamsSchema,
  query: cancelInvitationQuerySchema,
  response: {
    mode: 'json',
    schema: successResponseSchema.extend({
      /**
       * False when only one workspace's grant was removed and the invitation is
       * still pending for its remaining workspaces.
       */
      invitationCancelled: z.boolean(),
    }),
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
export type InvitationJoinPreview = z.infer<typeof invitationJoinPreviewSchema>
