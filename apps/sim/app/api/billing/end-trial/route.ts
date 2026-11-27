import { billingEndTrialContract } from '@/lib/api/contracts/subscription'
import {
  defineInternalJsonRoute,
  internalOrchestrationErrorPolicy,
  internalRateLimits,
  internalSessionAuth,
} from '@/lib/api/server/routes'
import { endProTrial, proTrialOperations } from '@/lib/billing/application/pro-trial'

export const dynamic = 'force-dynamic'

export const POST = defineInternalJsonRoute({
  contract: billingEndTrialContract,
  auth: internalSessionAuth,
  operation: proTrialOperations.end,
  rateLimit: internalRateLimits.user({ bucketName: 'billing-end-trial' }),
  errorPolicy: internalOrchestrationErrorPolicy,
  mapInput: () => ({}),
  useCase: endProTrial,
  present: (data) => data,
})
