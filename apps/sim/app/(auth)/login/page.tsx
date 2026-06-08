import { Suspense } from 'react'
import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { getSession } from '@/lib/auth'
import { isAuthDisabled } from '@/lib/core/config/feature-flags'
import { validateCallbackUrl } from '@/lib/core/security/input-validation'
import { getOAuthProviderStatus } from '@/app/(auth)/components/oauth-provider-checker'
import LoginForm from '@/app/(auth)/login/login-form'

export const metadata: Metadata = {
  title: 'Log In',
}

export const dynamic = 'force-dynamic'

export default async function LoginPage({
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

  const { githubAvailable, googleAvailable, isProduction } = await getOAuthProviderStatus()

  return (
    <Suspense fallback={null}>
      <LoginForm
        githubAvailable={githubAvailable}
        googleAvailable={googleAvailable}
        isProduction={isProduction}
      />
    </Suspense>
  )
}
