import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { type NextRequest, NextResponse } from 'next/server'
import { awsMarketplaceRegistrationFormSchema } from '@/lib/api/contracts/aws-marketplace'
import { serializeClaimCookie } from '@/lib/billing/aws-marketplace/claim'
import { isAwsMarketplaceEnabled } from '@/lib/billing/aws-marketplace/config'
import {
  AWS_MARKETPLACE_ONBOARDING_PATH,
  type AwsMarketplaceOnboardingError,
} from '@/lib/billing/aws-marketplace/onboarding'
import { registerAwsMarketplaceBuyer } from '@/lib/billing/aws-marketplace/registration'
import { enforceIpRateLimit, type TokenBucketConfig } from '@/lib/core/rate-limiter'
import { readFormDataWithLimit } from '@/lib/core/utils/stream-limits'
import { getBaseUrl } from '@/lib/core/utils/urls'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'

export const dynamic = 'force-dynamic'

const logger = createLogger('AwsMarketplaceRegisterAPI')

/** The form carries one opaque token; anything larger is not from AWS. */
const MAX_FORM_BYTES = 16 * 1024

const REGISTER_RATE_LIMIT: TokenBucketConfig = {
  maxTokens: 20,
  refillRate: 10,
  refillIntervalMs: 60_000,
}

function redirectToOnboarding(error?: AwsMarketplaceOnboardingError): NextResponse {
  const url = new URL(AWS_MARKETPLACE_ONBOARDING_PATH, getBaseUrl())
  if (error) url.searchParams.set('error', error)
  return NextResponse.redirect(url, 303)
}

async function readRegistrationToken(request: NextRequest): Promise<string | null> {
  const mediaType = request.headers.get('content-type')?.split(';', 1)[0]?.trim().toLowerCase()
  if (mediaType !== 'application/x-www-form-urlencoded') return null
  let form: FormData
  try {
    form = await readFormDataWithLimit(request, {
      maxBytes: MAX_FORM_BYTES,
      label: 'AWS Marketplace registration',
    })
  } catch {
    return null
  }
  const token = form.get('x-amzn-marketplace-token')
  const parsed = awsMarketplaceRegistrationFormSchema.safeParse({
    'x-amzn-marketplace-token': typeof token === 'string' ? token : undefined,
  })
  return parsed.success ? parsed.data['x-amzn-marketplace-token'] : null
}

/**
 * The listing's fulfillment URL. AWS sends the buyer's browser here with a cross-site form POST,
 * so the request carries no Sim session and is authenticated only by the registration token,
 * which ResolveCustomer verifies. The response is always a 303 to the onboarding page, carrying
 * the claim cookie unless the license lapsed. The token is never logged.
 */
export const POST = withRouteHandler(async (request: NextRequest) => {
  if (!isAwsMarketplaceEnabled()) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  try {
    const rateLimited = await enforceIpRateLimit(
      'aws-marketplace-register',
      request,
      REGISTER_RATE_LIMIT
    )
    if (rateLimited) return redirectToOnboarding('unavailable')

    const token = await readRegistrationToken(request)
    if (!token) {
      logger.warn('AWS Marketplace registration arrived without a usable token')
      return redirectToOnboarding('invalid')
    }

    const outcome = await registerAwsMarketplaceBuyer(token)
    if (outcome.kind !== 'claimed') return redirectToOnboarding(outcome.kind)

    const response = redirectToOnboarding()
    response.headers.append('set-cookie', serializeClaimCookie(outcome.claimToken))
    response.headers.set('Cache-Control', 'no-store')
    return response
  } catch (error) {
    logger.error('AWS Marketplace registration failed', { error: getErrorMessage(error) })
    return redirectToOnboarding('unavailable')
  }
})

/** A refresh, back button, or bookmark of the fulfillment URL lands on the onboarding page. */
export const GET = withRouteHandler(async () => {
  if (!isAwsMarketplaceEnabled()) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return redirectToOnboarding()
})
