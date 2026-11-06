import { linkAwsMarketplaceLicenseContract } from '@/lib/api/contracts/aws-marketplace'
import {
  defineInternalJsonRoute,
  internalOrchestrationErrorPolicy,
  internalRateLimits,
  internalSessionAuth,
} from '@/lib/api/server/routes'
import { linkAwsMarketplaceLicense } from '@/lib/billing/aws-marketplace/application/use-cases'
import {
  AWS_MARKETPLACE_CLAIM_COOKIE,
  serializeClaimCookie,
} from '@/lib/billing/aws-marketplace/claim'

export const POST = defineInternalJsonRoute({
  contract: linkAwsMarketplaceLicenseContract,
  operation: linkAwsMarketplaceLicense.operation,
  useCase: linkAwsMarketplaceLicense,
  auth: internalSessionAuth,
  rateLimit: internalRateLimits.user({ bucketName: 'aws-marketplace-link' }),
  errorPolicy: internalOrchestrationErrorPolicy,
  staticResponseHeaders: { 'Cache-Control': 'private, no-store' },
  mapInput: ({ body }, { request }) => ({
    organizationId: body.organizationId,
    licenseId: body.licenseId,
    contactEmail: body.contactEmail,
    companyName: body.companyName || null,
    claimToken: request.cookies.get(AWS_MARKETPLACE_CLAIM_COOKIE)?.value ?? null,
  }),
  present: () => ({ success: true as const }),
  /** The claim is spent once the link commits; the cookie that carried it goes with it. */
  finalizeResponse: () => ({ headers: { 'set-cookie': serializeClaimCookie(null) } }),
})
