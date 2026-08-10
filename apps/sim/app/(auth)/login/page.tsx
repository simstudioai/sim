import { Suspense } from 'react'
import type { Metadata } from 'next'
import { isRegistrationDisabled } from '@/lib/core/config/env-flags'
import { getOAuthProviderStatus } from '@/app/(auth)/components/oauth-provider-checker'
import LoginLoading from '@/app/(auth)/login/loading'
import LoginForm from '@/app/(auth)/login/login-form'

export const metadata: Metadata = {
  title: 'Log In',
}

export const dynamic = 'force-dynamic'

export default async function LoginPage() {
  const { githubAvailable, googleAvailable, microsoftAvailable, isProduction } =
    await getOAuthProviderStatus()

  return (
    <Suspense fallback={<LoginLoading />}>
      <LoginForm
        githubAvailable={githubAvailable}
        googleAvailable={googleAvailable}
        microsoftAvailable={microsoftAvailable}
        isProduction={isProduction}
        registrationDisabled={isRegistrationDisabled}
      />
    </Suspense>
  )
}
