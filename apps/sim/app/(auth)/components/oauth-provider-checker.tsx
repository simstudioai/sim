import { env } from '@/lib/core/config/env'
import {
  isGithubAuthDisabled,
  isGoogleAuthDisabled,
  isMicrosoftAuthDisabled,
  isProd,
} from '@/lib/core/config/env-flags'

export async function getOAuthProviderStatus() {
  const githubAvailable =
    !!(env.GITHUB_CLIENT_ID && env.GITHUB_CLIENT_SECRET) && !isGithubAuthDisabled

  const googleAvailable =
    !!(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET) && !isGoogleAuthDisabled

  const microsoftAvailable =
    !!(env.MICROSOFT_CLIENT_ID && env.MICROSOFT_CLIENT_SECRET) && !isMicrosoftAuthDisabled

  return { githubAvailable, googleAvailable, microsoftAvailable, isProduction: isProd }
}
