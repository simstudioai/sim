import { NextResponse } from 'next/server'
import { isRegistrationDisabled } from '@/lib/core/config/feature-flags'
import { getOAuthProviderStatus } from '@/app/(auth)/components/oauth-provider-checker'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'

export const dynamic = 'force-dynamic'

export const GET = withRouteHandler(async () => {
  const { githubAvailable, googleAvailable } = await getOAuthProviderStatus()
  return NextResponse.json({
    githubAvailable,
    googleAvailable,
    registrationDisabled: isRegistrationDisabled,
  })
})
