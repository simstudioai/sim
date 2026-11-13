import { generateId } from '@sim/utils/id'
import type { GenericOAuthConfig } from 'better-auth/plugins'
import { z } from 'zod'
import { readResponseJsonWithLimit } from '@/lib/core/utils/stream-limits'

export const APOLLO_TOKEN_URL = 'https://app.apollo.io/api/v1/oauth/token'

const profileSchema = z.object({
  id: z.string().trim().min(1),
  email: z.email(),
  first_name: z.string().nullish(),
  last_name: z.string().nullish(),
})

/** Moves Better Auth's query into the fragment Apollo's client-side authorize page reads. */
export function formatApolloAuthorizationUrl(value: string): string {
  const url = new URL(value)
  if (
    url.origin !== 'https://app.apollo.io' ||
    url.pathname !== '/' ||
    url.hash !== '#/oauth/authorize'
  ) {
    throw new Error('Invalid Apollo authorization URL')
  }
  const query = url.search
  url.search = ''
  url.hash = `/oauth/authorize${query}`
  return url.toString()
}

/** Connects an Apollo partner app using its documented OAuth and current-user profile endpoints. */
export function createApolloProvider(
  config: Pick<GenericOAuthConfig, 'clientId' | 'clientSecret' | 'redirectURI' | 'scopes'>
): GenericOAuthConfig {
  return {
    ...config,
    providerId: 'apollo',
    authorizationUrl: 'https://app.apollo.io/#/oauth/authorize',
    tokenUrl: APOLLO_TOKEN_URL,
    authentication: 'post',
    getUserInfo: async (tokens) => {
      // boundary-raw-fetch: Apollo's external current-user endpoint verifies the OAuth token's identity.
      const response = await fetch('https://app.apollo.io/api/v1/users/api_profile', {
        headers: { Authorization: `Bearer ${tokens.accessToken}` },
        redirect: 'error',
        signal: AbortSignal.timeout(15_000),
      })
      if (!response.ok) {
        await response.body?.cancel()
        throw new Error(`Apollo user profile request failed with HTTP ${response.status}`)
      }
      let payload: unknown
      try {
        payload = await readResponseJsonWithLimit(response, {
          maxBytes: 64 * 1024,
          label: 'Apollo user profile',
        })
      } catch {
        throw new Error('Invalid Apollo user profile')
      }
      const parsed = profileSchema.safeParse(payload)
      if (!parsed.success) throw new Error('Invalid Apollo user profile')
      const profile = parsed.data
      return {
        id: `${profile.id}-${generateId()}`,
        name: [profile.first_name, profile.last_name].filter(Boolean).join(' ') || profile.email,
        email: profile.email,
        emailVerified: false,
      }
    },
  }
}
