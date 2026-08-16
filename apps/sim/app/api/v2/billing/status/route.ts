import { v2GetBillingStatusContract } from '@/lib/api/contracts/v2/billing'
import { defineV2JsonRoute, v2ApiKeyAuth, v2RateLimits } from '@/lib/api/server/routes'
import { v2BillingErrorPolicies } from '@/lib/billing/api/route-policies'
import { getBillingStatus } from '@/lib/billing/application/get-billing-status'
import { billingOperations } from '@/lib/billing/application/operations'

export const dynamic = 'force-dynamic'
export const revalidate = 0

/** Current billing standing; ledger events are exposed separately by `/billing/logs`. */
export const GET = defineV2JsonRoute({
  contract: v2GetBillingStatusContract,
  auth: v2ApiKeyAuth,
  operation: billingOperations.readStatus,
  rateLimit: v2RateLimits.publicApi,
  errorPolicy: v2BillingErrorPolicies.concealWorkspaceAuthorization,
  mapInput: ({ query }) => ({ workspaceId: query.workspaceId }),
  useCase: getBillingStatus,
  present: (data) => ({ data }),
})
