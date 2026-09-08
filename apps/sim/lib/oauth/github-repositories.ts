import { generateId } from '@sim/utils/id'
import { getOAuth2Tokens, type OAuth2Tokens } from 'better-auth/oauth2'
import type { GenericOAuthConfig } from 'better-auth/plugins'
import { z } from 'zod'
import { readResponseJsonWithLimit } from '@/lib/core/utils/stream-limits'

export const GITHUB_REPOSITORIES_PROVIDER_ID = 'github-repositories'
export const GITHUB_AUTHORIZATION_URL = 'https://github.com/login/oauth/authorize'
export const GITHUB_TOKEN_URL = 'https://github.com/login/oauth/access_token'

const API_BASE_URL = 'https://api.github.com'
const RESPONSE_MAX_BYTES = 256 * 1024
const REQUEST_TIMEOUT_MS = 10_000
const EMAIL_PAGE_SIZE = 100
const MAX_EMAIL_PAGES = 10

const userSchema = z.object({
  id: z.number().int().positive(),
  login: z.string().min(1),
  type: z.literal('User'),
  name: z.string().nullable().optional(),
  avatar_url: z.url().optional(),
})
const emailsSchema = z.array(
  z.object({ email: z.email(), primary: z.boolean(), verified: z.boolean() })
)
const tokenSchema = z.object({
  access_token: z.string().startsWith('ghu_'),
  refresh_token: z.string().startsWith('ghr_'),
  expires_in: z.number().int().positive(),
  refresh_token_expires_in: z.number().int().positive(),
  token_type: z.literal('bearer'),
  scope: z.literal('').optional(),
})

/** GitHub App user tokens are permission-bound, scopeless, and rotate with their refresh token. */
export function parseGitHubRepositoriesTokenResponse(value: unknown) {
  return tokenSchema.parse(value)
}

/**
 * Reads provider-attested identity; a public profile email never establishes ownership.
 * A managed invitation may match a verified work address even when it is not primary.
 */
export async function verifyGitHubRepositoriesIdentity(
  accessToken: string,
  expectedEmail?: string
) {
  if (!accessToken.startsWith('ghu_')) {
    throw new Error('Connect with a GitHub App user authorization')
  }
  const headers = {
    Accept: 'application/vnd.github+json',
    Authorization: `Bearer ${accessToken}`,
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'Sim',
  }
  async function get(path: string): Promise<unknown> {
    const signal = AbortSignal.timeout(REQUEST_TIMEOUT_MS)
    const response = await fetch(`${API_BASE_URL}${path}`, {
      headers,
      signal,
      redirect: 'error',
    })
    if (!response.ok) {
      await response.body?.cancel()
      throw new Error(`GitHub identity request failed with HTTP ${response.status}`)
    }
    return readResponseJsonWithLimit(response, {
      maxBytes: RESPONSE_MAX_BYTES,
      signal,
      label: 'GitHub identity response',
    })
  }
  const user = userSchema.parse(await get('/user'))
  const normalizedEmail = expectedEmail?.trim().toLowerCase()
  for (let page = 1; page <= MAX_EMAIL_PAGES; page++) {
    const emails = emailsSchema.parse(
      await get(`/user/emails?per_page=${EMAIL_PAGE_SIZE}&page=${page}`)
    )
    const matching = emails.find(
      (entry) =>
        entry.verified &&
        (normalizedEmail ? entry.email.toLowerCase() === normalizedEmail : entry.primary)
    )
    if (matching) {
      return {
        providerSubjectId: String(user.id),
        providerTenantId: null,
        email: matching.email,
        emailVerified: true,
        displayName: user.name || user.login,
        ...(user.avatar_url ? { avatarUrl: user.avatar_url } : {}),
        grantedScopes: [],
      }
    }
    if (emails.length < EMAIL_PAGE_SIZE) break
  }
  throw new Error('GitHub did not verify the required email address')
}

interface GitHubRepositoriesProviderParams {
  clientId: string
  clientSecret: string
  redirectURI: string
}

/** Uses the existing OAuth callback and managed enrollment pipeline with a separate GitHub App. */
export function createGitHubRepositoriesProvider({
  clientId,
  clientSecret,
  redirectURI,
}: GitHubRepositoriesProviderParams): GenericOAuthConfig {
  return {
    providerId: GITHUB_REPOSITORIES_PROVIDER_ID,
    clientId,
    clientSecret,
    authorizationUrl: GITHUB_AUTHORIZATION_URL,
    tokenUrl: GITHUB_TOKEN_URL,
    scopes: [],
    responseType: 'code',
    pkce: true,
    authentication: 'post',
    redirectURI,
    getToken: async ({ code, codeVerifier, redirectURI: callbackURI }) => {
      if (!codeVerifier) throw new Error('GitHub authorization requires a PKCE verifier')
      const signal = AbortSignal.timeout(REQUEST_TIMEOUT_MS)
      const response = await fetch(GITHUB_TOKEN_URL, {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({
          client_id: clientId,
          client_secret: clientSecret,
          code,
          code_verifier: codeVerifier,
          redirect_uri: callbackURI,
        }),
        signal,
        redirect: 'error',
      })
      if (!response.ok) {
        await response.body?.cancel()
        throw new Error(`GitHub authorization failed with HTTP ${response.status}`)
      }
      const data = parseGitHubRepositoriesTokenResponse(
        await readResponseJsonWithLimit(response, {
          maxBytes: RESPONSE_MAX_BYTES,
          signal,
          label: 'GitHub token response',
        })
      )
      return getOAuth2Tokens(data)
    },
    getUserInfo: async (tokens: OAuth2Tokens) => {
      const identity = await verifyGitHubRepositoriesIdentity(tokens.accessToken ?? '')
      const now = new Date()
      return {
        id: `${identity.providerSubjectId}-${generateId()}`,
        name: identity.displayName,
        email: identity.email,
        emailVerified: true,
        image: identity.avatarUrl,
        createdAt: now,
        updatedAt: now,
      }
    },
  }
}
