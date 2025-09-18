import { env, isTruthy } from '@/lib/env'
import { getOAuthProviderStatus } from '@/app/(auth)/components/oauth-provider-checker'
import SignupForm from '@/app/(auth)/signup/signup-form'

export const dynamic = 'force-dynamic'

export default async function SignupPage() {
  const { githubAvailable, googleAvailable, isProduction } = await getOAuthProviderStatus()

  if (isTruthy(env.DISABLE_REGISTRATION)) {
    return <div>Registration is disabled, please contact your admin.</div>
  }

  return (
    <SignupForm
      githubAvailable={githubAvailable}
      googleAvailable={googleAvailable}
      isProduction={isProduction}
    />
  )
}
