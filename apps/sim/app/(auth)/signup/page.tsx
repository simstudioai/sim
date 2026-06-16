import type { Metadata } from 'next'
import { isEmailSignupDisabled, isRegistrationDisabled } from '@/lib/core/config/env-flags'
import { getOAuthProviderStatus } from '@/app/(auth)/components/oauth-provider-checker'
import SignupForm from '@/app/(auth)/signup/signup-form'

export const metadata: Metadata = {
  title: 'Sign Up',
}

export const dynamic = 'force-dynamic'

export default async function SignupPage() {
  if (isRegistrationDisabled) {
    return <div>Registration is disabled, please contact your admin.</div>
  }

  const { githubAvailable, googleAvailable, microsoftAvailable, isProduction } =
    await getOAuthProviderStatus()

  return (
    <SignupForm
      githubAvailable={githubAvailable}
      googleAvailable={googleAvailable}
      microsoftAvailable={microsoftAvailable}
      isProduction={isProduction}
      emailSignupEnabled={!isEmailSignupDisabled}
    />
  )
}
