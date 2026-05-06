import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import { getAuthProvidersContract } from '@/lib/api/contracts/auth'
import { parseRequest } from '@/lib/api/server'
import { isRegistrationDisabled } from '@/lib/core/config/feature-flags'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { getOAuthProviderStatus } from '@/app/(auth)/components/oauth-provider-checker'

export const dynamic = 'force-dynamic'

export const GET = withRouteHandler(async (request: NextRequest) => {
  const parsed = await parseRequest(getAuthProvidersContract, request, {})
  if (!parsed.success) return parsed.response

  const { githubAvailable, googleAvailable } = await getOAuthProviderStatus()
  return NextResponse.json({
    githubAvailable,
    googleAvailable,
    registrationDisabled: isRegistrationDisabled,
  })
})
