import { NextResponse } from 'next/server'
import { getUsageLimitContract, updateUsageLimitContract } from '@/lib/api/contracts/subscription'
import { getValidationErrorMessage } from '@/lib/api/server'
import {
  defineInternalJsonRoute,
  internalErrorResponse,
  internalOrchestrationErrorPolicy,
  internalRateLimits,
  internalSessionAuth,
} from '@/lib/api/server/routes'
import {
  readUsageLimit,
  type UsageLimitResult,
  updateUsageLimit,
  usageLimitOperations,
} from '@/lib/billing/application/usage-limits'

const rateLimit = internalRateLimits.none({
  reason: 'Preserve existing usage-cap settings admission',
})
const errorPolicy = {
  project: internalOrchestrationErrorPolicy.project,
  unhandled: () => internalErrorResponse(500, { error: 'Internal server error' }),
}
function present(result: UsageLimitResult) {
  if (result.context === 'user')
    return {
      ...result,
      data: { ...result.data, updatedAt: result.data.updatedAt?.toISOString() ?? null },
    }
  return {
    ...result,
    data: result.data
      ? {
          ...result.data,
          billingPeriodStart: result.data.billingPeriodStart?.toISOString() ?? null,
          billingPeriodEnd: result.data.billingPeriodEnd?.toISOString() ?? null,
          members: result.data.members.map((member) => ({
            ...member,
            joinedAt: member.joinedAt.toISOString(),
          })),
        }
      : null,
  }
}
export const GET = defineInternalJsonRoute({
  contract: getUsageLimitContract,
  auth: internalSessionAuth,
  operation: usageLimitOperations.read,
  rateLimit,
  errorPolicy,
  mapInput: ({ query }) => query,
  useCase: readUsageLimit,
  present,
  parseOptions: {
    validationErrorResponse: () =>
      NextResponse.json(
        { error: 'Invalid context. Must be "user" or "organization"' },
        { status: 400 }
      ),
  },
})
export const PUT = defineInternalJsonRoute({
  contract: updateUsageLimitContract,
  auth: internalSessionAuth,
  operation: usageLimitOperations.update,
  rateLimit,
  errorPolicy,
  mapInput: ({ body }) => body,
  useCase: updateUsageLimit,
  present,
  parseOptions: {
    validationErrorResponse: (error) =>
      NextResponse.json({ error: getValidationErrorMessage(error) }, { status: 400 }),
  },
})
