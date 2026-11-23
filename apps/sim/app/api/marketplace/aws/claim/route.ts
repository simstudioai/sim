import { getAwsMarketplaceClaimContract } from '@/lib/api/contracts/aws-marketplace'
import {
  defineInternalJsonRoute,
  internalOrchestrationErrorPolicy,
  internalRateLimits,
  internalSessionAuth,
} from '@/lib/api/server/routes'
import { readAwsMarketplaceClaim } from '@/lib/billing/aws-marketplace/application/use-cases'
import { AWS_MARKETPLACE_CLAIM_COOKIE } from '@/lib/billing/aws-marketplace/claim'

export const GET = defineInternalJsonRoute({
  contract: getAwsMarketplaceClaimContract,
  operation: readAwsMarketplaceClaim.operation,
  useCase: readAwsMarketplaceClaim,
  auth: internalSessionAuth,
  rateLimit: internalRateLimits.user({ bucketName: 'aws-marketplace-claim' }),
  errorPolicy: internalOrchestrationErrorPolicy,
  staticResponseHeaders: { 'Cache-Control': 'private, no-store' },
  mapInput: (_parsed, { request }) => ({
    claimToken: request.cookies.get(AWS_MARKETPLACE_CLAIM_COOKIE)?.value ?? null,
  }),
})
