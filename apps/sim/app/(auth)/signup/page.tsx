import { getOAuthProviderStatus } from '../components/oauth-provider-checker'
import SignupForm from './signup-form'

// Force dynamic rendering to avoid prerender errors with search params
export const dynamic = 'force-dynamic'

export default async function SignupPage() {
  const { githubAvailable, googleAvailable, isProduction } = await getOAuthProviderStatus()

  return (
    <SignupForm
      githubAvailable={githubAvailable}
      googleAvailable={googleAvailable}
      isProduction={isProduction}
    />
  )
}
