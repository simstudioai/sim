import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { getSession } from '@/lib/auth'
import { isAuthDisabled, isRegistrationDisabled } from '@/lib/core/config/feature-flags'
import { validateCallbackUrl } from '@/lib/core/security/input-validation'
import { getOAuthProviderStatus } from '@/app/(auth)/components/oauth-provider-checker'
import SignupForm from '@/app/(auth)/signup/signup-form'

export const metadata: Metadata = {
  title: 'Sign Up',
}

export const dynamic = 'force-dynamic'

export default async function SignupPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const session = await getSession()
  if (session?.user || isAuthDisabled) {
    const resolvedSearchParams = await searchParams
    const callbackUrl =
      typeof resolvedSearchParams.callbackUrl === 'string' &&
      validateCallbackUrl(resolvedSearchParams.callbackUrl)
        ? resolvedSearchParams.callbackUrl
        : '/workspace'
    redirect(callbackUrl)
  }

  if (isRegistrationDisabled) {
    return <div>Registration is disabled, please contact your admin.</div>
  }

  const { githubAvailable, googleAvailable, isProduction } = await getOAuthProviderStatus()

  return (
    <SignupForm
      githubAvailable={githubAvailable}
      googleAvailable={googleAvailable}
      isProduction={isProduction}
    />
  )
}
