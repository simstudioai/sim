import { env } from '@/lib/core/config/env'
import { isGithubAuthDisabled, isGoogleAuthDisabled, isProd } from '@/lib/core/config/feature-flags'

export async function getOAuthProviderStatus() {
  const githubAvailable =
    !!(env.GITHUB_CLIENT_ID && env.GITHUB_CLIENT_SECRET) && !isGithubAuthDisabled

  const googleAvailable =
    !!(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET) && !isGoogleAuthDisabled

  return { githubAvailable, googleAvailable, isProduction: isProd }
}
