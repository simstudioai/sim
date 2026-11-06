import { saveAwsMarketplaceClaimContactContract } from '@/lib/api/contracts/aws-marketplace'
import {
  defineInternalJsonRoute,
  internalOrchestrationErrorPolicy,
  internalRateLimits,
  internalSessionAuth,
} from '@/lib/api/server/routes'
import { saveAwsMarketplaceClaimContact } from '@/lib/billing/aws-marketplace/application/use-cases'
import { AWS_MARKETPLACE_CLAIM_COOKIE } from '@/lib/billing/aws-marketplace/claim'

export const POST = defineInternalJsonRoute({
  contract: saveAwsMarketplaceClaimContactContract,
  operation: saveAwsMarketplaceClaimContact.operation,
  useCase: saveAwsMarketplaceClaimContact,
  auth: internalSessionAuth,
  rateLimit: internalRateLimits.user({ bucketName: 'aws-marketplace-link' }),
  errorPolicy: internalOrchestrationErrorPolicy,
  staticResponseHeaders: { 'Cache-Control': 'private, no-store' },
  mapInput: ({ body }, { request }) => ({
    licenseId: body.licenseId,
    contactEmail: body.contactEmail,
    companyName: body.companyName || null,
    claimToken: request.cookies.get(AWS_MARKETPLACE_CLAIM_COOKIE)?.value ?? null,
  }),
})
