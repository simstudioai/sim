import { getOrganizationPlanSeatsContract } from '@/lib/api/contracts/organization'
import {
  defineInternalJsonRoute,
  internalRateLimits,
  internalSessionAuth,
} from '@/lib/api/server/routes'
import { internalBillingReadErrorPolicy } from '@/lib/api/server/routes/billing-read'
import { getOrganizationPlanSeats } from '@/lib/billing/application/organization-billing/get-organization-plan-seats'
import { organizationBillingOperations } from '@/lib/billing/application/organization-billing/operations'

export const dynamic = 'force-dynamic'

export const GET = defineInternalJsonRoute({
  contract: getOrganizationPlanSeatsContract,
  auth: internalSessionAuth,
  operation: organizationBillingOperations.planSeats,
  rateLimit: internalRateLimits.none({
    reason: 'Small organization plan and seat read restricted to current admins and owners',
  }),
  errorPolicy: internalBillingReadErrorPolicy,
  mapInput: ({ params }) => ({ organizationId: params.id }),
  useCase: getOrganizationPlanSeats,
  present: (data) => ({ success: true, data }),
})
