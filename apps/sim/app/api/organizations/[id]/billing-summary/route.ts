import { getOrganizationBillingSummaryContract } from '@/lib/api/contracts/organization'
import {
  defineInternalJsonRoute,
  internalOrchestrationErrorPolicy,
  internalRateLimits,
  internalSessionAuth,
} from '@/lib/api/server/routes'
import { getOrganizationBillingSummary } from '@/lib/billing/application/organization-billing-summary/get-organization-billing-summary'
import { organizationBillingSummaryOperations } from '@/lib/billing/application/organization-billing-summary/operations'

export const dynamic = 'force-dynamic'

export const GET = defineInternalJsonRoute({
  contract: getOrganizationBillingSummaryContract,
  auth: internalSessionAuth,
  operation: organizationBillingSummaryOperations.read,
  rateLimit: internalRateLimits.none({
    reason: 'Authenticated organization billing read, restricted to organization admins and owners',
  }),
  errorPolicy: internalOrchestrationErrorPolicy,
  mapInput: ({ params }) => ({ organizationId: params.id }),
  useCase: getOrganizationBillingSummary,
  present: (data) => ({ success: true, data }),
})
