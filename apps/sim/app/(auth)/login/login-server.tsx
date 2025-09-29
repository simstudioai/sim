import { env } from '@/lib/env'
import { isProd } from '@/lib/environment'
import LoginForm from '@/app/(auth)/login/login-client'

/**
 * Server component wrapper for login page
 * Handles server-side OAuth provider checks
 */
export default function LoginServerWrapper() {
  const githubAvailable = !!(env.GITHUB_CLIENT_ID && env.GITHUB_CLIENT_SECRET)
  const googleAvailable = !!(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET)

  return (
    <LoginForm
      githubAvailable={githubAvailable}
      googleAvailable={googleAvailable}
      isProduction={isProd}
    />
  )
}
