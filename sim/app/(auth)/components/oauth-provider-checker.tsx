'use server'

import { isProd } from '@/lib/environment'

export async function getOAuthProviderStatus() {
  const githubAvailable = !!(
    process.env.GITHUB_CLIENT_ID &&
    process.env.GITHUB_CLIENT_SECRET &&
    process.env.GITHUB_CLIENT_ID !== 'placeholder' &&
    process.env.GITHUB_CLIENT_SECRET !== 'placeholder'
  )

  const googleAvailable = !!(
    process.env.GOOGLE_CLIENT_ID &&
    process.env.GOOGLE_CLIENT_SECRET &&
    process.env.GOOGLE_CLIENT_ID !== 'placeholder' &&
    process.env.GOOGLE_CLIENT_SECRET !== 'placeholder'
  )

  return { githubAvailable, googleAvailable, isProduction: isProd }
}
