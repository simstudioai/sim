import { getOrganizationBillingSummaryContract } from '@/lib/api/contracts/organization'
import {
  defineInternalJsonRoute,
  internalRateLimits,
  internalSessionAuth,
} from '@/lib/api/server/routes'
import { internalBillingReadErrorPolicy } from '@/lib/api/server/routes/billing-read'
import { getOrganizationBillingSummary } from '@/lib/billing/application/organization-billing/get-organization-billing-summary'
import { organizationBillingOperations } from '@/lib/billing/application/organization-billing/operations'

export const dynamic = 'force-dynamic'

export const GET = defineInternalJsonRoute({
  contract: getOrganizationBillingSummaryContract,
  auth: internalSessionAuth,
  operation: organizationBillingOperations.read,
  rateLimit: internalRateLimits.none({
    reason: 'Authenticated organization billing read, restricted to organization admins and owners',
  }),
  errorPolicy: internalBillingReadErrorPolicy,
  mapInput: ({ params }) => ({ organizationId: params.id }),
  useCase: getOrganizationBillingSummary,
  present: (data) => ({ success: true, data }),
})
