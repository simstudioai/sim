import { v2CreateWorkspaceInvitationsContract } from '@/lib/api/contracts/v2/workspace-invitations'
import {
  createV2ResourceConcealmentPolicy,
  defineV2JsonRoute,
  v2ApiKeyAuth,
  v2RateLimits,
} from '@/lib/api/server/routes'
import { v2OrganizationErrorPolicy } from '@/lib/api/server/routes/organizations'
import { invitationOperations } from '@/lib/invitations/application/operations'
import { sendInvitationBatch } from '@/lib/invitations/application/send-invitation-batch'

export const POST = defineV2JsonRoute({
  contract: v2CreateWorkspaceInvitationsContract,
  operation: invitationOperations.sendBatch,
  auth: v2ApiKeyAuth,
  rateLimit: v2RateLimits.publicApi,
  errorPolicy: createV2ResourceConcealmentPolicy({
    notFoundMessage: 'Workspace not found',
    render: v2OrganizationErrorPolicy.render,
  }),
  mapInput: ({ params, body }) => ({ ...body, workspaceIds: [params.workspaceId] }),
  useCase: sendInvitationBatch,
  present: (result) => ({ data: result }),
})
