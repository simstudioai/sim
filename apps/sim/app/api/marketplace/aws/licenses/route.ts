import { listAccountAwsMarketplaceLicensesContract } from '@/lib/api/contracts/aws-marketplace'
import {
  defineInternalJsonRoute,
  internalOrchestrationErrorPolicy,
  internalRateLimits,
  internalSessionAuth,
} from '@/lib/api/server/routes'
import { listAccountAwsMarketplaceLicenses } from '@/lib/billing/aws-marketplace/application/use-cases'

export const GET = defineInternalJsonRoute({
  contract: listAccountAwsMarketplaceLicensesContract,
  operation: listAccountAwsMarketplaceLicenses.operation,
  useCase: listAccountAwsMarketplaceLicenses,
  auth: internalSessionAuth,
  rateLimit: internalRateLimits.user({ bucketName: 'aws-marketplace-licenses' }),
  errorPolicy: internalOrchestrationErrorPolicy,
  staticResponseHeaders: { 'Cache-Control': 'private, no-store' },
  mapInput: () => ({}),
  present: (licenses) => ({ licenses }),
})
