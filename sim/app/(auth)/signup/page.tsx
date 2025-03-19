import { getOAuthProviderStatus } from '../components/oauth-provider-checker'
import SignupForm from './signup-form'

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
