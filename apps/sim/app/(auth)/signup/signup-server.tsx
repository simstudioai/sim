import { env, isTruthy } from '@/lib/env'
import { isProd } from '@/lib/environment'
import SignupForm from '@/app/(auth)/signup/signup-client'

/**
 * Server component wrapper for signup page
 * Handles server-side OAuth provider and registration checks
 */
export default function SignupServerWrapper() {
  const githubAvailable = !!(env.GITHUB_CLIENT_ID && env.GITHUB_CLIENT_SECRET)
  const googleAvailable = !!(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET)
  const isRegistrationDisabled = isTruthy(env.DISABLE_REGISTRATION)

  if (isRegistrationDisabled) {
    return <div>Registration is disabled, please contact your admin.</div>
  }

  return (
    <SignupForm
      githubAvailable={githubAvailable}
      googleAvailable={googleAvailable}
      isProduction={isProd}
    />
  )
}
