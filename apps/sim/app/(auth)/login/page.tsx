import { Suspense } from 'react'
import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { getSession } from '@/lib/auth'
import { isAuthDisabled } from '@/lib/core/config/feature-flags'
import { getOAuthProviderStatus } from '@/app/(auth)/components/oauth-provider-checker'
import LoginForm from '@/app/(auth)/login/login-form'

export const metadata: Metadata = {
  title: 'Log In',
}

export const dynamic = 'force-dynamic'

export default async function LoginPage() {
  const session = await getSession()
  if (session?.user || isAuthDisabled) {
    redirect('/workspace')
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
