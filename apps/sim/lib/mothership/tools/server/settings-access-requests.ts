import { z } from 'zod'
import {
  ACCESS_REQUEST_STATUSES,
  accessRequestParamsSchema,
  listOrganizationAccessRequestsQuerySchema,
} from '@/lib/api/contracts/access-requests'
import { v2ResolveAccessRequestBodySchema } from '@/lib/api/contracts/v2/access-requests'
import type { SettingsContext } from '@/lib/mothership/application/settings-context'
import {
  settingsOperation,
  settingsOrganizationId,
} from '@/lib/mothership/tools/server/settings-operation'
import { listOrganizationAccessRequests } from '@/ee/access-requests/lib/application/requests'
import {
  previewAccessRequest,
  resolveAccessRequest,
} from '@/ee/access-requests/lib/application/review'
import type { ResolveAccessRequestDecision } from '@/ee/access-requests/lib/types'

const requestTarget = { requestId: accessRequestParamsSchema.shape.requestId }
const [applyDecisionSchema, declineDecisionSchema] = v2ResolveAccessRequestBodySchema.options
const listQuerySchema = listOrganizationAccessRequestsQuerySchema.extend({
  status: z
    .enum(ACCESS_REQUEST_STATUSES)
    .default('pending')
    .describe('Request status to list; defaults to pending.'),
})

/** The first page of pending requests, or the page `query` selects. */
export function readSettingsAccessRequests(
  context: SettingsContext,
  query: z.output<typeof listQuerySchema> = listQuerySchema.parse({})
) {
  return listOrganizationAccessRequests.execute({
    principal: context.principal,
    input: { ...query, organizationId: settingsOrganizationId(context) },
  })
}

async function resolve(
  context: SettingsContext,
  requestId: string,
  decision: ResolveAccessRequestDecision
) {
  const { request, changed } = await resolveAccessRequest.execute({
    principal: context.principal,
    input: { organizationId: settingsOrganizationId(context), requestId, decision },
  })
  return { request, changed }
}

/** Admin role, fingerprint freshness, grants, audit and the requester's notice stay in the use cases. */
export const accessRequestSettingsActions = {
  list: settingsOperation('read', listQuerySchema, readSettingsAccessRequests),
  preview: settingsOperation('read', z.strictObject(requestTarget), (context, input) =>
    previewAccessRequest.execute({
      principal: context.principal,
      input: { ...input, organizationId: settingsOrganizationId(context) },
    })
  ),
  approve: settingsOperation(
    'write',
    applyDecisionSchema.omit({ action: true }).extend(requestTarget).strict(),
    (context, { requestId, ...decision }) =>
      resolve(context, requestId, { action: 'apply', ...decision })
  ),
  deny: settingsOperation(
    'write',
    declineDecisionSchema.omit({ action: true }).extend(requestTarget).strict(),
    (context, { requestId, ...decision }) =>
      resolve(context, requestId, { action: 'decline', ...decision })
  ),
}
