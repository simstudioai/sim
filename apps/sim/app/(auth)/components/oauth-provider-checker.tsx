'use server'

import { env } from '@/lib/env'
import { isProd } from '@/lib/environment'

export async function getOAuthProviderStatus() {
  const githubAvailable = !!(
    env.GITHUB_CLIENT_ID &&
    env.GITHUB_CLIENT_SECRET &&
    env.GITHUB_CLIENT_ID !== 'placeholder' &&
    env.GITHUB_CLIENT_SECRET !== 'placeholder'
  )

  const googleAvailable = !!(
    env.GOOGLE_CLIENT_ID &&
    env.GOOGLE_CLIENT_SECRET &&
    env.GOOGLE_CLIENT_ID !== 'placeholder' &&
    env.GOOGLE_CLIENT_SECRET !== 'placeholder'
  )

  return { githubAvailable, googleAvailable, isProduction: isProd }
}
