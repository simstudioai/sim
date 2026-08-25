import type { Metadata } from 'next'
import type { SearchParams } from 'nuqs/server'
import { isEmailSignupDisabled, isRegistrationDisabled } from '@/lib/core/config/env-flags'
import { validateCallbackUrl } from '@/lib/core/security/input-validation'
import { isEmailVerificationEffectivelyEnabled } from '@/lib/messaging/email/verification'
import { resolveAuthRedirect } from '@/app/(auth)/auth-redirect'
import { getOAuthProviderStatus } from '@/app/(auth)/components/oauth-provider-checker'
import { RegistrationDisabled } from '@/app/(auth)/signup/registration-disabled'
import { signupSearchParamsCache } from '@/app/(auth)/signup/search-params'
import SignupForm from '@/app/(auth)/signup/signup-form'

export const metadata: Metadata = {
  title: 'Sign Up',
}

export const dynamic = 'force-dynamic'

export default async function SignupPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>
}) {
  if (isRegistrationDisabled) {
    const { redirect, callbackUrl, inviteFlow } = await signupSearchParamsCache.parse(searchParams)
    const { rawCallbackUrl, isInviteFlow } = resolveAuthRedirect({
      redirect,
      callbackUrl,
      inviteFlow,
    })

    return (
      <RegistrationDisabled
        callbackUrl={validateCallbackUrl(rawCallbackUrl) ? rawCallbackUrl : null}
        isInviteFlow={isInviteFlow}
      />
    )
  }

  const { githubAvailable, googleAvailable, microsoftAvailable } = await getOAuthProviderStatus()

  return (
    <SignupForm
      githubAvailable={githubAvailable}
      googleAvailable={googleAvailable}
      microsoftAvailable={microsoftAvailable}
      emailSignupEnabled={!isEmailSignupDisabled}
      emailVerificationEnabled={isEmailVerificationEffectivelyEnabled()}
    />
  )
}
