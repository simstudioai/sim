import { z } from 'zod'
import {
  batchInvitationResultSchema,
  invitationMembershipSchema,
} from '@/lib/api/contracts/invitations'
import { noInputSchema, workspaceIdSchema } from '@/lib/api/contracts/primitives'
import { defineRouteContract } from '@/lib/api/contracts/types'
import { v2DataResponse } from '@/lib/api/contracts/v2/shared'
import { workspacePermissionSchema } from '@/lib/api/contracts/workspaces'

export const v2CreateWorkspaceInvitationsParamsSchema = z.object({
  workspaceId: workspaceIdSchema,
})

export const v2CreateWorkspaceInvitationsBodySchema = z
  .object({
    emails: z
      .array(
        z.string().trim().email('email must be a valid email address').max(320, 'email is too long')
      )
      .min(1, 'emails must contain at least one address')
      .max(50, 'emails cannot contain more than 50 addresses')
      .describe(
        'Email addresses to invite. Each address is processed separately; inspect failed for unsuccessful recipients.'
      ),
    permission: workspacePermissionSchema
      .default('read')
      .describe('Workspace permission to grant. Existing workspace access is preserved.'),
    membership: invitationMembershipSchema
      .default('member')
      .describe(
        'Organization membership: member or admin uses a seat when billing is enabled. External grants workspace access only and requires an eligible paid account when billing is enabled. Existing members of another organization remain external.'
      ),
  })
  .strict()

export const v2CreateWorkspaceInvitationsContract = defineRouteContract({
  method: 'POST',
  path: '/api/v2/workspaces/[workspaceId]/invitations',
  params: v2CreateWorkspaceInvitationsParamsSchema,
  query: noInputSchema,
  body: v2CreateWorkspaceInvitationsBodySchema,
  response: {
    mode: 'json',
    schema: v2DataResponse(batchInvitationResultSchema.meta({ id: 'V2WorkspaceInvitationBatch' })),
  },
})

export type V2CreateWorkspaceInvitationsParams = z.input<
  typeof v2CreateWorkspaceInvitationsParamsSchema
>
export type V2CreateWorkspaceInvitationsBody = z.input<
  typeof v2CreateWorkspaceInvitationsBodySchema
>
export type V2CreateWorkspaceInvitationsResponse = z.output<
  typeof v2CreateWorkspaceInvitationsContract.response.schema
>
