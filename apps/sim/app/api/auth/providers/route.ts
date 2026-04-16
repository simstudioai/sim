import { NextResponse } from 'next/server'
import { isRegistrationDisabled } from '@/lib/core/config/feature-flags'
import { getOAuthProviderStatus } from '@/app/(auth)/components/oauth-provider-checker'

export const dynamic = 'force-dynamic'

export async function GET() {
  const { githubAvailable, googleAvailable } = await getOAuthProviderStatus()
  return NextResponse.json({
    githubAvailable,
    googleAvailable,
    registrationDisabled: isRegistrationDisabled,
  })
}
