import {
  getOrganizationPaymentMethodContract,
  startOrganizationAutoPayContract,
} from '@/lib/api/contracts/organization'
import {
  defineInternalJsonRoute,
  internalOrchestrationErrorPolicy,
  internalRateLimits,
  internalSessionAuth,
} from '@/lib/api/server/routes'
import { internalBillingReadErrorPolicy } from '@/lib/api/server/routes/billing-read'
import {
  getEnterprisePaymentMethod,
  startEnterpriseAutoPaySetup,
} from '@/lib/billing/application/organization-billing/enterprise-payment-method'
import { organizationBillingOperations } from '@/lib/billing/application/organization-billing/operations'

export const dynamic = 'force-dynamic'

export const GET = defineInternalJsonRoute({
  contract: getOrganizationPaymentMethodContract,
  auth: internalSessionAuth,
  operation: organizationBillingOperations.read,
  rateLimit: internalRateLimits.user({ bucketName: 'organization-payment-method' }),
  errorPolicy: internalBillingReadErrorPolicy,
  mapInput: ({ params }) => ({ organizationId: params.id }),
  useCase: getEnterprisePaymentMethod,
  present: (data) => ({ success: true, data }),
})

export const POST = defineInternalJsonRoute({
  contract: startOrganizationAutoPayContract,
  auth: internalSessionAuth,
  operation: organizationBillingOperations.managePaymentMethod,
  rateLimit: internalRateLimits.user({ bucketName: 'organization-payment-method' }),
  errorPolicy: internalOrchestrationErrorPolicy,
  mapInput: ({ params, body }) => ({ organizationId: params.id, returnUrl: body.returnUrl }),
  useCase: startEnterpriseAutoPaySetup,
  present: (data) => data,
})
