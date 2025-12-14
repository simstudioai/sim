'use server'

import { env } from '@/lib/core/config/env'
import { isProd } from '@/lib/core/config/feature-flags'

export async function getOAuthProviderStatus() {
  const githubAvailable = !!(env.GITHUB_CLIENT_ID && env.GITHUB_CLIENT_SECRET)

  const googleAvailable = !!(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET)

  return { githubAvailable, googleAvailable, isProduction: isProd }
}
