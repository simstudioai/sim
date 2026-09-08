import { createHash } from 'crypto'
import { createLogger } from '@sim/logger'
import { toError } from '@sim/utils/errors'
import { generateId } from '@sim/utils/id'
import { isRecordLike } from '@sim/utils/object'
import { getOAuthState } from 'better-auth/api'
import { getOAuth2Tokens } from 'better-auth/oauth2'
import type { GenericOAuthConfig } from 'better-auth/plugins'
import { syntheticConnectorEmail } from '@/lib/auth/connector-email'
import { env } from '@/lib/core/config/env'
import { inspectConfiguredOAuthClient } from '@/lib/core/config/env-capabilities.server'
import {
  DEFAULT_MAX_ERROR_BODY_BYTES,
  readResponseJsonWithLimit,
  readResponseTextWithLimit,
} from '@/lib/core/utils/stream-limits'
import { getBaseUrl } from '@/lib/core/utils/urls'
import { getDocusignOAuthUrl } from '@/lib/oauth/docusign'
import { createGitHubRepositoriesProvider } from '@/lib/oauth/github-repositories'
import { getMicrosoftUserInfoFromIdToken } from '@/lib/oauth/microsoft'
import {
  assertMicrosoftDataverseLegacyOAuthCallbackScopes,
  bindMicrosoftDataverseEnvironmentToUserInfo,
  getBoundMicrosoftDataverseEnvironment,
  resolveMicrosoftDataverseOAuthCallbackScopes,
} from '@/lib/oauth/microsoft-dataverse'
import {
  exchangeMondayAuthorizationCode,
  MONDAY_OAUTH_AUTHORIZATION_URL,
  MONDAY_OAUTH_TOKEN_URL,
} from '@/lib/oauth/monday'
import { SALESFORCE_LOGIN_HOSTS } from '@/lib/oauth/salesforce'
import { getCanonicalScopesForProvider } from '@/lib/oauth/utils'
import { MONDAY_API_URL, MONDAY_API_VERSION } from '@/tools/monday/utils'
import { REDDIT_USER_AGENT } from '@/tools/reddit/constants'
import { deriveZohoDeskBaseFromApiDomain } from '@/tools/zoho_desk/host-allowlist'

/**
 * Third-party connector definitions for Better Auth's `genericOAuth` plugin.
 *
 * These are the OAuth apps a workspace connects *tools* to — Gmail, Jira,
 * Slack and the rest — as distinct from the handful of providers used to sign
 * in to Sim itself, which stay in `socialProviders` in `lib/auth/auth.ts`.
 *
 * They live here rather than in `auth.ts` because each entry carries real
 * per-provider logic — a `getUserInfo` fetch, its response shape, and its error
 * handling — and in aggregate that buried the auth configuration itself.
 */

/**
 * Scoped `'Auth'` rather than something module-specific: these log lines
 * predate this file, and renaming the scope would silently break every existing
 * log query and alert that matches on it.
 */
const logger = createLogger('Auth')

/**
 * Shape of `GET https://api.notion.com/v1/users/me` for an OAuth integration token.
 * @see https://developers.notion.com/reference/get-self
 */
interface NotionSelfResponse {
  id: string
  name?: string | null
  bot?: {
    owner?:
      | { type: 'user'; user?: { id: string; name?: string | null; person?: { email?: string } } }
      | { type: 'workspace'; workspace: true }
  }
}

/**
 * Shape of `GET https://api.attio.com/v2/self` (the Identify endpoint).
 * @see https://docs.attio.com/rest-api/endpoint-reference/meta/identify
 */
interface AttioSelfResponse {
  active?: boolean
  authorized_by_workspace_member_id?: string | null
  workspace_id?: string
  workspace_name?: string
}

/**
 * Shape of `GET https://api.attio.com/v2/workspace_members/{id}`.
 * @see https://docs.attio.com/rest-api/endpoint-reference/workspace-members/get-a-workspace-member
 */
interface AttioWorkspaceMemberResponse {
  data?: {
    id: { workspace_id: string; workspace_member_id: string }
    first_name?: string | null
    last_name?: string | null
    email_address?: string | null
    avatar_url?: string | null
  }
}

interface MondayUserInfoResponse {
  data?: {
    me?: {
      id?: string | number
      name?: string | null
      email?: string | null
    } | null
  }
  errors?: unknown[]
}

/**
 * Shape of `GET https://api.bitbucket.org/2.0/user` for the authenticated user.
 * @see https://developer.atlassian.com/cloud/bitbucket/rest/api-group-users/#api-user-get
 */
interface BitbucketCurrentUserResponse {
  account_id?: string | null
  uuid?: string | null
  display_name?: string | null
  nickname?: string | null
  links?: {
    avatar?: {
      href?: string | null
    }
  }
}

/**
 * Builds a Salesforce connector bound to one login host — `genericOAuth` takes
 * static endpoints, so each authorization server needs its own registration.
 * See {@link SALESFORCE_LOGIN_HOSTS} for why there are two.
 */
function salesforceConnector(providerId: string, loginHost: string): GenericOAuthConfig {
  const userInfoUrl = `https://${loginHost}/services/oauth2/userinfo`
  return {
    providerId,
    clientId: env.SALESFORCE_CLIENT_ID as string,
    clientSecret: env.SALESFORCE_CLIENT_SECRET as string,
    authorizationUrl: `https://${loginHost}/services/oauth2/authorize`,
    tokenUrl: `https://${loginHost}/services/oauth2/token`,
    userInfoUrl,
    scopes: getCanonicalScopesForProvider('salesforce'),
    pkce: true,
    prompt: 'consent',
    accessType: 'offline',
    redirectURI: `${getBaseUrl()}/api/auth/oauth2/callback/${providerId}`,
    getUserInfo: async (tokens) => {
      try {
        const response = await fetch(userInfoUrl, {
          headers: {
            Authorization: `Bearer ${tokens.accessToken}`,
          },
        })

        if (!response.ok) {
          await response.text().catch(() => {})
          logger.error('Failed to fetch Salesforce user info', {
            status: response.status,
            providerId,
          })
          throw new Error('Failed to fetch user info')
        }

        const data = await response.json()

        return {
          id: `${(data.user_id || data.sub).toString()}-${generateId()}`,
          name: data.name || 'Salesforce User',
          email: data.email || syntheticConnectorEmail(providerId, data.user_id ?? data.sub),
          emailVerified: data.email_verified === true,
          image: data.picture || undefined,
          createdAt: new Date(),
          updatedAt: new Date(),
        }
      } catch (error) {
        logger.error('Error creating Salesforce user profile:', { error, providerId })
        return null
      }
    },
  }
}

/**
 * Builds the connector list, evaluated once when `betterAuth()` constructs the
 * auth instance — the same point the array was built at when it was inline.
 *
 * A function rather than a module-level constant so that importing this module
 * never on its own requires a configured environment: the entries call
 * `getBaseUrl()`, which throws when `NEXT_PUBLIC_APP_URL` is unset. That keeps
 * the module importable in isolation, by a unit test or a script enumerating
 * provider ids, without booting the whole auth configuration.
 *
 * The explicit `GenericOAuthConfig[]` return type is load-bearing: inline, the
 * entries were contextually typed by the `config` property they were assigned
 * to. Without the annotation the literals widen (`prompt: string` stops
 * matching its union) and every `getUserInfo` parameter becomes implicitly
 * `any`.
 */
export function buildConnectorProviders(): GenericOAuthConfig[] {
  const providers: GenericOAuthConfig[] = [
    createGitHubRepositoriesProvider({
      clientId: env.GITHUB_APP_CLIENT_ID as string,
      clientSecret: env.GITHUB_APP_CLIENT_SECRET as string,
      redirectURI: `${getBaseUrl()}/api/auth/oauth2/callback/github-repositories`,
    }),
    {
      providerId: 'google-email',
      clientId: env.GOOGLE_CLIENT_ID as string,
      clientSecret: env.GOOGLE_CLIENT_SECRET as string,
      discoveryUrl: 'https://accounts.google.com/.well-known/openid-configuration',
      accessType: 'offline',
      scopes: getCanonicalScopesForProvider('google-email'),
      prompt: 'consent',
      redirectURI: `${getBaseUrl()}/api/auth/oauth2/callback/google-email`,
      getUserInfo: async (tokens) => {
        try {
          const response = await fetch('https://openidconnect.googleapis.com/v1/userinfo', {
            headers: { Authorization: `Bearer ${tokens.accessToken}` },
          })
          if (!response.ok) {
            await response.text().catch(() => {})
            logger.error('Failed to fetch Google user info', { status: response.status })
            throw new Error(`Failed to fetch Google user info: ${response.statusText}`)
          }
          const profile = await response.json()
          const now = new Date()
          return {
            id: `${profile.sub}-${generateId()}`,
            name: profile.name || 'Google User',
            email: profile.email,
            image: profile.picture || undefined,
            emailVerified: profile.email_verified || false,
            createdAt: now,
            updatedAt: now,
          }
        } catch (error) {
          logger.error('Error in Google getUserInfo', { error })
          throw error
        }
      },
    },
    {
      providerId: 'google-calendar',
      clientId: env.GOOGLE_CLIENT_ID as string,
      clientSecret: env.GOOGLE_CLIENT_SECRET as string,
      discoveryUrl: 'https://accounts.google.com/.well-known/openid-configuration',
      accessType: 'offline',
      scopes: getCanonicalScopesForProvider('google-calendar'),
      prompt: 'consent',
      redirectURI: `${getBaseUrl()}/api/auth/oauth2/callback/google-calendar`,
      getUserInfo: async (tokens) => {
        try {
          const response = await fetch('https://openidconnect.googleapis.com/v1/userinfo', {
            headers: { Authorization: `Bearer ${tokens.accessToken}` },
          })
          if (!response.ok) {
            await response.text().catch(() => {})
            logger.error('Failed to fetch Google user info', { status: response.status })
            throw new Error(`Failed to fetch Google user info: ${response.statusText}`)
          }
          const profile = await response.json()
          const now = new Date()
          return {
            id: `${profile.sub}-${generateId()}`,
            name: profile.name || 'Google User',
            email: profile.email,
            image: profile.picture || undefined,
            emailVerified: profile.email_verified || false,
            createdAt: now,
            updatedAt: now,
          }
        } catch (error) {
          logger.error('Error in Google getUserInfo', { error })
          throw error
        }
      },
    },
    {
      providerId: 'google-drive',
      clientId: env.GOOGLE_CLIENT_ID as string,
      clientSecret: env.GOOGLE_CLIENT_SECRET as string,
      discoveryUrl: 'https://accounts.google.com/.well-known/openid-configuration',
      accessType: 'offline',
      scopes: getCanonicalScopesForProvider('google-drive'),
      prompt: 'consent',
      redirectURI: `${getBaseUrl()}/api/auth/oauth2/callback/google-drive`,
      getUserInfo: async (tokens) => {
        try {
          const response = await fetch('https://openidconnect.googleapis.com/v1/userinfo', {
            headers: { Authorization: `Bearer ${tokens.accessToken}` },
          })
          if (!response.ok) {
            await response.text().catch(() => {})
            logger.error('Failed to fetch Google user info', { status: response.status })
            throw new Error(`Failed to fetch Google user info: ${response.statusText}`)
          }
          const profile = await response.json()
          const now = new Date()
          return {
            id: `${profile.sub}-${generateId()}`,
            name: profile.name || 'Google User',
            email: profile.email,
            image: profile.picture || undefined,
            emailVerified: profile.email_verified || false,
            createdAt: now,
            updatedAt: now,
          }
        } catch (error) {
          logger.error('Error in Google getUserInfo', { error })
          throw error
        }
      },
    },
    {
      providerId: 'google-docs',
      clientId: env.GOOGLE_CLIENT_ID as string,
      clientSecret: env.GOOGLE_CLIENT_SECRET as string,
      discoveryUrl: 'https://accounts.google.com/.well-known/openid-configuration',
      accessType: 'offline',
      scopes: getCanonicalScopesForProvider('google-docs'),
      prompt: 'consent',
      redirectURI: `${getBaseUrl()}/api/auth/oauth2/callback/google-docs`,
      getUserInfo: async (tokens) => {
        try {
          const response = await fetch('https://openidconnect.googleapis.com/v1/userinfo', {
            headers: { Authorization: `Bearer ${tokens.accessToken}` },
          })
          if (!response.ok) {
            await response.text().catch(() => {})
            logger.error('Failed to fetch Google user info', { status: response.status })
            throw new Error(`Failed to fetch Google user info: ${response.statusText}`)
          }
          const profile = await response.json()
          const now = new Date()
          return {
            id: `${profile.sub}-${generateId()}`,
            name: profile.name || 'Google User',
            email: profile.email,
            image: profile.picture || undefined,
            emailVerified: profile.email_verified || false,
            createdAt: now,
            updatedAt: now,
          }
        } catch (error) {
          logger.error('Error in Google getUserInfo', { error })
          throw error
        }
      },
    },
    {
      providerId: 'google-sheets',
      clientId: env.GOOGLE_CLIENT_ID as string,
      clientSecret: env.GOOGLE_CLIENT_SECRET as string,
      discoveryUrl: 'https://accounts.google.com/.well-known/openid-configuration',
      accessType: 'offline',
      scopes: getCanonicalScopesForProvider('google-sheets'),
      prompt: 'consent',
      redirectURI: `${getBaseUrl()}/api/auth/oauth2/callback/google-sheets`,
      getUserInfo: async (tokens) => {
        try {
          const response = await fetch('https://openidconnect.googleapis.com/v1/userinfo', {
            headers: { Authorization: `Bearer ${tokens.accessToken}` },
          })
          if (!response.ok) {
            await response.text().catch(() => {})
            logger.error('Failed to fetch Google user info', { status: response.status })
            throw new Error(`Failed to fetch Google user info: ${response.statusText}`)
          }
          const profile = await response.json()
          const now = new Date()
          return {
            id: `${profile.sub}-${generateId()}`,
            name: profile.name || 'Google User',
            email: profile.email,
            image: profile.picture || undefined,
            emailVerified: profile.email_verified || false,
            createdAt: now,
            updatedAt: now,
          }
        } catch (error) {
          logger.error('Error in Google getUserInfo', { error })
          throw error
        }
      },
    },

    {
      providerId: 'google-contacts',
      clientId: env.GOOGLE_CLIENT_ID as string,
      clientSecret: env.GOOGLE_CLIENT_SECRET as string,
      discoveryUrl: 'https://accounts.google.com/.well-known/openid-configuration',
      accessType: 'offline',
      scopes: getCanonicalScopesForProvider('google-contacts'),
      prompt: 'consent',
      redirectURI: `${getBaseUrl()}/api/auth/oauth2/callback/google-contacts`,
      getUserInfo: async (tokens) => {
        try {
          const response = await fetch('https://openidconnect.googleapis.com/v1/userinfo', {
            headers: { Authorization: `Bearer ${tokens.accessToken}` },
          })
          if (!response.ok) {
            await response.text().catch(() => {})
            logger.error('Failed to fetch Google user info', { status: response.status })
            throw new Error(`Failed to fetch Google user info: ${response.statusText}`)
          }
          const profile = await response.json()
          const now = new Date()
          return {
            id: `${profile.sub}-${generateId()}`,
            name: profile.name || 'Google User',
            email: profile.email,
            image: profile.picture || undefined,
            emailVerified: profile.email_verified || false,
            createdAt: now,
            updatedAt: now,
          }
        } catch (error) {
          logger.error('Error in Google getUserInfo', { error })
          throw error
        }
      },
    },
    {
      providerId: 'google-forms',
      clientId: env.GOOGLE_CLIENT_ID as string,
      clientSecret: env.GOOGLE_CLIENT_SECRET as string,
      discoveryUrl: 'https://accounts.google.com/.well-known/openid-configuration',
      accessType: 'offline',
      scopes: getCanonicalScopesForProvider('google-forms'),
      prompt: 'consent',
      redirectURI: `${getBaseUrl()}/api/auth/oauth2/callback/google-forms`,
      getUserInfo: async (tokens) => {
        try {
          const response = await fetch('https://openidconnect.googleapis.com/v1/userinfo', {
            headers: { Authorization: `Bearer ${tokens.accessToken}` },
          })
          if (!response.ok) {
            await response.text().catch(() => {})
            logger.error('Failed to fetch Google user info', { status: response.status })
            throw new Error(`Failed to fetch Google user info: ${response.statusText}`)
          }
          const profile = await response.json()
          const now = new Date()
          return {
            id: `${profile.sub}-${generateId()}`,
            name: profile.name || 'Google User',
            email: profile.email,
            image: profile.picture || undefined,
            emailVerified: profile.email_verified || false,
            createdAt: now,
            updatedAt: now,
          }
        } catch (error) {
          logger.error('Error in Google getUserInfo', { error })
          throw error
        }
      },
    },
    {
      providerId: 'google-ads',
      clientId: env.GOOGLE_CLIENT_ID as string,
      clientSecret: env.GOOGLE_CLIENT_SECRET as string,
      discoveryUrl: 'https://accounts.google.com/.well-known/openid-configuration',
      accessType: 'offline',
      scopes: getCanonicalScopesForProvider('google-ads'),
      prompt: 'consent',
      redirectURI: `${getBaseUrl()}/api/auth/oauth2/callback/google-ads`,
      getUserInfo: async (tokens) => {
        try {
          const response = await fetch('https://openidconnect.googleapis.com/v1/userinfo', {
            headers: { Authorization: `Bearer ${tokens.accessToken}` },
          })
          if (!response.ok) {
            logger.error('Failed to fetch Google user info', { status: response.status })
            throw new Error(`Failed to fetch Google user info: ${response.statusText}`)
          }
          const profile = await response.json()
          const now = new Date()
          return {
            id: `${profile.sub}-${generateId()}`,
            name: profile.name || 'Google User',
            email: profile.email,
            image: profile.picture || undefined,
            emailVerified: profile.email_verified || false,
            createdAt: now,
            updatedAt: now,
          }
        } catch (error) {
          logger.error('Error in Google getUserInfo', { error })
          throw error
        }
      },
    },
    {
      providerId: 'google-bigquery',
      clientId: env.GOOGLE_CLIENT_ID as string,
      clientSecret: env.GOOGLE_CLIENT_SECRET as string,
      discoveryUrl: 'https://accounts.google.com/.well-known/openid-configuration',
      accessType: 'offline',
      scopes: getCanonicalScopesForProvider('google-bigquery'),
      prompt: 'consent',
      redirectURI: `${getBaseUrl()}/api/auth/oauth2/callback/google-bigquery`,
      getUserInfo: async (tokens) => {
        try {
          const response = await fetch('https://openidconnect.googleapis.com/v1/userinfo', {
            headers: { Authorization: `Bearer ${tokens.accessToken}` },
          })
          if (!response.ok) {
            await response.text().catch(() => {})
            logger.error('Failed to fetch Google user info', { status: response.status })
            throw new Error(`Failed to fetch Google user info: ${response.statusText}`)
          }
          const profile = await response.json()
          const now = new Date()
          return {
            id: `${profile.sub}-${generateId()}`,
            name: profile.name || 'Google User',
            email: profile.email,
            image: profile.picture || undefined,
            emailVerified: profile.email_verified || false,
            createdAt: now,
            updatedAt: now,
          }
        } catch (error) {
          logger.error('Error in Google getUserInfo', { error })
          throw error
        }
      },
    },

    {
      providerId: 'google-vault',
      clientId: env.GOOGLE_CLIENT_ID as string,
      clientSecret: env.GOOGLE_CLIENT_SECRET as string,
      discoveryUrl: 'https://accounts.google.com/.well-known/openid-configuration',
      accessType: 'offline',
      scopes: getCanonicalScopesForProvider('google-vault'),
      prompt: 'consent',
      redirectURI: `${getBaseUrl()}/api/auth/oauth2/callback/google-vault`,
      getUserInfo: async (tokens) => {
        try {
          const response = await fetch('https://openidconnect.googleapis.com/v1/userinfo', {
            headers: { Authorization: `Bearer ${tokens.accessToken}` },
          })
          if (!response.ok) {
            await response.text().catch(() => {})
            logger.error('Failed to fetch Google user info', { status: response.status })
            throw new Error(`Failed to fetch Google user info: ${response.statusText}`)
          }
          const profile = await response.json()
          const now = new Date()
          return {
            id: `${profile.sub}-${generateId()}`,
            name: profile.name || 'Google User',
            email: profile.email,
            image: profile.picture || undefined,
            emailVerified: profile.email_verified || false,
            createdAt: now,
            updatedAt: now,
          }
        } catch (error) {
          logger.error('Error in Google getUserInfo', { error })
          throw error
        }
      },
    },

    {
      providerId: 'google-groups',
      clientId: env.GOOGLE_CLIENT_ID as string,
      clientSecret: env.GOOGLE_CLIENT_SECRET as string,
      discoveryUrl: 'https://accounts.google.com/.well-known/openid-configuration',
      accessType: 'offline',
      scopes: getCanonicalScopesForProvider('google-groups'),
      prompt: 'consent',
      redirectURI: `${getBaseUrl()}/api/auth/oauth2/callback/google-groups`,
      getUserInfo: async (tokens) => {
        try {
          const response = await fetch('https://openidconnect.googleapis.com/v1/userinfo', {
            headers: { Authorization: `Bearer ${tokens.accessToken}` },
          })
          if (!response.ok) {
            await response.text().catch(() => {})
            logger.error('Failed to fetch Google user info', { status: response.status })
            throw new Error(`Failed to fetch Google user info: ${response.statusText}`)
          }
          const profile = await response.json()
          const now = new Date()
          return {
            id: `${profile.sub}-${generateId()}`,
            name: profile.name || 'Google User',
            email: profile.email,
            image: profile.picture || undefined,
            emailVerified: profile.email_verified || false,
            createdAt: now,
            updatedAt: now,
          }
        } catch (error) {
          logger.error('Error in Google getUserInfo', { error })
          throw error
        }
      },
    },

    {
      providerId: 'google-chat',
      clientId: env.GOOGLE_CLIENT_ID as string,
      clientSecret: env.GOOGLE_CLIENT_SECRET as string,
      discoveryUrl: 'https://accounts.google.com/.well-known/openid-configuration',
      accessType: 'offline',
      scopes: getCanonicalScopesForProvider('google-chat'),
      prompt: 'consent',
      redirectURI: `${getBaseUrl()}/api/auth/oauth2/callback/google-chat`,
      getUserInfo: async (tokens) => {
        try {
          const response = await fetch('https://openidconnect.googleapis.com/v1/userinfo', {
            headers: { Authorization: `Bearer ${tokens.accessToken}` },
          })
          if (!response.ok) {
            await response.text().catch(() => {})
            logger.error('Failed to fetch Google user info', { status: response.status })
            throw new Error(`Failed to fetch Google user info: ${response.statusText}`)
          }
          const profile = await response.json()
          const now = new Date()
          return {
            id: `${profile.sub}-${generateId()}`,
            name: profile.name || 'Google User',
            email: profile.email,
            image: profile.picture || undefined,
            emailVerified: profile.email_verified || false,
            createdAt: now,
            updatedAt: now,
          }
        } catch (error) {
          logger.error('Error in Google getUserInfo', { error })
          throw error
        }
      },
    },

    {
      providerId: 'google-meet',
      clientId: env.GOOGLE_CLIENT_ID as string,
      clientSecret: env.GOOGLE_CLIENT_SECRET as string,
      discoveryUrl: 'https://accounts.google.com/.well-known/openid-configuration',
      accessType: 'offline',
      scopes: getCanonicalScopesForProvider('google-meet'),
      prompt: 'consent',
      redirectURI: `${getBaseUrl()}/api/auth/oauth2/callback/google-meet`,
      getUserInfo: async (tokens) => {
        try {
          const response = await fetch('https://openidconnect.googleapis.com/v1/userinfo', {
            headers: { Authorization: `Bearer ${tokens.accessToken}` },
          })
          if (!response.ok) {
            await response.text().catch(() => {})
            logger.error('Failed to fetch Google user info', { status: response.status })
            throw new Error(`Failed to fetch Google user info: ${response.statusText}`)
          }
          const profile = await response.json()
          const now = new Date()
          return {
            id: `${profile.sub}-${generateId()}`,
            name: profile.name || 'Google User',
            email: profile.email,
            image: profile.picture || undefined,
            emailVerified: profile.email_verified || false,
            createdAt: now,
            updatedAt: now,
          }
        } catch (error) {
          logger.error('Error in Google getUserInfo', { error })
          throw error
        }
      },
    },
    {
      providerId: 'google-tasks',
      clientId: env.GOOGLE_CLIENT_ID as string,
      clientSecret: env.GOOGLE_CLIENT_SECRET as string,
      discoveryUrl: 'https://accounts.google.com/.well-known/openid-configuration',
      accessType: 'offline',
      scopes: getCanonicalScopesForProvider('google-tasks'),
      prompt: 'consent',
      redirectURI: `${getBaseUrl()}/api/auth/oauth2/callback/google-tasks`,
      getUserInfo: async (tokens) => {
        try {
          const response = await fetch('https://openidconnect.googleapis.com/v1/userinfo', {
            headers: { Authorization: `Bearer ${tokens.accessToken}` },
          })
          if (!response.ok) {
            await response.text().catch(() => {})
            logger.error('Failed to fetch Google user info', { status: response.status })
            throw new Error(`Failed to fetch Google user info: ${response.statusText}`)
          }
          const profile = await response.json()
          const now = new Date()
          return {
            id: `${profile.sub}-${generateId()}`,
            name: profile.name || 'Google User',
            email: profile.email,
            image: profile.picture || undefined,
            emailVerified: profile.email_verified || false,
            createdAt: now,
            updatedAt: now,
          }
        } catch (error) {
          logger.error('Error in Google getUserInfo', { error })
          throw error
        }
      },
    },

    {
      providerId: 'vertex-ai',
      clientId: env.GOOGLE_CLIENT_ID as string,
      clientSecret: env.GOOGLE_CLIENT_SECRET as string,
      discoveryUrl: 'https://accounts.google.com/.well-known/openid-configuration',
      accessType: 'offline',
      scopes: getCanonicalScopesForProvider('vertex-ai'),
      prompt: 'consent',
      redirectURI: `${getBaseUrl()}/api/auth/oauth2/callback/vertex-ai`,
      getUserInfo: async (tokens) => {
        try {
          const response = await fetch('https://openidconnect.googleapis.com/v1/userinfo', {
            headers: { Authorization: `Bearer ${tokens.accessToken}` },
          })
          if (!response.ok) {
            await response.text().catch(() => {})
            logger.error('Failed to fetch Google user info', { status: response.status })
            throw new Error(`Failed to fetch Google user info: ${response.statusText}`)
          }
          const profile = await response.json()
          const now = new Date()
          return {
            id: `${profile.sub}-${generateId()}`,
            name: profile.name || 'Google User',
            email: profile.email,
            image: profile.picture || undefined,
            emailVerified: profile.email_verified || false,
            createdAt: now,
            updatedAt: now,
          }
        } catch (error) {
          logger.error('Error in Google getUserInfo', { error })
          throw error
        }
      },
    },

    {
      providerId: 'microsoft-ad',
      clientId: env.MICROSOFT_CLIENT_ID as string,
      clientSecret: env.MICROSOFT_CLIENT_SECRET as string,
      authorizationUrl: 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize',
      tokenUrl: 'https://login.microsoftonline.com/common/oauth2/v2.0/token',
      userInfoUrl: 'https://graph.microsoft.com/v1.0/me',
      scopes: getCanonicalScopesForProvider('microsoft-ad'),
      responseType: 'code',
      accessType: 'offline',
      authentication: 'basic',
      pkce: true,
      redirectURI: `${getBaseUrl()}/api/auth/oauth2/callback/microsoft-ad`,
      getUserInfo: async (tokens) => {
        return getMicrosoftUserInfoFromIdToken(tokens, 'microsoft-ad')
      },
    },

    {
      providerId: 'microsoft-teams',
      clientId: env.MICROSOFT_CLIENT_ID as string,
      clientSecret: env.MICROSOFT_CLIENT_SECRET as string,
      authorizationUrl: 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize',
      tokenUrl: 'https://login.microsoftonline.com/common/oauth2/v2.0/token',
      userInfoUrl: 'https://graph.microsoft.com/v1.0/me',
      scopes: getCanonicalScopesForProvider('microsoft-teams'),
      responseType: 'code',
      accessType: 'offline',
      authentication: 'basic',
      pkce: true,
      redirectURI: `${getBaseUrl()}/api/auth/oauth2/callback/microsoft-teams`,
      getUserInfo: async (tokens) => {
        return getMicrosoftUserInfoFromIdToken(tokens, 'microsoft-teams')
      },
    },

    {
      providerId: 'microsoft-excel',
      clientId: env.MICROSOFT_CLIENT_ID as string,
      clientSecret: env.MICROSOFT_CLIENT_SECRET as string,
      authorizationUrl: 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize',
      tokenUrl: 'https://login.microsoftonline.com/common/oauth2/v2.0/token',
      userInfoUrl: 'https://graph.microsoft.com/v1.0/me',
      scopes: getCanonicalScopesForProvider('microsoft-excel'),
      responseType: 'code',
      accessType: 'offline',
      authentication: 'basic',
      pkce: true,
      redirectURI: `${getBaseUrl()}/api/auth/oauth2/callback/microsoft-excel`,
      getUserInfo: async (tokens) => {
        return getMicrosoftUserInfoFromIdToken(tokens, 'microsoft-excel')
      },
    },
    {
      providerId: 'microsoft-word',
      clientId: env.MICROSOFT_CLIENT_ID as string,
      clientSecret: env.MICROSOFT_CLIENT_SECRET as string,
      authorizationUrl: 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize',
      tokenUrl: 'https://login.microsoftonline.com/common/oauth2/v2.0/token',
      userInfoUrl: 'https://graph.microsoft.com/v1.0/me',
      scopes: getCanonicalScopesForProvider('microsoft-word'),
      responseType: 'code',
      accessType: 'offline',
      authentication: 'basic',
      pkce: true,
      redirectURI: `${getBaseUrl()}/api/auth/oauth2/callback/microsoft-word`,
      getUserInfo: async (tokens) => {
        return getMicrosoftUserInfoFromIdToken(tokens, 'microsoft-word')
      },
    },
    {
      providerId: 'microsoft-dataverse',
      clientId: env.MICROSOFT_CLIENT_ID as string,
      clientSecret: env.MICROSOFT_CLIENT_SECRET as string,
      authorizationUrl: 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize',
      tokenUrl: 'https://login.microsoftonline.com/common/oauth2/v2.0/token',
      userInfoUrl: 'https://graph.microsoft.com/v1.0/me',
      /**
       * Better Auth appends connector scopes to link-request scopes. Dataverse audiences are
       * request-specific, so every allowed link supplies its exact grant and this base stays empty.
       */
      scopes: [],
      responseType: 'code',
      accessType: 'offline',
      authentication: 'basic',
      pkce: true,
      redirectURI: `${getBaseUrl()}/api/auth/oauth2/callback/microsoft-dataverse`,
      getUserInfo: async (tokens) => {
        const oauthState = await getOAuthState()
        const environmentUrl = getBoundMicrosoftDataverseEnvironment(oauthState?.callbackURL)
        if (!environmentUrl) {
          assertMicrosoftDataverseLegacyOAuthCallbackScopes(
            tokens.scopes,
            getCanonicalScopesForProvider('microsoft-dataverse')
          )
          return getMicrosoftUserInfoFromIdToken(tokens, 'microsoft-dataverse')
        }
        tokens.scopes = resolveMicrosoftDataverseOAuthCallbackScopes(
          oauthState?.callbackURL,
          tokens.scopes
        )
        return bindMicrosoftDataverseEnvironmentToUserInfo(
          getMicrosoftUserInfoFromIdToken(tokens, 'microsoft-dataverse'),
          tokens.scopes
        )
      },
    },
    {
      providerId: 'microsoft-planner',
      clientId: env.MICROSOFT_CLIENT_ID as string,
      clientSecret: env.MICROSOFT_CLIENT_SECRET as string,
      authorizationUrl: 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize',
      tokenUrl: 'https://login.microsoftonline.com/common/oauth2/v2.0/token',
      userInfoUrl: 'https://graph.microsoft.com/v1.0/me',
      scopes: getCanonicalScopesForProvider('microsoft-planner'),
      responseType: 'code',
      accessType: 'offline',
      authentication: 'basic',
      pkce: true,
      redirectURI: `${getBaseUrl()}/api/auth/oauth2/callback/microsoft-planner`,
      getUserInfo: async (tokens) => {
        return getMicrosoftUserInfoFromIdToken(tokens, 'microsoft-planner')
      },
    },

    {
      providerId: 'outlook',
      clientId: env.MICROSOFT_CLIENT_ID as string,
      clientSecret: env.MICROSOFT_CLIENT_SECRET as string,
      authorizationUrl: 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize',
      tokenUrl: 'https://login.microsoftonline.com/common/oauth2/v2.0/token',
      userInfoUrl: 'https://graph.microsoft.com/v1.0/me',
      scopes: getCanonicalScopesForProvider('outlook'),
      responseType: 'code',
      accessType: 'offline',
      authentication: 'basic',
      pkce: true,
      redirectURI: `${getBaseUrl()}/api/auth/oauth2/callback/outlook`,
      getUserInfo: async (tokens) => {
        return getMicrosoftUserInfoFromIdToken(tokens, 'outlook')
      },
    },

    {
      providerId: 'onedrive',
      clientId: env.MICROSOFT_CLIENT_ID as string,
      clientSecret: env.MICROSOFT_CLIENT_SECRET as string,
      authorizationUrl: 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize',
      tokenUrl: 'https://login.microsoftonline.com/common/oauth2/v2.0/token',
      userInfoUrl: 'https://graph.microsoft.com/v1.0/me',
      scopes: getCanonicalScopesForProvider('onedrive'),
      responseType: 'code',
      accessType: 'offline',
      authentication: 'basic',
      pkce: true,
      redirectURI: `${getBaseUrl()}/api/auth/oauth2/callback/onedrive`,
      getUserInfo: async (tokens) => {
        return getMicrosoftUserInfoFromIdToken(tokens, 'onedrive')
      },
    },

    {
      providerId: 'sharepoint',
      clientId: env.MICROSOFT_CLIENT_ID as string,
      clientSecret: env.MICROSOFT_CLIENT_SECRET as string,
      authorizationUrl: 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize',
      tokenUrl: 'https://login.microsoftonline.com/common/oauth2/v2.0/token',
      userInfoUrl: 'https://graph.microsoft.com/v1.0/me',
      scopes: getCanonicalScopesForProvider('sharepoint'),
      responseType: 'code',
      accessType: 'offline',
      authentication: 'basic',
      pkce: true,
      redirectURI: `${getBaseUrl()}/api/auth/oauth2/callback/sharepoint`,
      getUserInfo: async (tokens) => {
        return getMicrosoftUserInfoFromIdToken(tokens, 'sharepoint')
      },
    },

    {
      providerId: 'wealthbox',
      clientId: env.WEALTHBOX_CLIENT_ID as string,
      clientSecret: env.WEALTHBOX_CLIENT_SECRET as string,
      authorizationUrl: 'https://app.crmworkspace.com/oauth/authorize',
      tokenUrl: 'https://app.crmworkspace.com/oauth/token',
      userInfoUrl: 'https://api.crmworkspace.com/v1/me',
      scopes: getCanonicalScopesForProvider('wealthbox'),
      responseType: 'code',
      redirectURI: `${getBaseUrl()}/api/auth/oauth2/callback/wealthbox`,
      getUserInfo: async (tokens) => {
        try {
          logger.info('Fetching Wealthbox user profile')

          const response = await fetch('https://api.crmworkspace.com/v1/me', {
            headers: {
              Authorization: `Bearer ${tokens.accessToken}`,
            },
          })

          const now = new Date()

          if (response.ok) {
            const data = await response.json()
            const userId = data.id?.toString()
            if (!userId) {
              return null
            }
            const email =
              data.email && typeof data.email === 'string'
                ? data.email
                : syntheticConnectorEmail('wealthbox', userId)
            const name = data.name || data.full_name || data.username || 'Wealthbox User'

            return {
              id: `wealthbox-${userId}-${generateId()}`,
              name,
              email,
              emailVerified: false,
              createdAt: now,
              updatedAt: now,
            }
          }

          // Fallback: derive a stable identifier from the refresh token (long-lived)
          // rather than the access token (rotates every ~2 hours) to avoid creating
          // duplicate accounts on token refresh.
          logger.warn('Wealthbox user info fetch failed, falling back to token-derived identity', {
            status: response.status,
          })
          const stableToken = tokens.refreshToken ?? tokens.accessToken
          if (!stableToken) {
            logger.error('Wealthbox fallback identity: no refresh or access token available')
            return null
          }
          const tokenHash = createHash('sha256').update(stableToken).digest('hex').slice(0, 24)
          return {
            id: `wealthbox-${tokenHash}-${generateId()}`,
            name: 'Wealthbox User',
            email: syntheticConnectorEmail('wealthbox', tokenHash),
            emailVerified: false,
            createdAt: now,
            updatedAt: now,
          }
        } catch (error) {
          logger.error('Error creating Wealthbox user profile:', {
            error: toError(error).message,
          })
          return null
        }
      },
    },

    {
      providerId: 'pipedrive',
      clientId: env.PIPEDRIVE_CLIENT_ID as string,
      clientSecret: env.PIPEDRIVE_CLIENT_SECRET as string,
      authorizationUrl: 'https://oauth.pipedrive.com/oauth/authorize',
      tokenUrl: 'https://oauth.pipedrive.com/oauth/token',
      userInfoUrl: 'https://api.pipedrive.com/v1/users/me',
      prompt: 'consent',
      scopes: getCanonicalScopesForProvider('pipedrive'),
      responseType: 'code',
      redirectURI: `${getBaseUrl()}/api/auth/oauth2/callback/pipedrive`,
      getUserInfo: async (tokens) => {
        try {
          logger.info('Fetching Pipedrive user profile')

          const response = await fetch('https://api.pipedrive.com/v1/users/me', {
            headers: {
              Authorization: `Bearer ${tokens.accessToken}`,
            },
          })

          if (!response.ok) {
            await response.text().catch(() => {})
            logger.error('Failed to fetch Pipedrive user info', {
              status: response.status,
            })
            throw new Error('Failed to fetch user info')
          }

          const data = await response.json()
          const user = data.data

          return {
            id: `${user.id.toString()}-${generateId()}`,
            name: user.name,
            email: user.email,
            emailVerified: user.activated,
            image: user.icon_url,
            createdAt: new Date(),
            updatedAt: new Date(),
          }
        } catch (error) {
          logger.error('Error creating Pipedrive user profile:', { error })
          return null
        }
      },
    },

    {
      providerId: 'hubspot',
      clientId: env.HUBSPOT_CLIENT_ID as string,
      clientSecret: env.HUBSPOT_CLIENT_SECRET as string,
      authorizationUrl: 'https://app.hubspot.com/oauth/authorize',
      tokenUrl: 'https://api.hubapi.com/oauth/v1/token',
      userInfoUrl: 'https://api.hubapi.com/oauth/v1/access-tokens',
      prompt: 'consent',
      scopes: getCanonicalScopesForProvider('hubspot'),
      redirectURI: `${getBaseUrl()}/api/auth/oauth2/callback/hubspot`,
      getUserInfo: async (tokens) => {
        try {
          logger.info('Fetching HubSpot user profile')

          const response = await fetch(
            `https://api.hubapi.com/oauth/v1/access-tokens/${tokens.accessToken}`
          )

          if (!response.ok) {
            let errorBody: string | undefined
            try {
              errorBody = await response.text()
            } catch {
              // ignore
            }
            logger.error('Failed to fetch HubSpot user info', {
              status: response.status,
              statusText: response.statusText,
              body: errorBody?.slice(0, 500),
            })
            throw new Error('Failed to fetch user info')
          }

          const rawText = await response.text()
          const data = JSON.parse(rawText)

          const scopesArray = Array.isArray((data as any)?.scopes) ? (data as any).scopes : []
          if (Array.isArray(scopesArray) && scopesArray.length > 0) {
            tokens.scopes = scopesArray
          } else if (typeof (data as any)?.scope === 'string') {
            tokens.scopes = (data as any).scope.split(/\s+/).filter(Boolean)
          }

          logger.info('HubSpot token metadata response:', {
            hubId: data.hub_id,
            hubDomain: data.hub_domain,
            userId: data.user_id,
            hasScopes: !!data.scopes,
            scopesType: typeof data.scopes,
            scopesIsArray: Array.isArray(data.scopes),
          })

          return {
            id: `${(data.user_id || data.hub_id).toString()}-${generateId()}`,
            name: data.user || 'HubSpot User',
            email: data.user || syntheticConnectorEmail('hubspot', data.hub_id),
            emailVerified: true,
            image: undefined,
            createdAt: new Date(),
            updatedAt: new Date(),
            // Extract scopes from HubSpot's response and convert array to space-delimited string
            // Use 'scope' (singular) as that's what better-auth expects for the account table
            ...(data.scopes && Array.isArray(data.scopes) ? { scope: data.scopes.join(' ') } : {}),
          }
        } catch (error) {
          logger.error('Error creating HubSpot user profile:', { error })
          return null
        }
      },
    },

    ...Object.entries(SALESFORCE_LOGIN_HOSTS).map(([providerId, loginHost]) =>
      salesforceConnector(providerId, loginHost)
    ),

    {
      providerId: 'zoho-desk',
      clientId: env.ZOHO_CLIENT_ID as string,
      clientSecret: env.ZOHO_CLIENT_SECRET as string,
      authorizationUrl: 'https://accounts.zoho.com/oauth/v2/auth',
      tokenUrl: 'https://accounts.zoho.com/oauth/v2/token',
      scopes: getCanonicalScopesForProvider('zoho-desk'),
      responseType: 'code',
      pkce: true,
      accessType: 'offline',
      prompt: 'consent',
      redirectURI: `${getBaseUrl()}/api/auth/oauth2/callback/zoho-desk`,
      // Zoho only issues a refresh token when access_type=offline AND
      // prompt=consent are present on the authorize request, and it expects
      // comma-separated scopes rather than the default space-delimited list.
      authorizationUrlParams: {
        access_type: 'offline',
        prompt: 'consent',
        scope: getCanonicalScopesForProvider('zoho-desk').join(','),
      },
      getToken: async ({ code, redirectURI, codeVerifier }) => {
        const tokenParams = new URLSearchParams({
          client_id: env.ZOHO_CLIENT_ID as string,
          client_secret: env.ZOHO_CLIENT_SECRET as string,
          code,
          grant_type: 'authorization_code',
          redirect_uri: redirectURI,
        })
        // PKCE is enabled, so better-auth sent a code_challenge on the authorize
        // request. The exchange MUST echo the matching code_verifier or Zoho
        // rejects the request shape (invalid_request). Verified by isolating
        // pkce:false (which connected) then restoring pkce:true + this verifier.
        if (codeVerifier) tokenParams.set('code_verifier', codeVerifier)

        const response = await fetch('https://accounts.zoho.com/oauth/v2/token', {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: tokenParams,
        })
        const data = await readResponseJsonWithLimit<Record<string, unknown>>(response, {
          maxBytes: 1024 * 1024,
          label: 'Zoho Desk OAuth token response',
        })

        // Zoho signals OAuth failures in the JSON body, usually with HTTP 200,
        // e.g. { error: 'invalid_code' } or { error: 'invalid_client',
        // error_description: '...' }. The status-only guard therefore never
        // fires, so surface the actual error/description instead of collapsing
        // every failure into one opaque "no access token" string.
        const errorObj = isRecordLike(data)
          ? (data as { error?: unknown; error_description?: unknown })
          : {}
        const zohoError = typeof errorObj.error === 'string' ? errorObj.error : undefined
        const zohoErrorDescription =
          typeof errorObj.error_description === 'string' ? errorObj.error_description : undefined
        if (!response.ok || !data || typeof data !== 'object' || Array.isArray(data) || zohoError) {
          logger.error('Zoho Desk OAuth token exchange failed', {
            status: response.status,
            zohoError: zohoError ?? null,
            zohoErrorDescription: zohoErrorDescription ?? null,
          })
          throw new Error(
            `Zoho Desk OAuth token exchange failed (HTTP ${response.status}${
              zohoError ? `, ${zohoError}` : ''
            }${zohoErrorDescription ? `: ${zohoErrorDescription}` : ''})`
          )
        }

        const tokens = getOAuth2Tokens(data)
        if (!tokens.accessToken) {
          logger.error('Zoho Desk OAuth token response had no access token', {
            status: response.status,
            bodyKeys: Object.keys(data),
          })
          throw new Error('Zoho Desk OAuth token response did not include an access token')
        }

        // Persist the data-center-scoped Desk REST base derived from the
        // token response api_domain so every API call targets the correct
        // host instead of assuming desk.zoho.com. Stored inside the scope
        // string (survives refreshes, which never rewrite scope) and read
        // back in /api/auth/oauth/token as `apiDomain`.
        const deskBase = deriveZohoDeskBaseFromApiDomain(
          typeof data.api_domain === 'string' ? data.api_domain : undefined
        )
        // Zoho's docs are inconsistent about whether the Desk token response
        // carries `scope` (the Mail sample has it; the CRM/Creator samples do
        // not). If it is absent, fall back to the scopes we requested and were
        // granted by completing the flow - otherwise the stored scope list is
        // just the domain marker, and the credential picker would show a
        // permanent "needs update / reconnect" badge on every connection.
        // Mirrors the existing Box fallback in this file.
        const reportedScopes =
          typeof data.scope === 'string' ? data.scope.split(/[\s,]+/).filter(Boolean) : []
        const grantedScopes = reportedScopes.length
          ? reportedScopes
          : getCanonicalScopesForProvider('zoho-desk')
        tokens.scopes = [`__zoho_domain__:${deskBase}`, ...grantedScopes]
        return tokens
      },
      getUserInfo: async (tokens) => {
        try {
          const response = await fetch('https://accounts.zoho.com/oauth/user/info', {
            headers: { Authorization: `Zoho-oauthtoken ${tokens.accessToken}` },
          })

          if (!response.ok) {
            await readResponseTextWithLimit(response, {
              maxBytes: 1024 * 1024,
              label: 'Zoho Desk profile error response',
            }).catch(() => {})
            logger.error('Error fetching Zoho Desk user info:', {
              status: response.status,
              statusText: response.statusText,
            })
            return null
          }

          const profile = await readResponseJsonWithLimit<{
            ZUID?: number | string
            Display_Name?: string
            Email?: string
          }>(response, { maxBytes: 1024 * 1024, label: 'Zoho Desk profile response' })

          const zuid = profile.ZUID?.toString()
          if (!zuid) {
            logger.error('Invalid Zoho Desk profile response:', profile)
            return null
          }

          const now = new Date()
          return {
            id: `${zuid}-${generateId()}`,
            name: profile.Display_Name || 'Zoho User',
            email: profile.Email || syntheticConnectorEmail('zoho', zuid),
            emailVerified: Boolean(profile.Email),
            createdAt: now,
            updatedAt: now,
          }
        } catch (error) {
          logger.error('Error in Zoho Desk getUserInfo:', { error })
          return null
        }
      },
    },

    {
      providerId: 'manageengine-sdp',
      // Shares the Zoho API-console client with zoho-desk: Zoho scopes are
      // chosen per authorization request, not per registered client, so one
      // client serves both products.
      clientId: env.ZOHO_CLIENT_ID as string,
      clientSecret: env.ZOHO_CLIENT_SECRET as string,
      authorizationUrl: 'https://accounts.zoho.com/oauth/v2/auth',
      tokenUrl: 'https://accounts.zoho.com/oauth/v2/token',
      scopes: getCanonicalScopesForProvider('manageengine-sdp'),
      responseType: 'code',
      pkce: true,
      accessType: 'offline',
      prompt: 'consent',
      redirectURI: `${getBaseUrl()}/api/auth/oauth2/callback/manageengine-sdp`,
      // Zoho only issues a refresh token when access_type=offline AND
      // prompt=consent are present on the authorize request, and it expects
      // comma-separated scopes rather than the default space-delimited list.
      authorizationUrlParams: {
        access_type: 'offline',
        prompt: 'consent',
        scope: getCanonicalScopesForProvider('manageengine-sdp').join(','),
      },
      getToken: async ({ code, redirectURI, codeVerifier }) => {
        const tokenParams = new URLSearchParams({
          client_id: env.ZOHO_CLIENT_ID as string,
          client_secret: env.ZOHO_CLIENT_SECRET as string,
          code,
          grant_type: 'authorization_code',
          redirect_uri: redirectURI,
        })
        // PKCE is enabled, so better-auth sent a code_challenge on the authorize
        // request. The exchange MUST echo the matching code_verifier or Zoho
        // rejects the request shape (invalid_request).
        if (codeVerifier) tokenParams.set('code_verifier', codeVerifier)

        const response = await fetch('https://accounts.zoho.com/oauth/v2/token', {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: tokenParams.toString(),
        })

        const data = await readResponseJsonWithLimit<Record<string, unknown>>(response, {
          maxBytes: 1024 * 1024,
          label: 'ManageEngine ServiceDesk Plus token response',
        }).catch(() => null)

        // Zoho answers a failed exchange with HTTP 200 and an `error` key, so
        // the status alone is not a sufficient success test.
        const zohoError =
          data && typeof data.error === 'string' ? (data.error as string) : undefined
        if (!response.ok || !data || zohoError) {
          logger.error('ManageEngine ServiceDesk Plus OAuth token exchange failed', {
            status: response.status,
            zohoError: zohoError ?? null,
          })
          throw new Error(
            `ManageEngine ServiceDesk Plus OAuth token exchange failed (HTTP ${response.status}${
              zohoError ? `, ${zohoError}` : ''
            })`
          )
        }

        const tokens = getOAuth2Tokens(data)
        if (!tokens.accessToken) {
          throw new Error(
            'ManageEngine ServiceDesk Plus OAuth token response did not include an access token'
          )
        }

        // Unlike zoho-desk, no data-center marker is persisted: the SDP API
        // host is not derivable from Zoho's `api_domain` (the regional apexes
        // differ — sdpondemand.manageengine.eu but servicedeskplus.net.au), so
        // the block selects it explicitly from a closed list instead.
        //
        // Zoho's token response does not consistently carry `scope`; falling
        // back to the requested scopes keeps the credential picker from showing
        // a permanent "needs update" badge on every connection.
        const reportedScopes =
          typeof data.scope === 'string' ? data.scope.split(/[\s,]+/).filter(Boolean) : []
        tokens.scopes = reportedScopes.length
          ? reportedScopes
          : getCanonicalScopesForProvider('manageengine-sdp')
        return tokens
      },
      getUserInfo: async (tokens) => {
        try {
          const response = await fetch('https://accounts.zoho.com/oauth/user/info', {
            headers: { Authorization: `Zoho-oauthtoken ${tokens.accessToken}` },
          })

          if (!response.ok) {
            await readResponseTextWithLimit(response, {
              maxBytes: 1024 * 1024,
              label: 'ManageEngine ServiceDesk Plus profile error response',
            }).catch(() => {})
            logger.error('Error fetching ManageEngine ServiceDesk Plus user info:', {
              status: response.status,
              statusText: response.statusText,
            })
            return null
          }

          const profile = await readResponseJsonWithLimit<{
            ZUID?: number | string
            Display_Name?: string
            Email?: string
          }>(response, {
            maxBytes: 1024 * 1024,
            label: 'ManageEngine ServiceDesk Plus profile response',
          })

          const zuid = profile.ZUID?.toString()
          if (!zuid) {
            logger.error('Invalid ManageEngine ServiceDesk Plus profile response:', profile)
            return null
          }

          const now = new Date()
          return {
            id: `${zuid}-${generateId()}`,
            name: profile.Display_Name || 'ManageEngine User',
            email: profile.Email || syntheticConnectorEmail('manageengine-sdp', zuid),
            emailVerified: Boolean(profile.Email),
            createdAt: now,
            updatedAt: now,
          }
        } catch (error) {
          logger.error('Error in ManageEngine ServiceDesk Plus getUserInfo:', { error })
          return null
        }
      },
    },

    {
      providerId: 'x',
      clientId: env.X_CLIENT_ID as string,
      clientSecret: env.X_CLIENT_SECRET as string,
      authorizationUrl: 'https://x.com/i/oauth2/authorize',
      tokenUrl: 'https://api.x.com/2/oauth2/token',
      userInfoUrl: 'https://api.x.com/2/users/me',
      accessType: 'offline',
      scopes: getCanonicalScopesForProvider('x'),
      pkce: true,
      responseType: 'code',
      prompt: 'consent',
      authentication: 'basic',
      redirectURI: `${getBaseUrl()}/api/auth/oauth2/callback/x`,
      getUserInfo: async (tokens) => {
        try {
          const response = await fetch(
            'https://api.x.com/2/users/me?user.fields=profile_image_url,username,name,verified',
            {
              headers: {
                Authorization: `Bearer ${tokens.accessToken}`,
              },
            }
          )

          if (!response.ok) {
            await response.text().catch(() => {})
            logger.error('Error fetching X user info:', {
              status: response.status,
              statusText: response.statusText,
            })
            return null
          }

          const profile = await response.json()

          if (!profile.data) {
            logger.error('Invalid X profile response:', profile)
            return null
          }

          const now = new Date()

          return {
            id: `${profile.data.id.toString()}-${generateId()}`,
            name: profile.data.name || 'X User',
            email: syntheticConnectorEmail('x', profile.data.username ?? profile.data.id),
            image: profile.data.profile_image_url,
            emailVerified: profile.data.verified || false,
            createdAt: now,
            updatedAt: now,
          }
        } catch (error) {
          logger.error('Error in X getUserInfo:', { error })
          return null
        }
      },
    },

    {
      providerId: 'tiktok',
      clientId: env.TIKTOK_CLIENT_ID as string,
      clientSecret: env.TIKTOK_CLIENT_SECRET as string,
      authorizationUrl: 'https://www.tiktok.com/v2/auth/authorize/',
      tokenUrl: 'https://open.tiktokapis.com/v2/oauth/token/',
      scopes: getCanonicalScopesForProvider('tiktok'),
      responseType: 'code',
      redirectURI: `${getBaseUrl()}/api/auth/oauth2/callback/tiktok`,
      authorizationUrlParams: {
        client_key: env.TIKTOK_CLIENT_ID as string,
        scope: getCanonicalScopesForProvider('tiktok').join(','),
      },
      getToken: async ({ code, redirectURI }) => {
        const response = await fetch('https://open.tiktokapis.com/v2/oauth/token/', {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({
            client_key: env.TIKTOK_CLIENT_ID as string,
            client_secret: env.TIKTOK_CLIENT_SECRET as string,
            code,
            grant_type: 'authorization_code',
            redirect_uri: redirectURI,
          }),
        })
        const data = await readResponseJsonWithLimit<Record<string, unknown>>(response, {
          maxBytes: 1024 * 1024,
          label: 'TikTok OAuth token response',
        })

        if (!response.ok || !data || typeof data !== 'object' || Array.isArray(data)) {
          throw new Error(`TikTok OAuth token exchange failed with HTTP ${response.status}`)
        }

        const tokens = getOAuth2Tokens(data)
        if (!tokens.accessToken) {
          throw new Error('TikTok OAuth token response did not include an access token')
        }
        if (typeof data.scope === 'string') {
          tokens.scopes = data.scope.split(/[\s,]+/).filter(Boolean)
        }
        return tokens
      },
      getUserInfo: async (tokens) => {
        try {
          const response = await fetch(
            'https://open.tiktokapis.com/v2/user/info/?fields=open_id,display_name,avatar_url',
            {
              headers: {
                Authorization: `Bearer ${tokens.accessToken}`,
              },
            }
          )

          if (!response.ok) {
            await readResponseTextWithLimit(response, {
              maxBytes: 1024 * 1024,
              label: 'TikTok profile error response',
            }).catch(() => {})
            logger.error('Error fetching TikTok user info:', {
              status: response.status,
              statusText: response.statusText,
            })
            return null
          }

          const profile = await readResponseJsonWithLimit<{
            data?: {
              user?: {
                avatar_url?: string
                display_name?: string
                open_id?: string
              }
            }
          }>(response, {
            maxBytes: 1024 * 1024,
            label: 'TikTok profile response',
          })
          const user = profile.data?.user

          if (!user?.open_id) {
            logger.error('Invalid TikTok profile response:', profile)
            return null
          }

          const now = new Date()

          return {
            id: `${user.open_id}-${generateId()}`,
            name: user.display_name || 'TikTok User',
            email: syntheticConnectorEmail('tiktok', user.open_id),
            image: user.avatar_url || undefined,
            emailVerified: false,
            createdAt: now,
            updatedAt: now,
          }
        } catch (error) {
          logger.error('Error in TikTok getUserInfo:', { error })
          return null
        }
      },
    },

    {
      providerId: 'confluence',
      clientId: env.CONFLUENCE_CLIENT_ID as string,
      clientSecret: env.CONFLUENCE_CLIENT_SECRET as string,
      authorizationUrl: 'https://auth.atlassian.com/authorize',
      tokenUrl: 'https://auth.atlassian.com/oauth/token',
      userInfoUrl: 'https://api.atlassian.com/me',
      scopes: getCanonicalScopesForProvider('confluence'),
      responseType: 'code',
      pkce: true,
      accessType: 'offline',
      authentication: 'basic',
      prompt: 'consent',
      authorizationUrlParams: { audience: 'api.atlassian.com' },
      redirectURI: `${getBaseUrl()}/api/auth/oauth2/callback/confluence`,
      getUserInfo: async (tokens) => {
        try {
          const response = await fetch('https://api.atlassian.com/me', {
            headers: {
              Authorization: `Bearer ${tokens.accessToken}`,
            },
          })

          if (!response.ok) {
            await response.text().catch(() => {})
            logger.error('Error fetching Confluence user info:', {
              status: response.status,
              statusText: response.statusText,
            })
            return null
          }

          const profile = await response.json()

          const now = new Date()

          return {
            id: `${profile.account_id.toString()}-${generateId()}`,
            name: profile.name || profile.display_name || 'Confluence User',
            email: profile.email || syntheticConnectorEmail('confluence', profile.account_id),
            image: profile.picture || undefined,
            emailVerified: true,
            createdAt: now,
            updatedAt: now,
          }
        } catch (error) {
          logger.error('Error in Confluence getUserInfo:', { error })
          return null
        }
      },
    },

    {
      providerId: 'jira',
      clientId: env.JIRA_CLIENT_ID as string,
      clientSecret: env.JIRA_CLIENT_SECRET as string,
      authorizationUrl: 'https://auth.atlassian.com/authorize',
      tokenUrl: 'https://auth.atlassian.com/oauth/token',
      userInfoUrl: 'https://api.atlassian.com/me',
      scopes: getCanonicalScopesForProvider('jira'),
      responseType: 'code',
      pkce: true,
      accessType: 'offline',
      authentication: 'basic',
      prompt: 'consent',
      authorizationUrlParams: { audience: 'api.atlassian.com' },
      redirectURI: `${getBaseUrl()}/api/auth/oauth2/callback/jira`,
      getUserInfo: async (tokens) => {
        try {
          const response = await fetch('https://api.atlassian.com/me', {
            headers: {
              Authorization: `Bearer ${tokens.accessToken}`,
            },
          })

          if (!response.ok) {
            await response.text().catch(() => {})
            logger.error('Error fetching Jira user info:', {
              status: response.status,
              statusText: response.statusText,
            })
            return null
          }

          const profile = await response.json()

          const now = new Date()

          return {
            id: `${profile.account_id.toString()}-${generateId()}`,
            name: profile.name || profile.display_name || 'Jira User',
            email: profile.email || syntheticConnectorEmail('jira', profile.account_id),
            image: profile.picture || undefined,
            emailVerified: true,
            createdAt: now,
            updatedAt: now,
          }
        } catch (error) {
          logger.error('Error in Jira getUserInfo:', { error })
          return null
        }
      },
    },

    {
      providerId: 'airtable',
      clientId: env.AIRTABLE_CLIENT_ID as string,
      clientSecret: env.AIRTABLE_CLIENT_SECRET as string,
      authorizationUrl: 'https://airtable.com/oauth2/v1/authorize',
      tokenUrl: 'https://airtable.com/oauth2/v1/token',
      userInfoUrl: 'https://api.airtable.com/v0/meta/whoami',
      scopes: getCanonicalScopesForProvider('airtable'),
      responseType: 'code',
      pkce: true,
      accessType: 'offline',
      authentication: 'basic',
      prompt: 'consent',
      redirectURI: `${getBaseUrl()}/api/auth/oauth2/callback/airtable`,
      getUserInfo: async (tokens) => {
        try {
          const response = await fetch('https://api.airtable.com/v0/meta/whoami', {
            headers: {
              Authorization: `Bearer ${tokens.accessToken}`,
            },
          })

          if (!response.ok) {
            await response.text().catch(() => {})
            logger.error('Error fetching Airtable user info:', {
              status: response.status,
              statusText: response.statusText,
            })
            return null
          }

          const data = await response.json()
          const now = new Date()

          return {
            id: `${data.id.toString()}-${generateId()}`,
            name: data.email ? data.email.split('@')[0] : 'Airtable User',
            email: data.email || syntheticConnectorEmail('airtable', data.id),
            emailVerified: !!data.email,
            createdAt: now,
            updatedAt: now,
          }
        } catch (error) {
          logger.error('Error in Airtable getUserInfo:', { error })
          return null
        }
      },
    },

    {
      providerId: 'bitbucket',
      clientId: env.BITBUCKET_CLIENT_ID as string,
      clientSecret: env.BITBUCKET_CLIENT_SECRET as string,
      authorizationUrl: 'https://bitbucket.org/site/oauth2/authorize',
      tokenUrl: 'https://bitbucket.org/site/oauth2/access_token',
      userInfoUrl: 'https://api.bitbucket.org/2.0/user',
      scopes: getCanonicalScopesForProvider('bitbucket'),
      responseType: 'code',
      pkce: false,
      authentication: 'basic',
      accessTokenExpiresIn: 7200,
      redirectURI: `${getBaseUrl()}/api/auth/oauth2/callback/bitbucket`,
      getToken: async ({ code, redirectURI }) => {
        const basicAuth = Buffer.from(
          `${env.BITBUCKET_CLIENT_ID as string}:${env.BITBUCKET_CLIENT_SECRET as string}`
        ).toString('base64')
        const response = await fetch('https://bitbucket.org/site/oauth2/access_token', {
          method: 'POST',
          headers: {
            Authorization: `Basic ${basicAuth}`,
            'Content-Type': 'application/x-www-form-urlencoded',
          },
          body: new URLSearchParams({
            code,
            grant_type: 'authorization_code',
            redirect_uri: redirectURI,
          }).toString(),
        })
        const data = await readResponseJsonWithLimit<Record<string, unknown>>(response, {
          maxBytes: 1024 * 1024,
          label: 'Bitbucket OAuth token response',
        })

        if (!response.ok || !isRecordLike(data)) {
          logger.error('Bitbucket OAuth token exchange failed', { status: response.status })
          throw new Error(`Bitbucket OAuth token exchange failed with HTTP ${response.status}`)
        }

        const tokens = getOAuth2Tokens(data)
        if (!tokens.accessToken) {
          throw new Error('Bitbucket OAuth token response did not include an access token')
        }

        const grantedScopes = data.scopes ?? data.scope
        if (typeof grantedScopes === 'string') {
          tokens.scopes = grantedScopes.split(/\s+/).filter(Boolean)
        } else if (Array.isArray(grantedScopes)) {
          tokens.scopes = grantedScopes.filter(
            (scope): scope is string => typeof scope === 'string'
          )
        }

        return tokens
      },
      getUserInfo: async (tokens) => {
        try {
          const signal = AbortSignal.timeout(15_000)
          const response = await fetch('https://api.bitbucket.org/2.0/user', {
            headers: {
              Authorization: `Bearer ${tokens.accessToken}`,
            },
            signal,
          })

          if (!response.ok) {
            await readResponseTextWithLimit(response, {
              maxBytes: 1024 * 1024,
              label: 'Bitbucket OAuth user info error response',
              signal,
            }).catch(() => {})
            logger.error('Error fetching Bitbucket user info:', {
              status: response.status,
              statusText: response.statusText,
            })
            return null
          }

          const data = await readResponseJsonWithLimit<BitbucketCurrentUserResponse>(response, {
            maxBytes: 1024 * 1024,
            label: 'Bitbucket OAuth user info response',
            signal,
          })
          const stableId = data.account_id ?? data.uuid
          if (!stableId) {
            logger.error('Bitbucket user info did not include an account_id or uuid')
            return null
          }

          const now = new Date()
          return {
            id: `${stableId}-${generateId()}`,
            name: data.display_name || data.nickname || 'Bitbucket User',
            email: syntheticConnectorEmail('bitbucket', stableId),
            image: data.links?.avatar?.href || undefined,
            emailVerified: false,
            createdAt: now,
            updatedAt: now,
          }
        } catch (error) {
          logger.error('Error in Bitbucket getUserInfo:', { error })
          return null
        }
      },
    },

    {
      providerId: 'notion',
      clientId: env.NOTION_CLIENT_ID as string,
      clientSecret: env.NOTION_CLIENT_SECRET as string,
      authorizationUrl: 'https://api.notion.com/v1/oauth/authorize',
      tokenUrl: 'https://api.notion.com/v1/oauth/token',
      userInfoUrl: 'https://api.notion.com/v1/users/me',
      responseType: 'code',
      pkce: false,
      accessType: 'offline',
      authentication: 'basic',
      prompt: 'consent',
      redirectURI: `${getBaseUrl()}/api/auth/oauth2/callback/notion`,
      getUserInfo: async (tokens) => {
        try {
          const response = await fetch('https://api.notion.com/v1/users/me', {
            headers: {
              Authorization: `Bearer ${tokens.accessToken}`,
              'Notion-Version': '2022-06-28',
            },
          })

          if (!response.ok) {
            await response.text().catch(() => {})
            logger.error('Error fetching Notion user info:', {
              status: response.status,
              statusText: response.statusText,
            })
            return null
          }

          const profile: NotionSelfResponse = await response.json()
          const now = new Date()

          /**
           * An OAuth integration token always resolves to a bot user, so the
           * top-level `person` is never present and the top-level `name` is the
           * integration's own name ("Sim"), not the human's. The authorizing
           * human — and their email — live under `bot.owner.user`, which is
           * only populated when `bot.owner.type === 'user'` (a workspace-owned
           * internal integration reports `{ type: 'workspace' }` instead).
           * @see https://developers.notion.com/reference/get-self
           */
          const ownerUser = profile.bot?.owner?.type === 'user' ? profile.bot.owner.user : null
          const stableId = ownerUser?.id || profile.id
          const ownerEmail = ownerUser?.person?.email

          return {
            id: `${stableId}-${generateId()}`,
            name: ownerUser?.name || profile.name || 'Notion User',
            email: ownerEmail || syntheticConnectorEmail('notion', stableId),
            emailVerified: !!ownerEmail,
            createdAt: now,
            updatedAt: now,
          }
        } catch (error) {
          logger.error('Error in Notion getUserInfo:', { error })
          return null
        }
      },
    },

    {
      providerId: 'monday',
      clientId: env.MONDAY_CLIENT_ID as string,
      clientSecret: env.MONDAY_CLIENT_SECRET as string,
      authorizationUrl: MONDAY_OAUTH_AUTHORIZATION_URL,
      tokenUrl: MONDAY_OAUTH_TOKEN_URL,
      userInfoUrl: 'https://api.monday.com/v2',
      scopes: getCanonicalScopesForProvider('monday'),
      responseType: 'code',
      pkce: true,
      authentication: 'post',
      redirectURI: `${getBaseUrl()}/api/auth/oauth2/callback/monday`,
      authorizationUrlParams: { force_install_if_needed: 'true' },
      getToken: async ({ code, codeVerifier, redirectURI }) => {
        if (!codeVerifier) {
          throw new Error('Monday OAuth token exchange requires a PKCE verifier')
        }
        return exchangeMondayAuthorizationCode({
          clientId: env.MONDAY_CLIENT_ID as string,
          clientSecret: env.MONDAY_CLIENT_SECRET as string,
          code,
          codeVerifier,
          redirectUri: redirectURI,
        })
      },
      getUserInfo: async (tokens) => {
        try {
          const signal = AbortSignal.timeout(15_000)
          const response = await fetch(MONDAY_API_URL, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'API-Version': MONDAY_API_VERSION,
              Authorization: tokens.accessToken ?? '',
            },
            body: JSON.stringify({ query: '{ me { id name email } }' }),
            signal,
          })

          if (!response.ok) {
            await readResponseTextWithLimit(response, {
              maxBytes: DEFAULT_MAX_ERROR_BODY_BYTES,
              label: 'Monday OAuth user info error response',
              signal,
            }).catch(() => {})
            logger.error('Error fetching Monday.com user info:', {
              status: response.status,
              statusText: response.statusText,
            })
            return null
          }

          const data = await readResponseJsonWithLimit<MondayUserInfoResponse>(response, {
            maxBytes: DEFAULT_MAX_ERROR_BODY_BYTES,
            label: 'Monday OAuth user info response',
            signal,
          })
          if (data.errors?.length) {
            logger.error('Monday.com user info returned GraphQL errors', {
              errorCount: data.errors.length,
            })
            return null
          }
          const user = data.data?.me
          const userId =
            typeof user?.id === 'string' || typeof user?.id === 'number'
              ? String(user.id)
              : undefined
          if (!user || !userId) return null

          const email = typeof user.email === 'string' ? user.email : undefined
          const name = typeof user.name === 'string' ? user.name : undefined

          const now = new Date()
          return {
            id: `${userId}-${generateId()}`,
            name: name || 'Monday.com User',
            email: email || syntheticConnectorEmail('monday', userId),
            emailVerified: !!email,
            createdAt: now,
            updatedAt: now,
          }
        } catch (error) {
          logger.error('Error in Monday.com getUserInfo:', { error })
          return null
        }
      },
    },

    {
      providerId: 'reddit',
      clientId: env.REDDIT_CLIENT_ID as string,
      clientSecret: env.REDDIT_CLIENT_SECRET as string,
      authorizationUrl: 'https://www.reddit.com/api/v1/authorize?duration=permanent',
      tokenUrl: 'https://www.reddit.com/api/v1/access_token',
      userInfoUrl: 'https://oauth.reddit.com/api/v1/me',
      scopes: getCanonicalScopesForProvider('reddit'),
      responseType: 'code',
      pkce: false,
      accessType: 'offline',
      authentication: 'basic',
      prompt: 'consent',
      redirectURI: `${getBaseUrl()}/api/auth/oauth2/callback/reddit`,
      getUserInfo: async (tokens) => {
        try {
          const response = await fetch('https://oauth.reddit.com/api/v1/me', {
            headers: {
              Authorization: `Bearer ${tokens.accessToken}`,
              'User-Agent': REDDIT_USER_AGENT,
            },
          })

          if (!response.ok) {
            await response.text().catch(() => {})
            logger.error('Error fetching Reddit user info:', {
              status: response.status,
              statusText: response.statusText,
            })
            return null
          }

          const data = await response.json()
          const now = new Date()

          return {
            id: `${data.id.toString()}-${generateId()}`,
            name: data.name || 'Reddit User',
            email: syntheticConnectorEmail('reddit', data.name ?? data.id),
            image: data.icon_img || undefined,
            emailVerified: false,
            createdAt: now,
            updatedAt: now,
          }
        } catch (error) {
          logger.error('Error in Reddit getUserInfo:', { error })
          return null
        }
      },
    },

    {
      providerId: 'clickup',
      clientId: env.CLICKUP_CLIENT_ID as string,
      clientSecret: env.CLICKUP_CLIENT_SECRET as string,
      authorizationUrl: 'https://app.clickup.com/api',
      tokenUrl: 'https://api.clickup.com/api/v2/oauth/token',
      scopes: getCanonicalScopesForProvider('clickup'),
      responseType: 'code',
      pkce: false,
      redirectURI: `${getBaseUrl()}/api/auth/oauth2/callback/clickup`,
      getUserInfo: async (tokens) => {
        try {
          const response = await fetch('https://api.clickup.com/api/v2/user', {
            headers: {
              Authorization: `Bearer ${tokens.accessToken}`,
              'Content-Type': 'application/json',
            },
          })

          if (!response.ok) {
            await response.text().catch(() => {})
            logger.error('Error fetching ClickUp user info:', {
              status: response.status,
              statusText: response.statusText,
            })
            return null
          }

          const data = await response.json()
          const user = data.user
          if (!user?.id) return null

          const now = new Date()
          return {
            id: `${user.id.toString()}-${generateId()}`,
            name: user.username || 'ClickUp User',
            email: user.email || syntheticConnectorEmail('clickup', user.id),
            emailVerified: !!user.email,
            createdAt: now,
            updatedAt: now,
            image: user.profilePicture || undefined,
          }
        } catch (error) {
          logger.error('Error in ClickUp getUserInfo:', { error })
          return null
        }
      },
    },

    {
      providerId: 'linear',
      clientId: env.LINEAR_CLIENT_ID as string,
      clientSecret: env.LINEAR_CLIENT_SECRET as string,
      authorizationUrl: 'https://linear.app/oauth/authorize',
      tokenUrl: 'https://api.linear.app/oauth/token',
      scopes: getCanonicalScopesForProvider('linear'),
      responseType: 'code',
      redirectURI: `${getBaseUrl()}/api/auth/oauth2/callback/linear`,
      pkce: true,
      prompt: 'consent',
      accessType: 'offline',
      getUserInfo: async (tokens) => {
        try {
          const response = await fetch('https://api.linear.app/graphql', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${tokens.accessToken}`,
            },
            body: JSON.stringify({
              query: `{
                    viewer {
                      id
                      email
                      name
                      avatarUrl
                    }
                  }`,
            }),
          })

          if (!response.ok) {
            const errorText = await response.text()
            logger.error('Linear API error:', {
              status: response.status,
              statusText: response.statusText,
              body: errorText,
            })
            throw new Error(`Linear API error: ${response.status} ${response.statusText}`)
          }

          const { data, errors } = await response.json()

          if (errors) {
            logger.error('GraphQL errors:', errors)
            throw new Error(`GraphQL errors: ${JSON.stringify(errors)}`)
          }

          if (!data?.viewer) {
            logger.error('No viewer data in response:', data)
            throw new Error('No viewer data in response')
          }

          const viewer = data.viewer

          return {
            id: `${viewer.id.toString()}-${generateId()}`,
            email: viewer.email || syntheticConnectorEmail('linear', viewer.id),
            name: viewer.name,
            emailVerified: true,
            createdAt: new Date(),
            updatedAt: new Date(),
            image: viewer.avatarUrl || undefined,
          }
        } catch (error) {
          logger.error('Error in getUserInfo:', error)
          throw error
        }
      },
    },

    {
      providerId: 'attio',
      clientId: env.ATTIO_CLIENT_ID as string,
      clientSecret: env.ATTIO_CLIENT_SECRET as string,
      authorizationUrl: 'https://app.attio.com/authorize',
      tokenUrl: 'https://app.attio.com/oauth/token',
      scopes: getCanonicalScopesForProvider('attio'),
      responseType: 'code',
      redirectURI: `${getBaseUrl()}/api/auth/oauth2/callback/attio`,
      getUserInfo: async (tokens) => {
        try {
          /**
           * Resolve the *authorizing* member, not an arbitrary one. Listing
           * `/v2/workspace_members` returns every member of the workspace in no
           * defined order, so taking `data[0]` records a stranger's id as the
           * account's stable external id — which then collapses two different
           * Attio members into one account row via the stale-sibling dedupe in
           * the `account.create.after` hook.
           *
           * `/v2/self` requires no scope and reports who authorized the token.
           * @see https://docs.attio.com/rest-api/endpoint-reference/meta/identify
           */
          const selfResponse = await fetch('https://api.attio.com/v2/self', {
            headers: { Authorization: `Bearer ${tokens.accessToken}` },
          })

          if (!selfResponse.ok) {
            const errorText = await selfResponse.text().catch(() => '')
            logger.error('Attio /v2/self error:', {
              status: selfResponse.status,
              statusText: selfResponse.statusText,
              body: errorText,
            })
            return null
          }

          const self: AttioSelfResponse = await selfResponse.json()
          const memberId = self.authorized_by_workspace_member_id

          if (!memberId) {
            logger.error('Attio /v2/self returned no authorizing workspace member', {
              active: self.active,
              workspaceId: self.workspace_id,
            })
            return null
          }

          /**
           * Fetch that member by id rather than listing and filtering. Requires
           * `user_management:read`, which Sim always requests for Attio.
           * @see https://docs.attio.com/rest-api/endpoint-reference/workspace-members/get-a-workspace-member
           */
          const memberResponse = await fetch(
            `https://api.attio.com/v2/workspace_members/${encodeURIComponent(memberId)}`,
            { headers: { Authorization: `Bearer ${tokens.accessToken}` } }
          )

          if (!memberResponse.ok) {
            const errorText = await memberResponse.text().catch(() => '')
            logger.error('Attio workspace member fetch error:', {
              status: memberResponse.status,
              statusText: memberResponse.statusText,
              body: errorText,
            })
            return null
          }

          const { data: member }: AttioWorkspaceMemberResponse = await memberResponse.json()

          if (!member) {
            logger.error('Attio workspace member not found', { memberId })
            return null
          }

          const email = member.email_address
          const fullName = `${member.first_name ?? ''} ${member.last_name ?? ''}`.trim()

          return {
            id: `${member.id.workspace_member_id}-${generateId()}`,
            email: email || syntheticConnectorEmail('attio', member.id.workspace_member_id),
            name: fullName || email || 'Attio User',
            emailVerified: Boolean(email),
            createdAt: new Date(),
            updatedAt: new Date(),
            image: member.avatar_url || undefined,
          }
        } catch (error) {
          /**
           * Return null rather than rethrowing: Better Auth's `handleUserInfo`
           * does not wrap `getUserInfo`, so a throw escapes the callback route
           * as a raw 500 with no way back into the app, while null redirects
           * with `user_info_is_missing`.
           */
          logger.error('Error in Attio getUserInfo:', error)
          return null
        }
      },
    },

    {
      providerId: 'box',
      clientId: env.BOX_CLIENT_ID as string,
      clientSecret: env.BOX_CLIENT_SECRET as string,
      authorizationUrl: 'https://account.box.com/api/oauth2/authorize',
      tokenUrl: 'https://api.box.com/oauth2/token',
      scopes: getCanonicalScopesForProvider('box'),
      responseType: 'code',
      redirectURI: `${getBaseUrl()}/api/auth/oauth2/callback/box`,
      getUserInfo: async (tokens) => {
        try {
          const response = await fetch('https://api.box.com/2.0/users/me', {
            headers: {
              Authorization: `Bearer ${tokens.accessToken}`,
            },
          })

          if (!response.ok) {
            const errorText = await response.text()
            logger.error('Box API error:', {
              status: response.status,
              statusText: response.statusText,
              body: errorText,
            })
            throw new Error(`Box API error: ${response.status} ${response.statusText}`)
          }

          const data = await response.json()

          return {
            id: `${data.id}-${generateId()}`,
            email: data.login || syntheticConnectorEmail('box', data.id),
            name: data.name || data.login || 'Box User',
            emailVerified: true,
            createdAt: new Date(),
            updatedAt: new Date(),
            image: data.avatar_url || undefined,
          }
        } catch (error) {
          logger.error('Error in Box getUserInfo:', error)
          throw error
        }
      },
    },

    {
      providerId: 'dropbox',
      clientId: env.DROPBOX_CLIENT_ID as string,
      clientSecret: env.DROPBOX_CLIENT_SECRET as string,
      authorizationUrl: 'https://www.dropbox.com/oauth2/authorize',
      tokenUrl: 'https://api.dropboxapi.com/oauth2/token',
      scopes: getCanonicalScopesForProvider('dropbox'),
      responseType: 'code',
      redirectURI: `${getBaseUrl()}/api/auth/oauth2/callback/dropbox`,
      pkce: true,
      accessType: 'offline',
      prompt: 'consent',
      authorizationUrlParams: {
        token_access_type: 'offline',
      },
      getUserInfo: async (tokens) => {
        try {
          const response = await fetch('https://api.dropboxapi.com/2/users/get_current_account', {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${tokens.accessToken}`,
            },
          })

          if (!response.ok) {
            const errorText = await response.text()
            logger.error('Dropbox API error:', {
              status: response.status,
              statusText: response.statusText,
              body: errorText,
            })
            throw new Error(`Dropbox API error: ${response.status} ${response.statusText}`)
          }

          const data = await response.json()

          return {
            id: `${data.account_id.toString()}-${generateId()}`,
            email: data.email,
            name: data.name?.display_name || data.email,
            emailVerified: data.email_verified || false,
            createdAt: new Date(),
            updatedAt: new Date(),
            image: data.profile_photo_url || undefined,
          }
        } catch (error) {
          logger.error('Error in getUserInfo:', error)
          throw error
        }
      },
    },

    {
      providerId: 'asana',
      clientId: env.ASANA_CLIENT_ID as string,
      clientSecret: env.ASANA_CLIENT_SECRET as string,
      authorizationUrl: 'https://app.asana.com/-/oauth_authorize',
      tokenUrl: 'https://app.asana.com/-/oauth_token',
      userInfoUrl: 'https://app.asana.com/api/1.0/users/me',
      scopes: getCanonicalScopesForProvider('asana'),
      responseType: 'code',
      pkce: false,
      accessType: 'offline',
      authentication: 'basic',
      prompt: 'consent',
      redirectURI: `${getBaseUrl()}/api/auth/oauth2/callback/asana`,
      getUserInfo: async (tokens) => {
        try {
          const response = await fetch('https://app.asana.com/api/1.0/users/me', {
            headers: {
              Authorization: `Bearer ${tokens.accessToken}`,
            },
          })

          if (!response.ok) {
            await response.text().catch(() => {})
            logger.error('Error fetching Asana user info:', {
              status: response.status,
              statusText: response.statusText,
            })
            return null
          }

          const result = await response.json()
          const profile = result.data

          const now = new Date()

          return {
            id: `${profile.gid.toString()}-${generateId()}`,
            name: profile.name || 'Asana User',
            email: profile.email || syntheticConnectorEmail('asana', profile.gid),
            image: profile.photo?.image_128x128 || undefined,
            emailVerified: !!profile.email,
            createdAt: now,
            updatedAt: now,
          }
        } catch (error) {
          logger.error('Error in Asana getUserInfo:', { error })
          return null
        }
      },
    },

    {
      providerId: 'slack',
      clientId: env.SLACK_CLIENT_ID as string,
      clientSecret: env.SLACK_CLIENT_SECRET as string,
      authorizationUrl: 'https://slack.com/oauth/v2/authorize',
      tokenUrl: 'https://slack.com/api/oauth.v2.access',
      userInfoUrl: 'https://slack.com/api/users.identity',
      scopes: getCanonicalScopesForProvider('slack'),
      responseType: 'code',
      accessType: 'offline',
      prompt: 'consent',
      redirectURI: `${getBaseUrl()}/api/auth/oauth2/callback/slack`,
      getUserInfo: async (tokens) => {
        try {
          const response = await fetch('https://slack.com/api/auth.test', {
            headers: {
              Authorization: `Bearer ${tokens.accessToken}`,
            },
          })

          if (!response.ok) {
            await response.text().catch(() => {})
            logger.error('Slack auth.test failed', {
              status: response.status,
              statusText: response.statusText,
            })
            return null
          }

          const data = await response.json()

          if (!data.ok) {
            logger.error('Slack auth.test returned error', { error: data.error })
            return null
          }

          const teamId = data.team_id || 'unknown'
          const teamName = data.team || 'Slack Workspace'

          /**
           * Tag the accountId with the installing user's Slack id (from the OAuth
           * v2 `authed_user.id`, preserved on `tokens.raw`) behind a `usr_` marker.
           * The channels selector uses it to scope private-channel visibility to
           * the installer's own Slack membership, per Slack Marketplace rules. The
           * marker disambiguates it from a legacy bot id (same `U.../B...` shape);
           * absent it, we keep the legacy format and today's behavior.
           */
          const rawTokens = (tokens as typeof tokens & { raw?: Record<string, unknown> }).raw
          const authedUser = rawTokens?.authed_user as { id?: string } | undefined
          const installerUserId = authedUser?.id
          const userSegment = installerUserId
            ? `usr_${installerUserId}`
            : data.user_id || data.bot_id || 'bot'

          const uniqueId = `${teamId}-${userSegment}`

          logger.info('Slack credential identifier', {
            teamId,
            userSegment,
            uniqueId,
            teamName,
            hasInstallerId: !!installerUserId,
          })

          return {
            id: `${uniqueId}-${generateId()}`,
            name: teamName,
            email: syntheticConnectorEmail('slack', uniqueId),
            emailVerified: false,
            createdAt: new Date(),
            updatedAt: new Date(),
          }
        } catch (error) {
          logger.error('Error creating Slack bot profile:', { error })
          return null
        }
      },
    },

    {
      providerId: 'webflow',
      clientId: env.WEBFLOW_CLIENT_ID as string,
      clientSecret: env.WEBFLOW_CLIENT_SECRET as string,
      authorizationUrl: 'https://webflow.com/oauth/authorize',
      tokenUrl: 'https://api.webflow.com/oauth/access_token',
      userInfoUrl: 'https://api.webflow.com/v2/token/introspect',
      scopes: getCanonicalScopesForProvider('webflow'),
      responseType: 'code',
      redirectURI: `${getBaseUrl()}/api/auth/oauth2/callback/webflow`,
      getUserInfo: async (tokens) => {
        try {
          logger.info('Fetching Webflow user info')

          const response = await fetch('https://api.webflow.com/v2/token/introspect', {
            headers: {
              Authorization: `Bearer ${tokens.accessToken}`,
            },
          })

          if (!response.ok) {
            await response.text().catch(() => {})
            logger.error('Error fetching Webflow user info:', {
              status: response.status,
              statusText: response.statusText,
            })
            return null
          }

          const data = await response.json()
          const now = new Date()

          const userId = data.user_id || 'user'
          const uniqueId = `webflow-${userId}`

          return {
            id: `${uniqueId}-${generateId()}`,
            name: data.user_name || 'Webflow User',
            email: syntheticConnectorEmail('webflow', userId),
            emailVerified: false,
            createdAt: now,
            updatedAt: now,
          }
        } catch (error) {
          logger.error('Error in Webflow getUserInfo:', { error })
          return null
        }
      },
    },
    {
      providerId: 'linkedin',
      clientId: env.LINKEDIN_CLIENT_ID as string,
      clientSecret: env.LINKEDIN_CLIENT_SECRET as string,
      authorizationUrl: 'https://www.linkedin.com/oauth/v2/authorization',
      tokenUrl: 'https://www.linkedin.com/oauth/v2/accessToken',
      userInfoUrl: 'https://api.linkedin.com/v2/userinfo',
      scopes: getCanonicalScopesForProvider('linkedin'),
      responseType: 'code',
      accessType: 'offline',
      prompt: 'consent',
      redirectURI: `${getBaseUrl()}/api/auth/oauth2/callback/linkedin`,
      getUserInfo: async (tokens) => {
        try {
          logger.info('Fetching LinkedIn user profile')

          const response = await fetch('https://api.linkedin.com/v2/userinfo', {
            headers: {
              Authorization: `Bearer ${tokens.accessToken}`,
            },
          })

          if (!response.ok) {
            await response.text().catch(() => {})
            logger.error('Failed to fetch LinkedIn user info', {
              status: response.status,
              statusText: response.statusText,
            })
            throw new Error('Failed to fetch user info')
          }

          const profile = await response.json()

          return {
            id: `${profile.sub}-${generateId()}`,
            name: profile.name || 'LinkedIn User',
            email: profile.email || syntheticConnectorEmail('linkedin', profile.sub),
            emailVerified: true,
            image: profile.picture || undefined,
            createdAt: new Date(),
            updatedAt: new Date(),
          }
        } catch (error) {
          logger.error('Error in LinkedIn getUserInfo:', { error })
          return null
        }
      },
    },

    {
      providerId: 'zoom',
      clientId: env.ZOOM_CLIENT_ID as string,
      clientSecret: env.ZOOM_CLIENT_SECRET as string,
      authorizationUrl: 'https://zoom.us/oauth/authorize',
      tokenUrl: 'https://zoom.us/oauth/token',
      userInfoUrl: 'https://api.zoom.us/v2/users/me',
      scopes: getCanonicalScopesForProvider('zoom'),
      responseType: 'code',
      accessType: 'offline',
      authentication: 'basic',
      prompt: 'consent',
      redirectURI: `${getBaseUrl()}/api/auth/oauth2/callback/zoom`,
      getUserInfo: async (tokens) => {
        try {
          logger.info('Fetching Zoom user profile')

          const response = await fetch('https://api.zoom.us/v2/users/me', {
            headers: {
              Authorization: `Bearer ${tokens.accessToken}`,
            },
          })

          if (!response.ok) {
            await response.text().catch(() => {})
            logger.error('Failed to fetch Zoom user info', {
              status: response.status,
              statusText: response.statusText,
            })
            throw new Error('Failed to fetch user info')
          }

          const profile = await response.json()

          return {
            id: `${profile.id.toString()}-${generateId()}`,
            name: `${profile.first_name || ''} ${profile.last_name || ''}`.trim() || 'Zoom User',
            email: profile.email || syntheticConnectorEmail('zoom', profile.id),
            emailVerified: profile.verified === 1,
            image: profile.pic_url || undefined,
            createdAt: new Date(),
            updatedAt: new Date(),
          }
        } catch (error) {
          logger.error('Error in Zoom getUserInfo:', { error })
          return null
        }
      },
    },

    {
      providerId: 'spotify',
      clientId: env.SPOTIFY_CLIENT_ID as string,
      clientSecret: env.SPOTIFY_CLIENT_SECRET as string,
      authorizationUrl: 'https://accounts.spotify.com/authorize',
      tokenUrl: 'https://accounts.spotify.com/api/token',
      userInfoUrl: 'https://api.spotify.com/v1/me',
      scopes: getCanonicalScopesForProvider('spotify'),
      responseType: 'code',
      authentication: 'basic',
      redirectURI: `${getBaseUrl()}/api/auth/oauth2/callback/spotify`,
      getUserInfo: async (tokens) => {
        try {
          logger.info('Fetching Spotify user profile')

          const response = await fetch('https://api.spotify.com/v1/me', {
            headers: {
              Authorization: `Bearer ${tokens.accessToken}`,
            },
          })

          if (!response.ok) {
            await response.text().catch(() => {})
            logger.error('Failed to fetch Spotify user info', {
              status: response.status,
              statusText: response.statusText,
            })
            throw new Error('Failed to fetch user info')
          }

          const profile = await response.json()

          return {
            id: `${profile.id.toString()}-${generateId()}`,
            name: profile.display_name || 'Spotify User',
            email: profile.email || syntheticConnectorEmail('spotify', profile.id),
            emailVerified: true,
            image: profile.images?.[0]?.url || undefined,
            createdAt: new Date(),
            updatedAt: new Date(),
          }
        } catch (error) {
          logger.error('Error in Spotify getUserInfo:', { error })
          return null
        }
      },
    },

    {
      providerId: 'wordpress',
      clientId: env.WORDPRESS_CLIENT_ID as string,
      clientSecret: env.WORDPRESS_CLIENT_SECRET as string,
      authorizationUrl: 'https://public-api.wordpress.com/oauth2/authorize',
      tokenUrl: 'https://public-api.wordpress.com/oauth2/token',
      userInfoUrl: 'https://public-api.wordpress.com/rest/v1.1/me',
      scopes: getCanonicalScopesForProvider('wordpress'),
      responseType: 'code',
      prompt: 'consent',
      redirectURI: `${getBaseUrl()}/api/auth/oauth2/callback/wordpress`,
      getUserInfo: async (tokens) => {
        try {
          logger.info('Fetching WordPress.com user profile')

          const response = await fetch('https://public-api.wordpress.com/rest/v1.1/me', {
            headers: {
              Authorization: `Bearer ${tokens.accessToken}`,
            },
          })

          if (!response.ok) {
            await response.text().catch(() => {})
            logger.error('Failed to fetch WordPress.com user info', {
              status: response.status,
              statusText: response.statusText,
            })
            throw new Error('Failed to fetch user info')
          }

          const profile = await response.json()

          return {
            id: `${profile.ID?.toString() || profile.id?.toString()}-${generateId()}`,
            name: profile.display_name || profile.username || 'WordPress User',
            email:
              profile.email ||
              syntheticConnectorEmail('wordpress', profile.username ?? profile.ID ?? profile.id),
            emailVerified: profile.email_verified || false,
            image: profile.avatar_URL || undefined,
            createdAt: new Date(),
            updatedAt: new Date(),
          }
        } catch (error) {
          logger.error('Error in WordPress.com getUserInfo:', { error })
          return null
        }
      },
    },

    // DocuSign provider
    {
      providerId: 'docusign',
      clientId: env.DOCUSIGN_CLIENT_ID as string,
      clientSecret: env.DOCUSIGN_CLIENT_SECRET as string,
      authorizationUrl: getDocusignOAuthUrl('/oauth/auth'),
      tokenUrl: getDocusignOAuthUrl('/oauth/token'),
      userInfoUrl: getDocusignOAuthUrl('/oauth/userinfo'),
      scopes: getCanonicalScopesForProvider('docusign'),
      responseType: 'code',
      accessType: 'offline',
      prompt: 'consent',
      redirectURI: `${getBaseUrl()}/api/auth/oauth2/callback/docusign`,
      getUserInfo: async (tokens) => {
        try {
          logger.info('Fetching DocuSign user profile')

          const response = await fetch(getDocusignOAuthUrl('/oauth/userinfo'), {
            headers: {
              Authorization: `Bearer ${tokens.accessToken}`,
            },
          })

          if (!response.ok) {
            await response.text().catch(() => {})
            logger.error('Failed to fetch DocuSign user info', {
              status: response.status,
              statusText: response.statusText,
            })
            throw new Error('Failed to fetch user info')
          }

          const data = await response.json()
          const accounts = data.accounts ?? []
          const defaultAccount =
            accounts.find((a: { is_default: boolean }) => a.is_default) ?? accounts[0]
          const accountName = defaultAccount?.account_name || 'DocuSign Account'

          if (data.scope) {
            tokens.scopes = data.scope.split(/\s+/).filter(Boolean)
          }

          return {
            id: `${data.sub}-${generateId()}`,
            name: data.name || accountName,
            email: data.email || syntheticConnectorEmail('docusign', data.sub),
            emailVerified: true,
            image: undefined,
            createdAt: new Date(),
            updatedAt: new Date(),
          }
        } catch (error) {
          logger.error('Error in DocuSign getUserInfo:', { error })
          return null
        }
      },
    },

    // Cal.com provider
    {
      providerId: 'calcom',
      clientId: env.CALCOM_CLIENT_ID as string,
      authorizationUrl: 'https://app.cal.com/auth/oauth2/authorize',
      tokenUrl: 'https://app.cal.com/api/auth/oauth/token',
      scopes: getCanonicalScopesForProvider('calcom'),
      responseType: 'code',
      pkce: true,
      accessType: 'offline',
      prompt: 'consent',
      redirectURI: `${getBaseUrl()}/api/auth/oauth2/callback/calcom`,
      getUserInfo: async (tokens) => {
        try {
          logger.info('Fetching Cal.com user profile')

          const response = await fetch('https://api.cal.com/v2/me', {
            headers: {
              Authorization: `Bearer ${tokens.accessToken}`,
              'cal-api-version': '2024-08-13',
            },
          })

          if (!response.ok) {
            await response.text().catch(() => {})
            logger.error('Failed to fetch Cal.com user info', {
              status: response.status,
              statusText: response.statusText,
            })
            throw new Error('Failed to fetch user info')
          }

          const data = await response.json()
          const profile = data.data || data

          return {
            id: `${profile.id?.toString()}-${generateId()}`,
            name: profile.name || 'Cal.com User',
            email: profile.email || syntheticConnectorEmail('calcom', profile.id),
            emailVerified: true,
            createdAt: new Date(),
            updatedAt: new Date(),
          }
        } catch (error) {
          logger.error('Error in Cal.com getUserInfo:', { error })
          return null
        }
      },
    },
  ]

  return providers.filter(
    ({ providerId }) => inspectConfiguredOAuthClient(providerId).state === 'ready'
  )
}
