import { cache } from 'react'
import { oauthProvider } from '@better-auth/oauth-provider'
import { sso } from '@better-auth/sso'
import { stripe } from '@better-auth/stripe'
import { db } from '@sim/db'
import * as schema from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { getErrorMessage, toError } from '@sim/utils/errors'
import { type BetterAuthOptions, betterAuth, type User } from 'better-auth'
import {
  APIError,
  createAuthMiddleware,
  getOAuthState,
  getSessionFromCtx,
  setShouldSkipSessionRefresh,
} from 'better-auth/api'
import { deleteSessionCookie, setSessionCookie } from 'better-auth/cookies'
import { nextCookies } from 'better-auth/next-js'
import {
  admin,
  captcha,
  customSession,
  emailOTP,
  genericOAuth,
  oneTimeToken,
  organization,
} from 'better-auth/plugins'
import { and, count, eq, inArray, sql } from 'drizzle-orm'
import { headers } from 'next/headers'
import Stripe from 'stripe'
import {
  getEmailSubject,
  renderExistingAccountEmail,
  renderOTPEmail,
  renderPasswordResetEmail,
  renderWelcomeEmail,
} from '@/components/emails'
import { getAccessControlConfig, isEmailBlockedByAccessControl } from '@/lib/auth/access-control'
import { createAnonymousSession, ensureAnonymousUserExists } from '@/lib/auth/anonymous'
import { buildConnectorProviders } from '@/lib/auth/connectors/providers'
import {
  applyRegistrationGate,
  getRequestedSignInProviderId,
  isSignInProviderAllowed,
} from '@/lib/auth/constants'
import { hashOAuthToken } from '@/lib/auth/oauth-access-token'
import {
  consentRequestNamesClient,
  OAUTH_ACCESS_TOKEN_PREFIX,
  OAUTH_ACCESS_TOKEN_TTL_SECONDS,
  OAUTH_CODE_TTL_SECONDS,
  OAUTH_REFRESH_TOKEN_PREFIX,
  OAUTH_REFRESH_TOKEN_TTL_SECONDS,
  OAUTH_SCOPES,
  SIM_CLI_CLIENT_ID,
} from '@/lib/auth/oauth-provider'
import { isOAuthProviderEnabled } from '@/lib/auth/oauth-provider-feature'
import { getSessionCookieCacheVersion } from '@/lib/auth/security-policy'
import { clampExpiryForSession } from '@/lib/auth/session-policy'
import { getActiveOrganizationId } from '@/lib/auth/session-response'
import { createSimAuthAdapter } from '@/lib/auth/sim-auth-adapter'
import { admitSsoUser } from '@/lib/auth/sso/application/admit-sso-user'
import { resolveSsoCallbackProviderId } from '@/lib/auth/sso/callback-provider'
import { sendPlanWelcomeEmail } from '@/lib/billing'
import {
  assertPersonalCheckoutAllowed,
  authorizeSubscriptionReference,
  isPersonalCheckoutRequest,
} from '@/lib/billing/authorization'
import {
  type CheckoutAdmissionClaim,
  claimCheckoutAdmission,
  releaseCheckoutAdmission,
  resolveCheckoutReferenceId,
} from '@/lib/billing/checkout-admission'
import {
  getOrganizationIdForSubscriptionReference,
  syncSubscriptionPlan,
  writeBillingInterval,
} from '@/lib/billing/core/subscription'
import { handleNewUser } from '@/lib/billing/core/usage'
import {
  ensureOrganizationForTeamSubscription,
  syncSubscriptionUsageLimits,
} from '@/lib/billing/organization'
import { pauseProSubscriptionForOrgCoverage } from '@/lib/billing/organizations/membership'
import { isPro, isTeam } from '@/lib/billing/plan-helpers'
import { getPlans, resolvePlanFromStripeSubscription } from '@/lib/billing/plans'
import { syncSeatsFromStripeQuantity } from '@/lib/billing/validation/seat-management'
import { handleAbandonedCheckout } from '@/lib/billing/webhooks/checkout'
import { handleChargeDispute, handleDisputeClosed } from '@/lib/billing/webhooks/disputes'
import { handleManualEnterpriseSubscription } from '@/lib/billing/webhooks/enterprise'
import {
  handleInvoicePaymentFailed,
  handleInvoicePaymentSucceeded,
} from '@/lib/billing/webhooks/invoices'
import {
  handleSubscriptionCreated,
  handleSubscriptionDeleted,
} from '@/lib/billing/webhooks/subscription'
import { env } from '@/lib/core/config/env'
import {
  isAuthDisabled,
  isBillingEnabled,
  isEmailPasswordEnabled,
  isEmailSignupDisabled,
  isEmailVerificationEnabled,
  isGithubAuthDisabled,
  isGoogleAuthDisabled,
  isHosted,
  isMicrosoftAuthDisabled,
  isOrganizationsEnabled,
  isRegistrationDisabled,
  isSignupMxValidationEnabled,
  isSsoEnabled,
} from '@/lib/core/config/env-flags'
import { validateCallbackUrl } from '@/lib/core/security/input-validation'
import { PlatformEvents } from '@/lib/core/telemetry'
import { trustedProxies } from '@/lib/core/utils/request'
import { getBaseUrl, isLocalhostUrl, parseOriginList } from '@/lib/core/utils/urls'
import {
  captureOAuthCredentialDraftBinding,
  consumeOAuthCredentialDraftBinding,
  processCredentialDraft,
} from '@/lib/credentials/draft-processor'
import { sendEmail } from '@/lib/messaging/email/mailer'
import { getFromEmailAddress, getPersonalEmailFrom } from '@/lib/messaging/email/utils'
import { quickValidateEmail } from '@/lib/messaging/email/validation'
import { validateSignupEmailMx } from '@/lib/messaging/email/validation.server'
import { isEmailVerificationEffectivelyEnabled } from '@/lib/messaging/email/verification'
import { scheduleLifecycleEmail } from '@/lib/messaging/lifecycle'
import {
  getMicrosoftRefreshTokenExpiry,
  isMicrosoftProvider,
  mapMicrosoftProfileToUser,
} from '@/lib/oauth/microsoft'
import {
  assertMicrosoftDataverseOAuthLinkRequest,
  MICROSOFT_DATAVERSE_PROVIDER_ID,
} from '@/lib/oauth/microsoft-dataverse'
import { clearOAuthRefreshDeadFlag } from '@/lib/oauth/refresh-coordination'
import {
  isSalesforceLoginOrigin,
  isSalesforceOAuthProviderId,
  SALESFORCE_LOGIN_HOSTS,
  withSalesforceInstanceScope,
} from '@/lib/oauth/salesforce'
import { extractSlackTeamId, fanOutSlackTokenChain } from '@/lib/oauth/slack'
import { getCanonicalScopesForProvider } from '@/lib/oauth/utils'
import { joinInstanceOrganization } from '@/lib/organizations/instance-org'
import { capabilityRefusal } from '@/lib/permission-groups/capability-assertions'
import { isCapabilityWithheldForUser } from '@/lib/permission-groups/user-scope.server'
import { captureServerEvent, getPostHogClient } from '@/lib/posthog/server'
import { disableUserResources } from '@/lib/workflows/lifecycle'
import { SSO_TRUSTED_PROVIDERS } from '@/ee/sso/constants'

const logger = createLogger('Auth')

function buildSsoAdmissionErrorUrl(code: string, callbackLocation?: string | null): string {
  const callbackUrl =
    callbackLocation && validateCallbackUrl(callbackLocation) ? callbackLocation : '/workspace'
  const params = new URLSearchParams({ error: code, callbackUrl })
  return `${getBaseUrl()}/sso?${params.toString()}`
}

const additionalTrustedOrigins = parseOriginList(env.TRUSTED_ORIGINS, (value) =>
  logger.warn('Ignoring invalid entry in TRUSTED_ORIGINS', { value })
)

/**
 * Extra provider IDs appended to `trustedProviders`, from `SSO_PROVIDER_ID` and
 * `SSO_TRUSTED_PROVIDER_IDS`. Empty when SSO is disabled.
 *
 * These no longer affect SSO sign-in: the plugin passes `trustProviderByName:
 * false`, disabling the name-based branch, so SSO trust comes only from
 * `domainVerified`. Kept because non-SSO providers still link by name.
 */
const additionalTrustedSsoProviders = isSsoEnabled
  ? [env.SSO_PROVIDER_ID, ...(env.SSO_TRUSTED_PROVIDER_IDS?.split(',') ?? [])]
      .map((id) => id?.trim())
      .filter((id): id is string => Boolean(id))
  : []

if (env.NODE_ENV === 'production') {
  const baseUrl = getBaseUrl()
  if (isLocalhostUrl(baseUrl)) {
    logger.warn(
      'NEXT_PUBLIC_APP_URL points to localhost in production. Self-hosted deployments must set NEXT_PUBLIC_APP_URL to the public URL users access (e.g. https://sim.example.com), otherwise auth POST requests from any non-localhost origin will be rejected by trustedOrigins. Set TRUSTED_ORIGINS to allow additional public origins.',
      { baseUrl }
    )
  }
}

const validStripeKey = env.STRIPE_SECRET_KEY

let stripeClient = null
if (validStripeKey) {
  stripeClient = new Stripe(env.STRIPE_SECRET_KEY || '', {
    apiVersion: '2025-08-27.basil',
  })
}

/**
 * Resolves the org's API instance URL for a freshly linked Salesforce account.
 *
 * The token response never carries `instance_url`, but `/services/oauth2/userinfo`
 * returns a `profile` URL rooted at the org's own host. A response still rooted
 * at the login host means userinfo answered for the authorization server rather
 * than an org, which is not an instance URL — hence the guard.
 *
 * @returns The instance URL origin, or undefined when it cannot be determined
 * (the caller then leaves `scope` untouched rather than storing a wrong host).
 */
async function fetchSalesforceInstanceUrl(
  providerId: string,
  accessToken: string
): Promise<string | undefined> {
  const loginHost = SALESFORCE_LOGIN_HOSTS[providerId]
  if (!loginHost) return undefined
  try {
    const response = await fetch(`https://${loginHost}/services/oauth2/userinfo`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    })
    if (!response.ok) return undefined
    const data = await response.json()
    if (typeof data.profile !== 'string') return undefined
    const url = new URL(data.profile)
    // The origin becomes a tool base URL that carries the bearer token, so the
    // scheme is pinned rather than inherited from whatever userinfo returned.
    if (url.protocol !== 'https:' || isSalesforceLoginOrigin(url.origin)) return undefined
    return url.origin
  } catch (error) {
    logger.error('Failed to fetch Salesforce instance URL', { error, providerId })
    return undefined
  }
}

export const auth = betterAuth({
  baseURL: getBaseUrl(),
  // Where Better Auth sends OAuth callbacks that fail before the flow state is
  // parsed — most commonly a provider-side Cancel/Deny. Without this it
  // defaults to a nonexistent `/error` (a 404 dead-end), which strands the
  // desktop sign-in/connect handoffs since their loopback is never pinged.
  onAPIError: { errorURL: `${getBaseUrl()}/oauth-error` },
  trustedOrigins: [
    getBaseUrl(),
    ...(env.NEXT_PUBLIC_SOCKET_URL ? [env.NEXT_PUBLIC_SOCKET_URL] : []),
    ...additionalTrustedOrigins,
  ].filter(Boolean),
  database: (options: BetterAuthOptions) => createSimAuthAdapter(options),
  session: {
    cookieCache: {
      enabled: true,
      // Better Auth's default, and deliberately short: the cached session is a
      // signed cookie that `getSession` returns WITHOUT re-reading the database,
      // so this is the window in which a revoked, expired, or signed-out session
      // still authenticates. Anything longer is an un-revocable credential — at
      // 24h a sign-out on one device left every other surface looking signed in
      // for a day while every database-backed check (socket handshakes, the
      // desktop handoff) failed against a row that no longer existed. The
      // `version` below only covers org-wide invalidation, so this TTL remains
      // the only bound on per-device sign-out latency.
      maxAge: 5 * 60, // 5 minutes in seconds
      /**
       * Embeds the member org's security-policy version. Bumping the version
       * (policy change, org-wide revocation) invalidates every cached session
       * cookie in the org on its next request, forcing a DB session read —
       * revocation latency becomes the policy cache TTL, not the full `maxAge`.
       */
      version: async (session) =>
        getSessionCookieCacheVersion(session as { userId?: string | null }),
    },
    expiresIn: 30 * 24 * 60 * 60, // 30 days (how long a session can last overall)
    updateAge: 24 * 60 * 60, // 24 hours (how often to refresh the expiry)
    freshAge: 0,
  },
  advanced: {
    ipAddress: {
      ...(trustedProxies.length > 0 ? { trustedProxies } : {}),
    },
  },
  user: {
    /**
     * Account deletion runs through `POST /api/users/me/deletion`, which owns the
     * whole procedure — the blocker preflight, the storage purge, and the
     * constraint-ordered teardown that a bare `DELETE FROM "user"` cannot
     * express. Better Auth's endpoint stays off, and `beforeDelete` refuses
     * unconditionally so that flipping `enabled` can never route a deletion
     * around any of it.
     */
    deleteUser: {
      enabled: false,
      beforeDelete: async () => {
        throw new Error('Account deletion runs through POST /api/users/me/deletion')
      },
    },
  },
  databaseHooks: {
    user: {
      create: {
        before: async (user) => {
          const accessControl = await getAccessControlConfig()
          if (isEmailBlockedByAccessControl(user.email, accessControl)) {
            throw new Error('Sign-ups from this email are not allowed.')
          }
          return { data: user }
        },
        after: async (user) => {
          logger.info('[databaseHooks.user.create.after] User created, initializing stats', {
            userId: user.id,
          })

          try {
            PlatformEvents.userSignedUp({
              userId: user.id,
              authMethod: 'email',
            })
          } catch {
            // Telemetry should not fail the operation
          }

          try {
            const client = getPostHogClient()
            if (client) {
              client.identify({
                distinctId: user.id,
                properties: {
                  ...(user.email ? { email: user.email } : {}),
                  ...(user.name ? { name: user.name } : {}),
                },
              })
            }
          } catch {
            // Telemetry should not fail the operation
          }

          try {
            await handleNewUser(user.id)
          } catch (error) {
            logger.error('[databaseHooks.user.create.after] Failed to initialize user stats', {
              userId: user.id,
              error,
            })
          }

          /**
           * Places the user in the instance organization before they reach the
           * workspace list, so their first workspace is created org-owned and
           * org-scoped enterprise settings apply to it from the start. No-ops
           * unless `INSTANCE_ORG_NAME` is set, and swallows its own failures so
           * organization setup can never block a signup.
           */
          await joinInstanceOrganization(user.id)

          if (isHosted && user.email && user.emailVerified) {
            try {
              const html = await renderWelcomeEmail(user.name || undefined)
              const { from, replyTo } = getPersonalEmailFrom()

              await sendEmail({
                to: user.email,
                subject: getEmailSubject('welcome'),
                html,
                from,
                replyTo,
                emailType: 'transactional',
              })

              logger.info('[databaseHooks.user.create.after] Welcome email sent to OAuth user', {
                userId: user.id,
              })
            } catch (error) {
              logger.error('[databaseHooks.user.create.after] Failed to send welcome email', {
                userId: user.id,
                error,
              })
            }

            try {
              await scheduleLifecycleEmail({
                userId: user.id,
                type: 'onboarding-followup',
                delayDays: 5,
              })
            } catch (error) {
              logger.error(
                '[databaseHooks.user.create.after] Failed to schedule onboarding followup email',
                { userId: user.id, error }
              )
            }
          }
        },
      },
      update: {
        after: async (user) => {
          if (user.banned) {
            await disableUserResources(user.id)
          }
        },
      },
    },
    account: {
      create: {
        before: async (account, context) => {
          const modifiedAccount = { ...account }

          if (context?.path.startsWith('/oauth2/callback/')) {
            try {
              await captureOAuthCredentialDraftBinding(context, () => getOAuthState())
            } catch (error) {
              logger.error('[account.create.before] Failed to read OAuth credential draft state', {
                userId: account.userId,
                providerId: account.providerId,
                error,
              })
              throw error
            }
          }

          if (account.accessToken && isSalesforceOAuthProviderId(account.providerId)) {
            const instanceUrl = await fetchSalesforceInstanceUrl(
              account.providerId,
              account.accessToken
            )
            if (instanceUrl) {
              modifiedAccount.scope = withSalesforceInstanceScope(instanceUrl, account.scope)
            }
          }

          if (isMicrosoftProvider(account.providerId)) {
            modifiedAccount.refreshTokenExpiresAt = getMicrosoftRefreshTokenExpiry()
          }

          // Box token response does not include a scope field, so Better Auth
          // stores nothing. Populate it from the requested scopes so the
          // credential-selector can verify permissions.
          if (account.providerId === 'box' && !account.scope) {
            const requestedScopes = getCanonicalScopesForProvider('box')
            if (requestedScopes.length > 0) {
              modifiedAccount.scope = requestedScopes.join(' ')
            }
          }

          return { data: modifiedAccount }
        },
        after: async (account, context) => {
          /**
           * Migrate credentials from stale account rows to the newly created one.
           *
           * Each `getUserInfo` in `lib/auth/connectors/providers.ts` appends a
           * random UUID to the stable external ID so that Better Auth never
           * blocks cross-user connections — keep the two in step. This means
           * re-connecting the same external identity creates a new row. We detect
           * the stale siblings here by comparing the stable prefix (everything
           * before the trailing UUID), migrate any credential FKs to the new row,
           * then delete the stale rows.
           */
          try {
            const UUID_SUFFIX_RE = /-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
            const stablePrefix = account.accountId.replace(UUID_SUFFIX_RE, '')

            if (stablePrefix && stablePrefix !== account.accountId) {
              const siblings = await db
                .select({ id: schema.account.id, accountId: schema.account.accountId })
                .from(schema.account)
                .where(
                  and(
                    eq(schema.account.userId, account.userId),
                    eq(schema.account.providerId, account.providerId),
                    sql`${schema.account.id} != ${account.id}`
                  )
                )

              const staleRows = siblings.filter(
                (row) => row.accountId.replace(UUID_SUFFIX_RE, '') === stablePrefix
              )

              if (staleRows.length > 0) {
                const staleIds = staleRows.map((row) => row.id)

                await db
                  .update(schema.credential)
                  .set({ accountId: account.id })
                  .where(inArray(schema.credential.accountId, staleIds))

                await db.delete(schema.account).where(inArray(schema.account.id, staleIds))

                logger.info('[account.create.after] Migrated credentials from stale accounts', {
                  userId: account.userId,
                  providerId: account.providerId,
                  newAccountId: account.id,
                  migratedFrom: staleIds,
                })
              }
            }
          } catch (error) {
            logger.error('[account.create.after] Failed to clean up stale accounts', {
              userId: account.userId,
              providerId: account.providerId,
              error,
            })
          }

          /**
           * A fresh Slack connect re-issues the installation's rotating token
           * chain, invalidating the copies held by sibling account rows for the
           * same team (Slack bot tokens are per-installation, not per-grant).
           * Propagate the new chain so every sibling is valid again, and clear
           * the installation's dead flag.
           */
          if (account.providerId === 'slack' && account.accessToken) {
            try {
              const teamId = extractSlackTeamId(account.accountId)
              if (teamId) {
                // Clear the dead flag before fanning out: the connect itself
                // proves the installation has live tokens, and a fan-out
                // failure must not leave the hour-long flag blocking refreshes.
                await clearOAuthRefreshDeadFlag(`slack:${teamId}`)
                await fanOutSlackTokenChain(teamId, {
                  accessToken: account.accessToken,
                  refreshToken: account.refreshToken ?? null,
                  accessTokenExpiresAt: account.accessTokenExpiresAt ?? null,
                })
                logger.info('[account.create.after] Propagated Slack installation token chain', {
                  userId: account.userId,
                  teamId,
                  newAccountId: account.id,
                })
              }
            } catch (error) {
              logger.error('[account.create.after] Failed to propagate Slack token chain', {
                userId: account.userId,
                accountId: account.id,
                error,
              })
            }
          }

          const isOAuth2Callback = context?.path.startsWith('/oauth2/callback/') === true
          const credentialDraftBinding = context
            ? consumeOAuthCredentialDraftBinding(context)
            : undefined

          if (isOAuth2Callback && !credentialDraftBinding) {
            throw new Error(
              'OAuth credential draft binding was not captured before account creation'
            )
          }

          if (credentialDraftBinding) {
            try {
              await processCredentialDraft({
                draftId: credentialDraftBinding.draftId,
                userId: account.userId,
                providerId: account.providerId,
                accountId: account.id,
              })
            } catch (error) {
              logger.error('[account.create.after] Failed to process credential draft', {
                userId: account.userId,
                providerId: account.providerId,
                error,
              })
              if (credentialDraftBinding.draftId) throw error
            }
          }

          try {
            const { ensureUserStatsExists } = await import('@/lib/billing/core/usage')
            await ensureUserStatsExists(account.userId)
          } catch (error) {
            logger.error('[databaseHooks.account.create.after] Failed to ensure user stats', {
              userId: account.userId,
              accountId: account.id,
              error,
            })
          }

          try {
            const [{ value: accountCount }] = await db
              .select({ value: count() })
              .from(schema.account)
              .where(eq(schema.account.userId, account.userId))

            if (accountCount === 1) {
              const { providerId } = account
              const authMethod =
                providerId === 'credential'
                  ? 'email'
                  : SSO_TRUSTED_PROVIDERS.includes(providerId)
                    ? 'sso'
                    : 'oauth'

              captureServerEvent(
                account.userId,
                'user_created',
                {
                  auth_method: authMethod,
                  ...(providerId !== 'credential' ? { provider: providerId } : {}),
                },
                { setOnce: { signup_at: new Date().toISOString() } }
              )
            }
          } catch (error) {
            logger.error(
              '[databaseHooks.account.create.after] Failed to capture user_created event',
              {
                userId: account.userId,
                error,
              }
            )
          }

          if (isSalesforceOAuthProviderId(account.providerId)) {
            const updates: {
              accessTokenExpiresAt?: Date
              scope?: string
            } = {}

            if (!account.accessTokenExpiresAt) {
              updates.accessTokenExpiresAt = new Date(Date.now() + 2 * 60 * 60 * 1000)
            }

            if (account.accessToken) {
              const instanceUrl = await fetchSalesforceInstanceUrl(
                account.providerId,
                account.accessToken
              )
              if (instanceUrl) {
                updates.scope = withSalesforceInstanceScope(instanceUrl, account.scope)
              }
            }

            if (Object.keys(updates).length > 0) {
              await db.update(schema.account).set(updates).where(eq(schema.account.id, account.id))
            }
          }

          if (isMicrosoftProvider(account.providerId)) {
            await db
              .update(schema.account)
              .set({ refreshTokenExpiresAt: getMicrosoftRefreshTokenExpiry() })
              .where(eq(schema.account.id, account.id))
          }

          try {
            PlatformEvents.oauthConnected({
              userId: account.userId,
              provider: account.providerId,
            })
          } catch {
            // Telemetry should not fail the operation
          }
        },
      },
    },
    session: {
      create: {
        before: async (session) => {
          // Blocked emails/domains must not establish sessions, regardless of
          // provider (email/password, OAuth, SSO). Deliberately outside the
          // try below — a thrown APIError must propagate, not be swallowed.
          const accessControl = await getAccessControlConfig()
          if (
            accessControl.blockedSignupDomains.length > 0 ||
            accessControl.blockedEmails.length > 0
          ) {
            const [sessionUser] = await db
              .select({ email: schema.user.email })
              .from(schema.user)
              .where(eq(schema.user.id, session.userId))
              .limit(1)
            if (isEmailBlockedByAccessControl(sessionUser?.email, accessControl)) {
              logger.warn('Blocking session creation for blocked account', {
                userId: session.userId,
              })
              throw new APIError('FORBIDDEN', {
                message: 'Access restricted. Please contact your administrator.',
              })
            }
          }

          try {
            // Find the first organization this user is a member of
            const members = await db
              .select({ organizationId: schema.member.organizationId })
              .from(schema.member)
              .where(eq(schema.member.userId, session.userId))
              .limit(1)

            if (members.length > 0) {
              logger.info('Found organization for user', {
                userId: session.userId,
                organizationId: members[0].organizationId,
              })

              const expiresAt = await clampExpiryForSession(session, members[0].organizationId)

              return {
                data: {
                  ...session,
                  expiresAt,
                  activeOrganizationId: members[0].organizationId,
                },
              }
            }
            logger.info('No organizations found for user', {
              userId: session.userId,
            })
            return { data: session }
          } catch (error) {
            logger.error('Error setting active organization', {
              error,
              userId: session.userId,
            })
            return { data: session }
          }
        },
      },
      update: {
        /**
         * Better Auth's sliding refresh rewrites `expiresAt` to
         * `now + expiresIn` (30 days), which would silently stretch a
         * policy-shortened session back out — re-clamp on every refresh.
         * The current session row is read from the endpoint context; when
         * it is unavailable (non-refresh update paths) the update passes
         * through untouched and the next refresh re-clamps.
         */
        before: async (data, ctx) => {
          if (!data.expiresAt) return { data }
          const current = ctx?.context?.session?.session
          if (!current) return { data }
          const expiresAt = await clampExpiryForSession({
            ...current,
            expiresAt: new Date(data.expiresAt),
          })
          return { data: { ...data, expiresAt } }
        },
      },
    },
  },
  account: {
    accountLinking: {
      enabled: true,
      allowDifferentEmails: true,
      requireLocalEmailVerified: false,
      /**
       * Only providers that verify email ownership may auto-link to an existing
       * account during sign-in. Integration connectors are deliberately absent:
       * they connect through the authenticated `/oauth2/link` flow, which binds
       * to the current session user and never consults this list. `microsoft` is
       * also excluded because it authenticates against the multi-tenant
       * `/common/` endpoint where the email claim is attacker-controllable;
       * leaving it trusted would bypass the email-verified check and allow
       * nOAuth account takeover. Microsoft sign-in still works — it just links
       * to an existing account only when the IdP asserts a verified email.
       */
      trustedProviders: [
        'google',
        'github',
        'email-password',
        ...SSO_TRUSTED_PROVIDERS,
        ...additionalTrustedSsoProviders,
      ],
    },
  },
  /**
   * SSO is deliberately outside the registration gate: it runs on
   * `/sign-in/sso` against admin-configured, domain-verified providers, which
   * is its own allowlist.
   */
  socialProviders: applyRegistrationGate(
    {
      ...(!isGithubAuthDisabled && {
        github: {
          clientId: env.GITHUB_CLIENT_ID as string,
          clientSecret: env.GITHUB_CLIENT_SECRET as string,
          scope: ['user:email', 'repo'],
        },
      }),
      ...(!isGoogleAuthDisabled && {
        google: {
          clientId: env.GOOGLE_CLIENT_ID as string,
          clientSecret: env.GOOGLE_CLIENT_SECRET as string,
          scope: [
            'https://www.googleapis.com/auth/userinfo.email',
            'https://www.googleapis.com/auth/userinfo.profile',
          ],
        },
      }),
      ...(!isMicrosoftAuthDisabled &&
        env.MICROSOFT_CLIENT_ID &&
        env.MICROSOFT_CLIENT_SECRET && {
          microsoft: {
            clientId: env.MICROSOFT_CLIENT_ID,
            clientSecret: env.MICROSOFT_CLIENT_SECRET,
            scope: ['openid', 'profile', 'email'],
            /**
             * `/common/` otherwise silently reuses whichever Microsoft session
             * the browser holds, stranding the user on an orphan Sim account
             * under their personal address.
             */
            prompt: 'select_account' as const,
            mapProfileToUser: mapMicrosoftProfileToUser,
          },
        }),
    },
    isRegistrationDisabled
  ),
  emailVerification: {
    autoSignInAfterVerification: true,
    afterEmailVerification: async (user) => {
      if (isHosted && user.email) {
        try {
          const html = await renderWelcomeEmail(user.name || undefined)
          const { from, replyTo } = getPersonalEmailFrom()

          await sendEmail({
            to: user.email,
            subject: getEmailSubject('welcome'),
            html,
            from,
            replyTo,
            emailType: 'transactional',
          })

          logger.info('[emailVerification.afterEmailVerification] Welcome email sent', {
            userId: user.id,
          })
        } catch (error) {
          logger.error('[emailVerification.afterEmailVerification] Failed to send welcome email', {
            userId: user.id,
            error,
          })
        }

        try {
          await scheduleLifecycleEmail({
            userId: user.id,
            type: 'onboarding-followup',
            delayDays: 5,
          })
        } catch (error) {
          logger.error(
            '[emailVerification.afterEmailVerification] Failed to schedule onboarding followup email',
            { userId: user.id, error }
          )
        }
      }
    },
  },
  emailAndPassword: {
    enabled: true,
    /**
     * Same flag that hides the email/password signup form (DISABLE_EMAIL_SIGNUP).
     * Blocks /sign-up/email at the better-auth layer so ripping out the frontend
     * form cannot be bypassed by calling the endpoint directly. Existing users
     * can still sign in.
     */
    disableSignUp: isEmailSignupDisabled,
    requireEmailVerification: isEmailVerificationEffectivelyEnabled(),
    /**
     * When someone signs up with an already-registered email, better-auth returns a
     * generic success response (OWASP enumeration protection) instead of leaking that
     * the account exists. This callback notifies the real account owner out-of-band,
     * mirroring the privacy-preserving forget-password flow. Errors are swallowed so the
     * response is indistinguishable from a genuine new sign-up.
     */
    onExistingUserSignUp: async ({ user }: { user: User }) => {
      try {
        const html = await renderExistingAccountEmail(user.name || '')
        const result = await sendEmail({
          to: user.email,
          subject: getEmailSubject('existing-account'),
          html,
          from: getFromEmailAddress(),
          emailType: 'transactional',
        })
        if (!result.success) {
          logger.warn('[onExistingUserSignUp] Failed to send existing-account email', {
            message: result.message,
          })
        }
      } catch (error) {
        logger.error('[onExistingUserSignUp] Error sending existing-account email', { error })
      }
    },
    /**
     * The synthetic user returned for the generic duplicate-sign-up response must carry
     * the exact same set of returned fields a real freshly-created user would, otherwise
     * the differing response shape re-opens the enumeration oracle. The admin plugin
     * (always loaded) adds role/banned/banReason/banExpires, and the Stripe plugin — loaded
     * only when billing is enabled — adds stripeCustomerId (null on a new user).
     */
    customSyntheticUser: ({
      coreFields,
      additionalFields,
      id,
    }: {
      coreFields: {
        name: string
        email: string
        emailVerified: boolean
        image: string | null
        createdAt: Date
        updatedAt: Date
      }
      additionalFields: Record<string, unknown>
      id: string
    }) => ({
      ...coreFields,
      role: 'user',
      banned: false,
      banReason: null,
      banExpires: null,
      ...(isBillingEnabled && stripeClient ? { stripeCustomerId: null } : {}),
      ...additionalFields,
      id,
    }),
    sendResetPassword: async ({ user, url, token }, request) => {
      const username = user.name || ''

      const html = await renderPasswordResetEmail(username, url)

      const result = await sendEmail({
        to: user.email,
        subject: getEmailSubject('reset-password'),
        html,
        from: getFromEmailAddress(),
        emailType: 'transactional',
      })

      if (!result.success) {
        throw new Error(`Failed to send reset password email: ${result.message}`)
      }
    },
    onPasswordReset: async ({ user: resetUser }) => {
      const { AuditAction, AuditResourceType, recordAudit } = await import('@sim/audit')
      recordAudit({
        actorId: resetUser.id,
        actorName: resetUser.name,
        actorEmail: resetUser.email,
        action: AuditAction.PASSWORD_RESET,
        resourceType: AuditResourceType.PASSWORD,
        resourceId: resetUser.id,
        description: `Password reset completed for ${resetUser.email}`,
      })
    },
  },
  hooks: {
    before: createAuthMiddleware(async (ctx) => {
      /** Keep direct plugin calls behind the runtime gate without blocking connector OAuth. */
      if (
        ((ctx.path.startsWith('/oauth2/') &&
          ctx.path !== '/oauth2/link' &&
          !ctx.path.startsWith('/oauth2/callback/')) ||
          ctx.path === '/.well-known/oauth-authorization-server') &&
        !(await isOAuthProviderEnabled())
      ) {
        throw new APIError('NOT_FOUND', { message: 'OAuth provider is not enabled' })
      }

      /**
       * Better Auth 1.6.27 re-enters OAuth authorization when its own session
       * refresh sets a cookie, issuing a second code that is never returned.
       * Suppressing sliding renewal only for this request prevents the orphan;
       * the next ordinary session request can still renew the same session.
       */
      if (ctx.path === '/oauth2/authorize') await setShouldSkipSessionRefresh(true)

      /**
       * Restrict the unauthenticated sign-in endpoints to first-party login
       * providers. Better Auth registers every generic-OAuth integration
       * connector as a social provider, so without this guard `microsoft-ad`,
       * `salesforce`, `jira`, and the rest are reachable through
       * `/sign-in/social` and `/sign-in/oauth2` and can mint a session for any
       * user by email (nOAuth account takeover). Connectors are connected only
       * through the authenticated `/oauth2/link` flow, which is unaffected.
       */
      if (ctx.path === '/sign-in/social' || ctx.path === '/sign-in/oauth2') {
        const requestedProviderId = getRequestedSignInProviderId(ctx.path, ctx.body)
        if (!isSignInProviderAllowed(requestedProviderId)) {
          throw new APIError('FORBIDDEN', {
            message:
              'This provider can only be connected from a signed-in account and cannot be used to sign in.',
          })
        }
      }

      /**
       * A user consenting to the Sim CLI is the one moment a human is present
       * in a CLI login, so `cli.use` is checked here to refuse the grant
       * outright. `requireCliAccessAllowed` checks it again on every bearer
       * request, because a consent already on file lets later authorizations
       * skip this endpoint entirely — neither check makes the other redundant.
       *
       * The client id is read from the signed authorize query the consent page
       * forwards. The gate fires if `sim-cli` appears anywhere in it, which is
       * strictly more conservative than the plugin's own first-value read.
       *
       * permission-group-enforced: cli.use — gates OAuth consent for the
       * first-party CLI client, which owns no workspace resource for the
       * authorization funnel to authorize.
       */
      if (ctx.path === '/oauth2/consent') {
        if (consentRequestNamesClient(ctx.body?.oauth_query, SIM_CLI_CLIENT_ID)) {
          const session = await getSessionFromCtx(ctx)
          const userId = session?.user?.id
          if (userId && (await isCapabilityWithheldForUser(userId, 'cli.use'))) {
            logger.warn('CLI OAuth consent blocked by permission group', { userId })
            throw new APIError('FORBIDDEN', { message: capabilityRefusal('cli.use') })
          }
        }
      }

      if (ctx.path === '/oauth2/link' && ctx.body?.providerId === MICROSOFT_DATAVERSE_PROVIDER_ID) {
        try {
          assertMicrosoftDataverseOAuthLinkRequest(
            ctx.body.callbackURL,
            ctx.body.scopes,
            getCanonicalScopesForProvider(MICROSOFT_DATAVERSE_PROVIDER_ID)
          )
        } catch (error) {
          throw new APIError('BAD_REQUEST', {
            message: getErrorMessage(error, 'Invalid Dataverse OAuth request'),
          })
        }
      }

      if (ctx.path.startsWith('/sign-up') && isRegistrationDisabled)
        throw new APIError('FORBIDDEN', {
          message: 'Registration is disabled, please contact your admin.',
        })

      if (!isEmailPasswordEnabled) {
        const emailPasswordPaths = ['/sign-in/email', '/sign-up/email', '/email-otp']
        if (emailPasswordPaths.some((path) => ctx.path.startsWith(path)))
          throw new APIError('FORBIDDEN', {
            message: 'Email/password authentication is disabled. Please use SSO to sign in.',
          })
      }

      const isSignIn = ctx.path.startsWith('/sign-in')
      const isSignUp = ctx.path.startsWith('/sign-up')

      if (isSignIn || isSignUp) {
        const accessControl = await getAccessControlConfig()
        const requestEmail = ctx.body?.email?.toLowerCase()

        // Banning an existing account is owned by better-auth's admin plugin (a
        // `session.create.before` hook that blocks banned users at sign-in across
        // all providers), so it is not re-checked here.
        const hasAllowlist =
          accessControl.allowedLoginEmails.length > 0 ||
          accessControl.allowedLoginDomains.length > 0
        if (hasAllowlist && requestEmail) {
          const emailDomain = requestEmail.split('@')[1]
          const isAllowed =
            accessControl.allowedLoginEmails.includes(requestEmail) ||
            (!!emailDomain && accessControl.allowedLoginDomains.includes(emailDomain))
          if (!isAllowed) {
            throw new APIError('FORBIDDEN', {
              message: 'Access restricted. Please contact your administrator.',
            })
          }
        }

        // Blocked emails/domains gate both signup and sign-in. OAuth/SSO sign-ins
        // have no email in the body here; the session.create.before hook covers them.
        if (isEmailBlockedByAccessControl(requestEmail, accessControl)) {
          throw new APIError('FORBIDDEN', {
            message: isSignUp
              ? 'Sign-ups from this email are not allowed.'
              : 'Access restricted. Please contact your administrator.',
          })
        }

        if (
          isSignupMxValidationEnabled &&
          ctx.path.startsWith('/sign-up/email') &&
          ctx.body?.email
        ) {
          const mxCheck = await validateSignupEmailMx(
            ctx.body.email,
            accessControl.blockedEmailMxHosts
          )
          if (!mxCheck.allowed) {
            throw new APIError('FORBIDDEN', {
              message: 'Sign-ups from this email domain are not allowed.',
            })
          }
        }
      }

      /**
       * Personal checkout guard. The Stripe plugin's `authorizeReference`
       * only runs for organization references (it skips references equal to
       * the session user), so personal checkout admission lives here. It
       * prevents both a duplicate checkout while Stripe payment is pending
       * and a personal plan for someone already covered by an organization.
       */
      if (isBillingEnabled && ctx.path === '/subscription/upgrade') {
        const session = await getSessionFromCtx(ctx)
        const sessionUserId = session?.user?.id
        if (sessionUserId) {
          const requestBody = ctx.body ?? {}
          const referenceId = resolveCheckoutReferenceId(
            requestBody,
            sessionUserId,
            getActiveOrganizationId(session)
          )
          if (referenceId) {
            const checkoutAdmissionClaim = await claimCheckoutAdmission(referenceId)
            try {
              if (isPersonalCheckoutRequest(requestBody, sessionUserId)) {
                await assertPersonalCheckoutAllowed(sessionUserId)
              }
            } catch (error) {
              await releaseCheckoutAdmission(checkoutAdmissionClaim)
              throw error
            }
            return { context: { billingCheckoutAdmissionClaim: checkoutAdmissionClaim } }
          }
        }
      }

      return
    }),
    after: createAuthMiddleware(async (ctx) => {
      if (isBillingEnabled && ctx.path === '/subscription/upgrade') {
        const checkoutContext = ctx as typeof ctx & {
          billingCheckoutAdmissionClaim?: CheckoutAdmissionClaim
        }
        if (checkoutContext.billingCheckoutAdmissionClaim) {
          await releaseCheckoutAdmission(checkoutContext.billingCheckoutAdmissionClaim)
        }
      }

      if (!isSsoEnabled) return
      const oauthState = ctx.path === '/sso/callback' ? await getOAuthState() : null
      const providerId = resolveSsoCallbackProviderId({
        path: ctx.path,
        routeProviderId: ctx.params?.providerId,
        stateProviderId: oauthState?.ssoProviderId,
      })
      if (!providerId) return

      const newSession = ctx.context.newSession
      if (!newSession?.session || !newSession.user) return

      let admissionErrorCode: string | null = null
      try {
        const admission = await admitSsoUser.execute({
          principal: {
            kind: 'session',
            userId: newSession.user.id,
            sessionId: newSession.session.id,
          },
          input: { providerId },
        })

        if (admission.kind === 'denied') {
          admissionErrorCode =
            admission.reason === 'seats-unavailable'
              ? 'sso_no_seats'
              : admission.reason === 'organization-conflict'
                ? 'sso_account_conflict'
                : 'sso_provisioning_failed'
          logger.warn('Rejected SSO organization admission', {
            userId: newSession.user.id,
            providerId,
            reason: admission.reason,
          })
        } else if (admission.kind === 'provisioned' || admission.kind === 'already-member') {
          const expiresAt = await clampExpiryForSession(
            newSession.session,
            admission.organizationId
          )
          const updatedSession = await ctx.context.internalAdapter.updateSession(
            newSession.session.token,
            {
              activeOrganizationId: admission.organizationId,
              ...(expiresAt ? { expiresAt } : {}),
            }
          )
          if (!updatedSession) {
            admissionErrorCode = 'sso_provisioning_failed'
            logger.error('Failed to activate organization on the new SSO session', {
              userId: newSession.user.id,
              providerId,
              organizationId: admission.organizationId,
            })
          } else {
            deleteSessionCookie(ctx, true)
            await setSessionCookie(ctx, {
              session: updatedSession,
              user: newSession.user,
            })
          }
        }
      } catch (error) {
        admissionErrorCode = 'sso_provisioning_failed'
        logger.error('SSO organization admission failed', {
          userId: newSession.user.id,
          providerId,
          error,
        })
      }

      if (!admissionErrorCode) return

      try {
        await ctx.context.internalAdapter.deleteSession(newSession.session.token)
      } catch (error) {
        logger.error('Failed to delete rejected SSO session', {
          userId: newSession.user.id,
          providerId,
          sessionId: newSession.session.id,
          error,
        })
      }
      deleteSessionCookie(ctx)
      throw ctx.redirect(
        buildSsoAdmissionErrorUrl(admissionErrorCode, ctx.context.responseHeaders?.get('location'))
      )
    }),
  },
  plugins: [
    ...(env.TURNSTILE_SECRET_KEY
      ? [
          captcha({
            provider: 'cloudflare-turnstile',
            secretKey: env.TURNSTILE_SECRET_KEY,
            endpoints: ['/sign-up/email'],
          }),
        ]
      : []),
    admin(),
    oneTimeToken({
      expiresIn: 24 * 60, // 24 hours in minutes (better-auth's expiresIn unit)
    }),
    customSession(async ({ user, session }) => ({
      user,
      session,
    })),
    emailOTP({
      sendVerificationOTP: async (data) => {
        if (!isEmailVerificationEnabled) {
          logger.info('Skipping email verification')
          return
        }
        try {
          if (!data.email) {
            throw new Error('Email is required')
          }

          const validation = quickValidateEmail(data.email)
          if (!validation.isValid) {
            logger.warn('Email validation failed', {
              email: data.email,
              reason: validation.reason,
              checks: validation.checks,
            })
            throw new Error(
              validation.reason ||
                "We are unable to deliver the verification email to that address. Please make sure it's valid and able to receive emails."
            )
          }

          const html = await renderOTPEmail(data.otp, data.email, data.type)

          const result = await sendEmail({
            to: data.email,
            subject: getEmailSubject(data.type),
            html,
            from: getFromEmailAddress(),
            emailType: 'transactional',
          })

          if (!result.success && result.message.includes('no email service configured')) {
            logger.info('🔑 VERIFICATION CODE FOR LOGIN/SIGNUP', {
              email: data.email,
              otp: data.otp,
              type: data.type,
              validation: validation.checks,
            })
            return
          }

          if (!result.success) {
            throw new Error(`Failed to send verification code: ${result.message}`)
          }
        } catch (error) {
          logger.error('Error sending verification code:', {
            error,
            email: data.email,
          })
          throw error
        }
      },
      /**
       * Without this, /sign-in/email-otp auto-registers any unknown email —
       * bypassing the signup gate entirely (no captcha, no /sign-up path).
       * Gated by the same DISABLE_EMAIL_SIGNUP flag as the signup form (and by
       * DISABLE_REGISTRATION, whose /sign-up path check has the same blind
       * spot); when set, better-auth also silently skips sending OTPs to
       * unknown emails (enumeration-safe) while existing users keep OTP
       * sign-in.
       */
      disableSignUp: isEmailSignupDisabled || isRegistrationDisabled,
      sendVerificationOnSignUp: false,
      otpLength: 6, // Explicitly set the OTP length
      expiresIn: 15 * 60, // 15 minutes in seconds
      overrideDefaultEmailVerification: true,
    }),
    genericOAuth({
      config: buildConnectorProviders(),
    }),
    /**
     * Sim as an OAuth 2.0 authorization server (auth-code + PKCE, refresh
     * rotation). Tokens are opaque and stored hashed, so revoking an app in
     * settings takes effect on the next request. `sim logout` deletes the
     * stable family for that login, including access tokens issued before an
     * earlier rotation. This is an OAuth API-authorization surface, not an
     * OpenID Connect identity provider; `disableJwtPlugin` keeps JWT/JWKS and
     * ID-token semantics out of the advertised protocol. Clients are DB rows
     * only (the CLI is seeded by migration, the rest are admin-created), so
     * both registration paths stay closed.
     *
     * Register once; request-time gates let AppConfig change availability
     * without a restart.
     */
    ...(!isAuthDisabled
      ? [
          oauthProvider({
            loginPage: '/oauth/sign-in',
            consentPage: '/oauth/consent',
            scopes: [...OAUTH_SCOPES],
            grantTypes: ['authorization_code', 'refresh_token'],
            /**
             * Lets the consent page resolve the display-safe client metadata
             * through the plugin's signed-query endpoint. The endpoint remains
             * unusable for handwritten or expired authorization URLs because
             * Better Auth verifies `oauth_query` before reading the client.
             */
            allowPublicClientPrelogin: true,
            allowDynamicClientRegistration: false,
            allowUnauthenticatedClientRegistration: false,
            /**
             * No endpoint may read or change a client row. Clients are created
             * by an operator running `create-oauth-client.ts`, so every one of
             * the plugin's client CRUD endpoints — create, read, list, update,
             * delete, rotate — is refused at the source. The route-level POST
             * blocklist stays as defence in depth, but this is what closes the
             * `GET` readers it cannot see, and what keeps a future plugin
             * version from mounting a seventh endpoint into an open door.
             *
             * The consent page's client lookup is unaffected:
             * `public-client-prelogin` does not consult this hook and instead
             * requires the signed authorization query.
             */
            clientPrivileges: () => false,
            /**
             * Opaque access tokens let Settings revoke every token for an app
             * on the next request and let `sim logout` revoke one independent
             * login family, including access tokens from earlier rotations. A
             * JWT would remain valid until it lapsed regardless of the delete.
             *
             * Better Auth requires reversibly encrypted client secrets in its
             * disabled-JWT mode; selecting `hashed` is refused at provider
             * construction. `storeClientSecret` therefore stays at the
             * plugin's `encrypted` default, under `BETTER_AUTH_SECRET`, and
             * `create-oauth-client.ts` writes secrets the same way.
             */
            disableJwtPlugin: true,
            storeTokens: { hash: hashOAuthToken },
            prefix: {
              opaqueAccessToken: OAUTH_ACCESS_TOKEN_PREFIX,
              refreshToken: OAUTH_REFRESH_TOKEN_PREFIX,
            },
            accessTokenExpiresIn: OAUTH_ACCESS_TOKEN_TTL_SECONDS,
            refreshTokenExpiresIn: OAUTH_REFRESH_TOKEN_TTL_SECONDS,
            codeExpiresIn: OAUTH_CODE_TTL_SECONDS,
          }),
        ]
      : []),
    /**
     * Include SSO plugin when enabled. Resolved through `isSsoEnabled` rather
     * than the raw env var so the `ENTERPRISE_ENABLED` suite switch registers
     * the plugin too — reading `env.SSO_ENABLED` here would leave the settings
     * section visible and `hasSSOAccess` passing while sign-in silently had no
     * SSO provider behind it.
     */
    ...(isSsoEnabled
      ? [
          sso({
            /**
             * MUST stay false. Better Auth's link gate is
             * `!isTrustedProvider && !userInfo.emailVerified`, so a true
             * `email_verified` claim substitutes for the domain binding
             * entirely: an IdP could assert any address — including one from a
             * domain it does not own — and auto-link into that user's existing
             * account. Since a provider row can be registered by any Enterprise
             * org admin (and by any signed-in user when self-hosted), trusting
             * the claim makes every account reachable from any tenant's IdP.
             *
             * Turning it on only ever set `emailVerified` on the local row; it
             * was never what made linking work. Entra omits the claim, and SAML
             * ignores it without an explicit `mapping.emailVerified` that the
             * register contract does not accept — so SSO users are created
             * unverified either way, and `domainVerification` below is the sole
             * linking trust source, which is what `trustProviderByName: false`
             * already assumes.
             */
            trustEmailVerified: false,
            /**
             * Marks a provider authoritative for its domain, which is what lets an
             * SSO sign-in auto-link to an existing same-email account. Without it
             * `isTrustedProvider` is always false and every user who already had a
             * Sim account is stranded on "account not linked".
             *
             * Sim does not use Better Auth's DNS challenge endpoints: ownership is
             * proven by the `sso_domain` flow before registration, and the register
             * route mirrors that decision onto this flag.
             *
             * With `trustEmailVerified` off this is the only path to linking, and
             * it is domain-scoped: `isTrustedProvider` additionally requires
             * `validateEmailDomain(userInfo.email, provider.domain)`, so a
             * provider can only ever claim identities inside the domain it proved.
             */
            domainVerification: { enabled: true },
            organizationProvisioning: {
              /**
               * Better Auth writes member rows directly and bypasses Sim's seat,
               * billing, session-policy, and audit invariants. Admission is owned
               * by the application use case in the callback hook above.
               */
              disabled: true,
              defaultRole: 'member',
            },
          }),
        ]
      : []),
    // Only include the Stripe plugin when billing is enabled
    ...(isBillingEnabled && stripeClient
      ? [
          stripe({
            stripeClient,
            stripeWebhookSecret: env.STRIPE_WEBHOOK_SECRET || '',
            createCustomerOnSignUp: true,
            onCustomerCreate: async ({ stripeCustomer, user }) => {
              logger.info('[onCustomerCreate] Stripe customer created', {
                stripeCustomerId: stripeCustomer.id,
                userId: user.id,
              })
            },
            subscription: {
              enabled: true,
              plans: getPlans(),
              authorizeReference: async ({ user, referenceId, action }, ctx) => {
                const body: unknown = ctx?.body
                const requestedPlan =
                  typeof body === 'object' &&
                  body !== null &&
                  'plan' in body &&
                  typeof body.plan === 'string'
                    ? body.plan
                    : undefined
                return await authorizeSubscriptionReference(
                  user.id,
                  referenceId,
                  action,
                  requestedPlan
                )
              },
              getCheckoutSessionParams: async () => ({
                params: { allow_promotion_codes: true },
              }),
              onSubscriptionComplete: async ({
                event,
                stripeSubscription,
                subscription,
              }: {
                event: Stripe.Event
                stripeSubscription: Stripe.Subscription
                subscription: any
              }) => {
                const { priceId, planFromStripe, isAnnual } =
                  resolvePlanFromStripeSubscription(stripeSubscription)

                logger.info('[onSubscriptionComplete] Subscription created', {
                  subscriptionId: subscription.id,
                  referenceId: subscription.referenceId,
                  dbPlan: subscription.plan,
                  planFromStripe,
                  priceId,
                  isAnnual,
                  status: subscription.status,
                })

                if (!planFromStripe) {
                  logger.error(
                    '[onSubscriptionComplete] Could not resolve plan from Stripe price — check env var configuration',
                    { subscriptionId: subscription.id, dbPlan: subscription.plan, priceId }
                  )
                }

                const syncedPlan = await syncSubscriptionPlan(
                  subscription.id,
                  subscription.plan,
                  planFromStripe,
                  subscription.referenceId
                )

                const subscriptionForOrg = {
                  ...subscription,
                  plan: syncedPlan ?? subscription.plan,
                  enterpriseOperationId: stripeSubscription.metadata?.enterpriseOperationId ?? null,
                }

                let resolvedSubscription = subscription
                try {
                  resolvedSubscription =
                    await ensureOrganizationForTeamSubscription(subscriptionForOrg)
                } catch (orgError) {
                  logger.error(
                    '[onSubscriptionComplete] Failed to ensure organization for team subscription',
                    {
                      subscriptionId: subscription.id,
                      referenceId: subscription.referenceId,
                      dbPlan: subscription.plan,
                      planFromStripe,
                      error: toError(orgError).message,
                      stack: orgError instanceof Error ? orgError.stack : undefined,
                    }
                  )
                  throw orgError
                }

                /**
                 * Transactional fence behind the personal-checkout admission
                 * guard: if the user joined a paid organization while their
                 * checkout was in flight, pause the fresh personal Pro at
                 * period end (same state a paid-org joiner's personal Pro
                 * enters; restored automatically if they leave the org).
                 *
                 * Runs BEFORE the free→paid transition handling: a personal
                 * subscription born covered is not a free→paid transition —
                 * the org plan keeps governing the user — so the usage reset
                 * (which would wipe org-attributed current-period usage) and
                 * its instrumentation must not run. Gated on `covered`, not
                 * `paused`, so event retries decide identically even when the
                 * join path already paused the subscription.
                 */
                const coveredByOrganization = isPro(resolvedSubscription.plan)
                  ? (await pauseProSubscriptionForOrgCoverage(resolvedSubscription.referenceId))
                      .covered
                  : false

                if (!coveredByOrganization) {
                  await handleSubscriptionCreated(resolvedSubscription, event.id)
                }

                await syncSubscriptionUsageLimits(resolvedSubscription)

                await writeBillingInterval(resolvedSubscription.id, isAnnual ? 'year' : 'month')

                await sendPlanWelcomeEmail(resolvedSubscription)
              },
              onSubscriptionUpdate: async ({
                event,
                subscription,
              }: {
                event: Stripe.Event
                subscription: any
              }) => {
                const stripeSubscription = event.data.object as Stripe.Subscription
                const { priceId, planFromStripe, isTeamPlan, isAnnual } =
                  resolvePlanFromStripeSubscription(stripeSubscription)

                if (priceId && !planFromStripe) {
                  logger.warn(
                    '[onSubscriptionUpdate] Could not determine plan from Stripe price ID',
                    {
                      subscriptionId: subscription.id,
                      priceId,
                      dbPlan: subscription.plan,
                    }
                  )
                }

                const referenceOrganizationId = await getOrganizationIdForSubscriptionReference(
                  subscription.referenceId
                )
                const isUpgradeToTeam =
                  isTeamPlan && !isTeam(subscription.plan) && referenceOrganizationId == null

                logger.info('[onSubscriptionUpdate] Subscription updated', {
                  subscriptionId: subscription.id,
                  status: subscription.status,
                  dbPlan: subscription.plan,
                  planFromStripe,
                  isUpgradeToTeam,
                  isAnnual,
                  referenceId: subscription.referenceId,
                  referenceOrganizationId,
                })

                if (!planFromStripe) {
                  logger.error(
                    '[onSubscriptionUpdate] Could not resolve plan from Stripe price — org creation may be skipped for team upgrades',
                    { subscriptionId: subscription.id, dbPlan: subscription.plan }
                  )
                }

                const syncedPlan = await syncSubscriptionPlan(
                  subscription.id,
                  subscription.plan,
                  planFromStripe,
                  subscription.referenceId
                )

                /**
                 * All downstream processing keys off the plan the DB actually
                 * holds after the sync — a plan write refused by the org/plan
                 * invariant must not leak the rejected Stripe plan into org
                 * resolution, seat sync, or usage limits.
                 */
                const effectivePlanForTeamFeatures = syncedPlan ?? subscription.plan

                const subscriptionForOrg = {
                  ...subscription,
                  plan: effectivePlanForTeamFeatures,
                  enterpriseOperationId: stripeSubscription.metadata?.enterpriseOperationId ?? null,
                }

                let resolvedSubscription = subscription
                try {
                  resolvedSubscription =
                    await ensureOrganizationForTeamSubscription(subscriptionForOrg)

                  if (isUpgradeToTeam) {
                    logger.info(
                      '[onSubscriptionUpdate] Detected Pro -> Team upgrade, ensured organization creation',
                      {
                        subscriptionId: subscription.id,
                        originalPlan: subscription.plan,
                        newPlan: planFromStripe,
                        resolvedReferenceId: resolvedSubscription.referenceId,
                      }
                    )
                  }
                } catch (orgError) {
                  logger.error(
                    '[onSubscriptionUpdate] Failed to ensure organization for team subscription',
                    {
                      subscriptionId: subscription.id,
                      referenceId: subscription.referenceId,
                      dbPlan: subscription.plan,
                      planFromStripe,
                      isUpgradeToTeam,
                      error: toError(orgError).message,
                      stack: orgError instanceof Error ? orgError.stack : undefined,
                    }
                  )
                  throw orgError
                }

                try {
                  await syncSubscriptionUsageLimits(resolvedSubscription)
                } catch (error) {
                  logger.error('[onSubscriptionUpdate] Failed to sync usage limits', {
                    subscriptionId: resolvedSubscription.id,
                    referenceId: resolvedSubscription.referenceId,
                    error,
                  })
                }

                if (isTeam(effectivePlanForTeamFeatures)) {
                  try {
                    const quantity = stripeSubscription.items?.data?.[0]?.quantity || 1

                    const result = await syncSeatsFromStripeQuantity(
                      resolvedSubscription.id,
                      resolvedSubscription.seats ?? null,
                      quantity
                    )

                    if (result.synced) {
                      logger.info('[onSubscriptionUpdate] Synced seat count from Stripe', {
                        subscriptionId: resolvedSubscription.id,
                        referenceId: resolvedSubscription.referenceId,
                        previousSeats: result.previousSeats,
                        newSeats: result.newSeats,
                      })
                    }
                  } catch (error) {
                    logger.error('[onSubscriptionUpdate] Failed to sync seat count', {
                      subscriptionId: resolvedSubscription.id,
                      referenceId: resolvedSubscription.referenceId,
                      error,
                    })
                  }
                }

                await writeBillingInterval(resolvedSubscription.id, isAnnual ? 'year' : 'month')
              },
              onSubscriptionDeleted: async ({
                event,
                subscription,
              }: {
                event: Stripe.Event
                stripeSubscription: Stripe.Subscription
                subscription: any
              }) => {
                logger.info('[onSubscriptionDeleted] Subscription deleted', {
                  eventId: event.id,
                  subscriptionId: subscription.id,
                  referenceId: subscription.referenceId,
                })

                try {
                  await handleSubscriptionDeleted(subscription, event.id)
                } catch (error) {
                  logger.error('[onSubscriptionDeleted] Failed to handle subscription deletion', {
                    eventId: event.id,
                    subscriptionId: subscription.id,
                    referenceId: subscription.referenceId,
                    error,
                  })
                  // Rethrow so the Stripe webhook retries — otherwise
                  // the final overage invoice, usage reset, org cleanup,
                  // and personal Pro restore can be permanently skipped.
                  throw error
                }
              },
            },
            onEvent: async (event: Stripe.Event) => {
              logger.info('[onEvent] Received Stripe webhook', {
                eventId: event.id,
                eventType: event.type,
              })

              try {
                switch (event.type) {
                  case 'invoice.payment_succeeded': {
                    await handleInvoicePaymentSucceeded(event)
                    break
                  }
                  case 'invoice.payment_failed': {
                    await handleInvoicePaymentFailed(event)
                    break
                  }
                  case 'customer.subscription.created':
                  case 'customer.subscription.updated': {
                    await handleManualEnterpriseSubscription(event)
                    break
                  }
                  case 'checkout.session.expired': {
                    await handleAbandonedCheckout(event)
                    break
                  }
                  case 'charge.dispute.created': {
                    await handleChargeDispute(event)
                    break
                  }
                  case 'charge.dispute.closed': {
                    await handleDisputeClosed(event)
                    break
                  }
                  default:
                    logger.info('[onEvent] Ignoring unsupported webhook event', {
                      eventId: event.id,
                      eventType: event.type,
                    })
                    break
                }

                logger.info('[onEvent] Successfully processed webhook', {
                  eventId: event.id,
                  eventType: event.type,
                })
              } catch (error) {
                logger.error('[onEvent] Failed to process webhook', {
                  eventId: event.id,
                  eventType: event.type,
                  error,
                })
                throw error
              }
            },
          }),
        ]
      : []),
    ...(isOrganizationsEnabled
      ? [
          organization({
            allowUserToCreateOrganization: async () => false,
            disableOrganizationDeletion: true,
            requireEmailVerificationOnInvitation: isEmailVerificationEffectivelyEnabled(),
            organizationHooks: {
              afterCreateOrganization: async ({ organization, user }) => {
                logger.info('[organizationHooks.afterCreateOrganization] Organization created', {
                  organizationId: organization.id,
                  creatorId: user.id,
                })
              },
            },
          }),
        ]
      : []),
    nextCookies(),
  ],
})

async function getSessionImpl() {
  if (isAuthDisabled) {
    await ensureAnonymousUserExists()
    return createAnonymousSession()
  }

  const hdrs = await headers()
  return await auth.api.getSession({
    headers: hdrs,
  })
}

export const getSession = cache(getSessionImpl)
