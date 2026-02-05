import { sso } from '@better-auth/sso'
import { stripe } from '@better-auth/stripe'
import { db } from '@sim/db'
import * as schema from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { betterAuth } from 'better-auth'
import { drizzleAdapter } from 'better-auth/adapters/drizzle'
import { nextCookies } from 'better-auth/next-js'
import {
  createAuthMiddleware,
  customSession,
  emailOTP,
  genericOAuth,
  oneTimeToken,
  organization,
} from 'better-auth/plugins'
import { and, eq } from 'drizzle-orm'
import { headers } from 'next/headers'
import Stripe from 'stripe'
import {
  getEmailSubject,
  renderOTPEmail,
  renderPasswordResetEmail,
  renderWelcomeEmail,
} from '@/components/emails'
import { sendPlanWelcomeEmail } from '@/lib/billing'
import { authorizeSubscriptionReference } from '@/lib/billing/authorization'
import { handleNewUser } from '@/lib/billing/core/usage'
import {
  ensureOrganizationForTeamSubscription,
  syncSubscriptionUsageLimits,
} from '@/lib/billing/organization'
import { getPlans, resolvePlanFromStripeSubscription } from '@/lib/billing/plans'
import { syncSeatsFromStripeQuantity } from '@/lib/billing/validation/seat-management'
import { handleChargeDispute, handleDisputeClosed } from '@/lib/billing/webhooks/disputes'
import { handleManualEnterpriseSubscription } from '@/lib/billing/webhooks/enterprise'
import {
  handleInvoiceFinalized,
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
  isEmailVerificationEnabled,
  isHosted,
  isOrganizationsEnabled,
  isRegistrationDisabled,
} from '@/lib/core/config/feature-flags'
import { PlatformEvents } from '@/lib/core/telemetry'
import { getBaseUrl } from '@/lib/core/utils/urls'
import { sendEmail } from '@/lib/messaging/email/mailer'
import { getFromEmailAddress, getPersonalEmailFrom } from '@/lib/messaging/email/utils'
import { quickValidateEmail } from '@/lib/messaging/email/validation'
import { syncAllWebhooksForCredentialSet } from '@/lib/webhooks/utils.server'
import { SSO_TRUSTED_PROVIDERS } from '@/ee/sso/constants'
import { createAnonymousSession, ensureAnonymousUserExists } from './anonymous'

const logger = createLogger('Auth')

import { getMicrosoftRefreshTokenExpiry, isMicrosoftProvider } from '@/lib/oauth/microsoft'

const validStripeKey = env.STRIPE_SECRET_KEY

let stripeClient = null
if (validStripeKey) {
  stripeClient = new Stripe(env.STRIPE_SECRET_KEY || '', {
    apiVersion: '2025-08-27.basil',
  })
}

export const auth = betterAuth({
  baseURL: getBaseUrl(),
  trustedOrigins: [
    getBaseUrl(),
    ...(env.NEXT_PUBLIC_SOCKET_URL ? [env.NEXT_PUBLIC_SOCKET_URL] : []),
  ].filter(Boolean),
  database: drizzleAdapter(db, {
    provider: 'pg',
    schema,
  }),
  session: {
    cookieCache: {
      enabled: true,
      maxAge: 24 * 60 * 60, // 24 hours in seconds
    },
    expiresIn: 30 * 24 * 60 * 60, // 30 days (how long a session can last overall)
    updateAge: 24 * 60 * 60, // 24 hours (how often to refresh the expiry)
    freshAge: 60 * 60, // 1 hour (or set to 0 to disable completely)
  },
  databaseHooks: {
    user: {
      create: {
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
            await handleNewUser(user.id)
          } catch (error) {
            logger.error('[databaseHooks.user.create.after] Failed to initialize user stats', {
              userId: user.id,
              error,
            })
          }

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
          }
        },
      },
    },
    account: {
      create: {
        before: async (account) => {
          // Only one credential per (userId, providerId) is allowed
          // If user reconnects (even with a different external account), delete the old one
          // and let Better Auth create the new one (returning false breaks account linking flow)
          const existing = await db.query.account.findFirst({
            where: and(
              eq(schema.account.userId, account.userId),
              eq(schema.account.providerId, account.providerId)
            ),
          })

          const modifiedAccount = { ...account }

          if (account.providerId === 'salesforce' && account.accessToken) {
            try {
              const response = await fetch(
                'https://login.salesforce.com/services/oauth2/userinfo',
                {
                  headers: {
                    Authorization: `Bearer ${account.accessToken}`,
                  },
                }
              )

              if (response.ok) {
                const data = await response.json()

                if (data.profile) {
                  const match = data.profile.match(/^(https:\/\/[^/]+)/)
                  if (match && match[1] !== 'https://login.salesforce.com') {
                    const instanceUrl = match[1]
                    modifiedAccount.scope = `__sf_instance__:${instanceUrl} ${account.scope}`
                  }
                }
              }
            } catch (error) {
              logger.error('Failed to fetch Salesforce instance URL', { error })
            }
          }

          // Handle Microsoft refresh token expiry
          if (isMicrosoftProvider(account.providerId)) {
            modifiedAccount.refreshTokenExpiresAt = getMicrosoftRefreshTokenExpiry()
          }

          if (existing) {
            // Delete the existing account so Better Auth can create the new one
            // This allows account linking/re-authorization to succeed
            await db.delete(schema.account).where(eq(schema.account.id, existing.id))

            // Preserve the existing account ID so references (like workspace notifications) continue to work
            modifiedAccount.id = existing.id

            logger.info('[account.create.before] Deleted existing account for re-authorization', {
              userId: account.userId,
              providerId: account.providerId,
              existingAccountId: existing.id,
              preservingId: true,
            })

            // Sync webhooks for credential sets after reconnecting (in after hook)
          }

          return { data: modifiedAccount }
        },
        after: async (account) => {
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

          if (account.providerId === 'salesforce') {
            const updates: {
              accessTokenExpiresAt?: Date
              scope?: string
            } = {}

            if (!account.accessTokenExpiresAt) {
              updates.accessTokenExpiresAt = new Date(Date.now() + 2 * 60 * 60 * 1000)
            }

            if (account.accessToken) {
              try {
                const response = await fetch(
                  'https://login.salesforce.com/services/oauth2/userinfo',
                  {
                    headers: {
                      Authorization: `Bearer ${account.accessToken}`,
                    },
                  }
                )

                if (response.ok) {
                  const data = await response.json()

                  if (data.profile) {
                    const match = data.profile.match(/^(https:\/\/[^/]+)/)
                    if (match && match[1] !== 'https://login.salesforce.com') {
                      const instanceUrl = match[1]
                      updates.scope = `__sf_instance__:${instanceUrl} ${account.scope}`
                    }
                  }
                }
              } catch (error) {
                logger.error('Failed to fetch Salesforce instance URL', { error })
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

          // Sync webhooks for credential sets after connecting a new credential
          const requestId = crypto.randomUUID().slice(0, 8)
          const userMemberships = await db
            .select({
              credentialSetId: schema.credentialSetMember.credentialSetId,
              providerId: schema.credentialSet.providerId,
            })
            .from(schema.credentialSetMember)
            .innerJoin(
              schema.credentialSet,
              eq(schema.credentialSetMember.credentialSetId, schema.credentialSet.id)
            )
            .where(
              and(
                eq(schema.credentialSetMember.userId, account.userId),
                eq(schema.credentialSetMember.status, 'active')
              )
            )

          for (const membership of userMemberships) {
            if (membership.providerId === account.providerId) {
              try {
                await syncAllWebhooksForCredentialSet(membership.credentialSetId, requestId)
                logger.info('[account.create.after] Synced webhooks after credential connect', {
                  credentialSetId: membership.credentialSetId,
                  providerId: account.providerId,
                })
              } catch (error) {
                logger.error(
                  '[account.create.after] Failed to sync webhooks after credential connect',
                  {
                    credentialSetId: membership.credentialSetId,
                    providerId: account.providerId,
                    error,
                  }
                )
              }
            }
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
          try {
            // Find the first organization this user is a member of
            const members = await db
              .select()
              .from(schema.member)
              .where(eq(schema.member.userId, session.userId))
              .limit(1)

            if (members.length > 0) {
              logger.info('Found organization for user', {
                userId: session.userId,
                organizationId: members[0].organizationId,
              })

              return {
                data: {
                  ...session,
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
    },
  },
  account: {
    accountLinking: {
      enabled: true,
      allowDifferentEmails: true,
      trustedProviders: [
        'google',
        'github',
        'email-password',
        'confluence',
        'x',
        'notion',
        'microsoft',
        'slack',
        'reddit',
        'webflow',
        'asana',
        'pipedrive',
        'hubspot',
        'linkedin',
        'spotify',
        'google-email',
        'google-calendar',
        'google-drive',
        'google-docs',
        'google-sheets',
        'google-forms',
        'google-vault',
        'google-groups',
        'vertex-ai',
        'github-repo',
        'microsoft-teams',
        'microsoft-excel',
        'microsoft-planner',
        'outlook',
        'onedrive',
        'sharepoint',
        'jira',
        'airtable',
        'dropbox',
        'salesforce',
        'wealthbox',
        'zoom',
        'wordpress',
        'linear',
        'shopify',
        'trello',
        'calcom',
        ...SSO_TRUSTED_PROVIDERS,
      ],
    },
  },
  socialProviders: {
    github: {
      clientId: env.GITHUB_CLIENT_ID as string,
      clientSecret: env.GITHUB_CLIENT_SECRET as string,
      scopes: ['user:email', 'repo'],
    },
    google: {
      clientId: env.GOOGLE_CLIENT_ID as string,
      clientSecret: env.GOOGLE_CLIENT_SECRET as string,
      scopes: [
        'https://www.googleapis.com/auth/userinfo.email',
        'https://www.googleapis.com/auth/userinfo.profile',
      ],
    },
  },
  emailVerification: {
    autoSignInAfterVerification: true,
    onEmailVerification: async (user) => {
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

          logger.info('[emailVerification.onEmailVerification] Welcome email sent', {
            userId: user.id,
          })
        } catch (error) {
          logger.error('[emailVerification.onEmailVerification] Failed to send welcome email', {
            userId: user.id,
            error,
          })
        }
      }
    },
  },
  emailAndPassword: {
    enabled: true,
    requireEmailVerification: isEmailVerificationEnabled,
    sendVerificationOnSignUp: isEmailVerificationEnabled, // Auto-send verification OTP on signup when verification is required
    throwOnMissingCredentials: true,
    throwOnInvalidCredentials: true,
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
  },
  hooks: {
    before: createAuthMiddleware(async (ctx) => {
      if (ctx.path.startsWith('/sign-up') && isRegistrationDisabled)
        throw new Error('Registration is disabled, please contact your admin.')

      if (!isEmailPasswordEnabled) {
        const emailPasswordPaths = ['/sign-in/email', '/sign-up/email', '/email-otp']
        if (emailPasswordPaths.some((path) => ctx.path.startsWith(path)))
          throw new Error('Email/password authentication is disabled. Please use SSO to sign in.')
      }

      if (
        (ctx.path.startsWith('/sign-in') || ctx.path.startsWith('/sign-up')) &&
        (env.ALLOWED_LOGIN_EMAILS || env.ALLOWED_LOGIN_DOMAINS)
      ) {
        const requestEmail = ctx.body?.email?.toLowerCase()

        if (requestEmail) {
          let isAllowed = false

          if (env.ALLOWED_LOGIN_EMAILS) {
            const allowedEmails = env.ALLOWED_LOGIN_EMAILS.split(',').map((email) =>
              email.trim().toLowerCase()
            )
            isAllowed = allowedEmails.includes(requestEmail)
          }

          if (!isAllowed && env.ALLOWED_LOGIN_DOMAINS) {
            const allowedDomains = env.ALLOWED_LOGIN_DOMAINS.split(',').map((domain) =>
              domain.trim().toLowerCase()
            )
            const emailDomain = requestEmail.split('@')[1]
            isAllowed = emailDomain && allowedDomains.includes(emailDomain)
          }

          if (!isAllowed) {
            throw new Error('Access restricted. Please contact your administrator.')
          }
        }
      }

      return
    }),
  },
  plugins: [
    nextCookies(),
    oneTimeToken({
      expiresIn: 24 * 60 * 60, // 24 hours - Socket.IO handles connection persistence with heartbeats
    }),
    customSession(async ({ user, session }) => ({
      user,
      session,
    })),
    emailOTP({
      sendVerificationOTP: async (data: {
        email: string
        otp: string
        type: 'sign-in' | 'email-verification' | 'forget-password'
      }) => {
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
      sendVerificationOnSignUp: false,
      otpLength: 6, // Explicitly set the OTP length
      expiresIn: 15 * 60, // 15 minutes in seconds
      overrideDefaultEmailVerification: true,
    }),
    genericOAuth({
      config: [
        {
          providerId: 'github-repo',
          clientId: env.GITHUB_REPO_CLIENT_ID as string,
          clientSecret: env.GITHUB_REPO_CLIENT_SECRET as string,
          authorizationUrl: 'https://github.com/login/oauth/authorize',
          accessType: 'offline',
          prompt: 'consent',
          tokenUrl: 'https://github.com/login/oauth/access_token',
          userInfoUrl: 'https://api.github.com/user',
          scopes: ['user:email', 'repo', 'read:user', 'workflow'],
          redirectURI: `${getBaseUrl()}/api/auth/oauth2/callback/github-repo`,
          getUserInfo: async (tokens) => {
            try {
              const profileResponse = await fetch('https://api.github.com/user', {
                headers: {
                  Authorization: `Bearer ${tokens.accessToken}`,
                  'User-Agent': 'sim-studio',
                },
              })

              if (!profileResponse.ok) {
                logger.error('Failed to fetch GitHub profile', {
                  status: profileResponse.status,
                  statusText: profileResponse.statusText,
                })
                throw new Error(`Failed to fetch GitHub profile: ${profileResponse.statusText}`)
              }

              const profile = await profileResponse.json()

              if (!profile.email) {
                const emailsResponse = await fetch('https://api.github.com/user/emails', {
                  headers: {
                    Authorization: `Bearer ${tokens.accessToken}`,
                    'User-Agent': 'sim-studio',
                  },
                })

                if (emailsResponse.ok) {
                  const emails = await emailsResponse.json()

                  const primaryEmail =
                    emails.find(
                      (email: { primary: boolean; email: string; verified: boolean }) =>
                        email.primary
                    ) || emails[0]
                  if (primaryEmail) {
                    profile.email = primaryEmail.email
                    profile.emailVerified = primaryEmail.verified || false
                  }
                } else {
                  logger.warn('Failed to fetch GitHub emails', {
                    status: emailsResponse.status,
                    statusText: emailsResponse.statusText,
                  })
                }
              }

              const now = new Date()

              return {
                id: `${profile.id.toString()}-${crypto.randomUUID()}`,
                name: profile.name || profile.login,
                email: profile.email,
                image: profile.avatar_url,
                emailVerified: profile.emailVerified || false,
                createdAt: now,
                updatedAt: now,
              }
            } catch (error) {
              logger.error('Error in GitHub getUserInfo', { error })
              throw error
            }
          },
        },

        // Google providers
        {
          providerId: 'google-email',
          clientId: env.GOOGLE_CLIENT_ID as string,
          clientSecret: env.GOOGLE_CLIENT_SECRET as string,
          discoveryUrl: 'https://accounts.google.com/.well-known/openid-configuration',
          accessType: 'offline',
          scopes: [
            'https://www.googleapis.com/auth/userinfo.email',
            'https://www.googleapis.com/auth/userinfo.profile',
            'https://www.googleapis.com/auth/gmail.send',
            'https://www.googleapis.com/auth/gmail.modify',
            'https://www.googleapis.com/auth/gmail.labels',
          ],
          prompt: 'consent',
          redirectURI: `${getBaseUrl()}/api/auth/oauth2/callback/google-email`,
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
                id: `${profile.sub}-${crypto.randomUUID()}`,
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
          scopes: [
            'https://www.googleapis.com/auth/userinfo.email',
            'https://www.googleapis.com/auth/userinfo.profile',
            'https://www.googleapis.com/auth/calendar',
          ],
          prompt: 'consent',
          redirectURI: `${getBaseUrl()}/api/auth/oauth2/callback/google-calendar`,
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
                id: `${profile.sub}-${crypto.randomUUID()}`,
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
          scopes: [
            'https://www.googleapis.com/auth/userinfo.email',
            'https://www.googleapis.com/auth/userinfo.profile',
            'https://www.googleapis.com/auth/drive.file',
            'https://www.googleapis.com/auth/drive',
          ],
          prompt: 'consent',
          redirectURI: `${getBaseUrl()}/api/auth/oauth2/callback/google-drive`,
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
                id: `${profile.sub}-${crypto.randomUUID()}`,
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
          scopes: [
            'https://www.googleapis.com/auth/userinfo.email',
            'https://www.googleapis.com/auth/userinfo.profile',
            'https://www.googleapis.com/auth/drive.file',
            'https://www.googleapis.com/auth/drive',
          ],
          prompt: 'consent',
          redirectURI: `${getBaseUrl()}/api/auth/oauth2/callback/google-docs`,
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
                id: `${profile.sub}-${crypto.randomUUID()}`,
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
          scopes: [
            'https://www.googleapis.com/auth/userinfo.email',
            'https://www.googleapis.com/auth/userinfo.profile',
            'https://www.googleapis.com/auth/drive.file',
            'https://www.googleapis.com/auth/drive',
          ],
          prompt: 'consent',
          redirectURI: `${getBaseUrl()}/api/auth/oauth2/callback/google-sheets`,
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
                id: `${profile.sub}-${crypto.randomUUID()}`,
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
          scopes: [
            'https://www.googleapis.com/auth/userinfo.email',
            'https://www.googleapis.com/auth/userinfo.profile',
            'https://www.googleapis.com/auth/drive',
            'https://www.googleapis.com/auth/forms.body',
            'https://www.googleapis.com/auth/forms.responses.readonly',
          ],
          prompt: 'consent',
          redirectURI: `${getBaseUrl()}/api/auth/oauth2/callback/google-forms`,
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
                id: `${profile.sub}-${crypto.randomUUID()}`,
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
          scopes: [
            'https://www.googleapis.com/auth/userinfo.email',
            'https://www.googleapis.com/auth/userinfo.profile',
            'https://www.googleapis.com/auth/ediscovery',
            'https://www.googleapis.com/auth/devstorage.read_only',
          ],
          prompt: 'consent',
          redirectURI: `${getBaseUrl()}/api/auth/oauth2/callback/google-vault`,
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
                id: `${profile.sub}-${crypto.randomUUID()}`,
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
          scopes: [
            'https://www.googleapis.com/auth/userinfo.email',
            'https://www.googleapis.com/auth/userinfo.profile',
            'https://www.googleapis.com/auth/admin.directory.group',
            'https://www.googleapis.com/auth/admin.directory.group.member',
          ],
          prompt: 'consent',
          redirectURI: `${getBaseUrl()}/api/auth/oauth2/callback/google-groups`,
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
                id: `${profile.sub}-${crypto.randomUUID()}`,
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
          scopes: [
            'https://www.googleapis.com/auth/userinfo.email',
            'https://www.googleapis.com/auth/userinfo.profile',
            'https://www.googleapis.com/auth/cloud-platform',
          ],
          prompt: 'consent',
          redirectURI: `${getBaseUrl()}/api/auth/oauth2/callback/vertex-ai`,
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
                id: `${profile.sub}-${crypto.randomUUID()}`,
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
          providerId: 'microsoft-teams',
          clientId: env.MICROSOFT_CLIENT_ID as string,
          clientSecret: env.MICROSOFT_CLIENT_SECRET as string,
          authorizationUrl: 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize',
          tokenUrl: 'https://login.microsoftonline.com/common/oauth2/v2.0/token',
          userInfoUrl: 'https://graph.microsoft.com/v1.0/me',
          scopes: [
            'openid',
            'profile',
            'email',
            'User.Read',
            'Chat.Read',
            'Chat.ReadWrite',
            'Chat.ReadBasic',
            'ChatMessage.Send',
            'Channel.ReadBasic.All',
            'ChannelMessage.Send',
            'ChannelMessage.Read.All',
            'ChannelMessage.ReadWrite',
            'ChannelMember.Read.All',
            'Group.Read.All',
            'Group.ReadWrite.All',
            'Team.ReadBasic.All',
            'TeamMember.Read.All',
            'offline_access',
            'Files.Read',
            'Sites.Read.All',
          ],
          responseType: 'code',
          accessType: 'offline',
          authentication: 'basic',
          pkce: true,
          redirectURI: `${getBaseUrl()}/api/auth/oauth2/callback/microsoft-teams`,
          getUserInfo: async (tokens) => {
            try {
              const response = await fetch('https://graph.microsoft.com/v1.0/me', {
                headers: { Authorization: `Bearer ${tokens.accessToken}` },
              })
              if (!response.ok) {
                logger.error('Failed to fetch Microsoft user info', { status: response.status })
                throw new Error(`Failed to fetch Microsoft user info: ${response.statusText}`)
              }
              const profile = await response.json()
              const now = new Date()
              return {
                id: `${profile.id}-${crypto.randomUUID()}`,
                name: profile.displayName || 'Microsoft User',
                email: profile.mail || profile.userPrincipalName,
                emailVerified: true,
                createdAt: now,
                updatedAt: now,
              }
            } catch (error) {
              logger.error('Error in Microsoft getUserInfo', { error })
              throw error
            }
          },
        },

        {
          providerId: 'microsoft-excel',
          clientId: env.MICROSOFT_CLIENT_ID as string,
          clientSecret: env.MICROSOFT_CLIENT_SECRET as string,
          authorizationUrl: 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize',
          tokenUrl: 'https://login.microsoftonline.com/common/oauth2/v2.0/token',
          userInfoUrl: 'https://graph.microsoft.com/v1.0/me',
          scopes: ['openid', 'profile', 'email', 'Files.Read', 'Files.ReadWrite', 'offline_access'],
          responseType: 'code',
          accessType: 'offline',
          authentication: 'basic',
          pkce: true,
          redirectURI: `${getBaseUrl()}/api/auth/oauth2/callback/microsoft-excel`,
          getUserInfo: async (tokens) => {
            try {
              const response = await fetch('https://graph.microsoft.com/v1.0/me', {
                headers: { Authorization: `Bearer ${tokens.accessToken}` },
              })
              if (!response.ok) {
                logger.error('Failed to fetch Microsoft user info', { status: response.status })
                throw new Error(`Failed to fetch Microsoft user info: ${response.statusText}`)
              }
              const profile = await response.json()
              const now = new Date()
              return {
                id: `${profile.id}-${crypto.randomUUID()}`,
                name: profile.displayName || 'Microsoft User',
                email: profile.mail || profile.userPrincipalName,
                emailVerified: true,
                createdAt: now,
                updatedAt: now,
              }
            } catch (error) {
              logger.error('Error in Microsoft getUserInfo', { error })
              throw error
            }
          },
        },
        {
          providerId: 'microsoft-planner',
          clientId: env.MICROSOFT_CLIENT_ID as string,
          clientSecret: env.MICROSOFT_CLIENT_SECRET as string,
          authorizationUrl: 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize',
          tokenUrl: 'https://login.microsoftonline.com/common/oauth2/v2.0/token',
          userInfoUrl: 'https://graph.microsoft.com/v1.0/me',
          scopes: [
            'openid',
            'profile',
            'email',
            'Group.ReadWrite.All',
            'Group.Read.All',
            'Tasks.ReadWrite',
            'offline_access',
          ],
          responseType: 'code',
          accessType: 'offline',
          authentication: 'basic',
          pkce: true,
          redirectURI: `${getBaseUrl()}/api/auth/oauth2/callback/microsoft-planner`,
          getUserInfo: async (tokens) => {
            try {
              const response = await fetch('https://graph.microsoft.com/v1.0/me', {
                headers: { Authorization: `Bearer ${tokens.accessToken}` },
              })
              if (!response.ok) {
                logger.error('Failed to fetch Microsoft user info', { status: response.status })
                throw new Error(`Failed to fetch Microsoft user info: ${response.statusText}`)
              }
              const profile = await response.json()
              const now = new Date()
              return {
                id: `${profile.id}-${crypto.randomUUID()}`,
                name: profile.displayName || 'Microsoft User',
                email: profile.mail || profile.userPrincipalName,
                emailVerified: true,
                createdAt: now,
                updatedAt: now,
              }
            } catch (error) {
              logger.error('Error in Microsoft getUserInfo', { error })
              throw error
            }
          },
        },

        {
          providerId: 'outlook',
          clientId: env.MICROSOFT_CLIENT_ID as string,
          clientSecret: env.MICROSOFT_CLIENT_SECRET as string,
          authorizationUrl: 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize',
          tokenUrl: 'https://login.microsoftonline.com/common/oauth2/v2.0/token',
          userInfoUrl: 'https://graph.microsoft.com/v1.0/me',
          scopes: [
            'openid',
            'profile',
            'email',
            'Mail.ReadWrite',
            'Mail.ReadBasic',
            'Mail.Read',
            'Mail.Send',
            'offline_access',
          ],
          responseType: 'code',
          accessType: 'offline',
          authentication: 'basic',
          pkce: true,
          redirectURI: `${getBaseUrl()}/api/auth/oauth2/callback/outlook`,
          getUserInfo: async (tokens) => {
            try {
              const response = await fetch('https://graph.microsoft.com/v1.0/me', {
                headers: { Authorization: `Bearer ${tokens.accessToken}` },
              })
              if (!response.ok) {
                logger.error('Failed to fetch Microsoft user info', { status: response.status })
                throw new Error(`Failed to fetch Microsoft user info: ${response.statusText}`)
              }
              const profile = await response.json()
              const now = new Date()
              return {
                id: `${profile.id}-${crypto.randomUUID()}`,
                name: profile.displayName || 'Microsoft User',
                email: profile.mail || profile.userPrincipalName,
                emailVerified: true,
                createdAt: now,
                updatedAt: now,
              }
            } catch (error) {
              logger.error('Error in Microsoft getUserInfo', { error })
              throw error
            }
          },
        },

        {
          providerId: 'onedrive',
          clientId: env.MICROSOFT_CLIENT_ID as string,
          clientSecret: env.MICROSOFT_CLIENT_SECRET as string,
          authorizationUrl: 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize',
          tokenUrl: 'https://login.microsoftonline.com/common/oauth2/v2.0/token',
          userInfoUrl: 'https://graph.microsoft.com/v1.0/me',
          scopes: ['openid', 'profile', 'email', 'Files.Read', 'Files.ReadWrite', 'offline_access'],
          responseType: 'code',
          accessType: 'offline',
          authentication: 'basic',
          pkce: true,
          redirectURI: `${getBaseUrl()}/api/auth/oauth2/callback/onedrive`,
          getUserInfo: async (tokens) => {
            try {
              const response = await fetch('https://graph.microsoft.com/v1.0/me', {
                headers: { Authorization: `Bearer ${tokens.accessToken}` },
              })
              if (!response.ok) {
                logger.error('Failed to fetch Microsoft user info', { status: response.status })
                throw new Error(`Failed to fetch Microsoft user info: ${response.statusText}`)
              }
              const profile = await response.json()
              const now = new Date()
              return {
                id: `${profile.id}-${crypto.randomUUID()}`,
                name: profile.displayName || 'Microsoft User',
                email: profile.mail || profile.userPrincipalName,
                emailVerified: true,
                createdAt: now,
                updatedAt: now,
              }
            } catch (error) {
              logger.error('Error in Microsoft getUserInfo', { error })
              throw error
            }
          },
        },

        {
          providerId: 'sharepoint',
          clientId: env.MICROSOFT_CLIENT_ID as string,
          clientSecret: env.MICROSOFT_CLIENT_SECRET as string,
          authorizationUrl: 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize',
          tokenUrl: 'https://login.microsoftonline.com/common/oauth2/v2.0/token',
          userInfoUrl: 'https://graph.microsoft.com/v1.0/me',
          scopes: [
            'openid',
            'profile',
            'email',
            'Sites.Read.All',
            'Sites.ReadWrite.All',
            'Sites.Manage.All',
            'offline_access',
          ],
          responseType: 'code',
          accessType: 'offline',
          authentication: 'basic',
          pkce: true,
          redirectURI: `${getBaseUrl()}/api/auth/oauth2/callback/sharepoint`,
          getUserInfo: async (tokens) => {
            try {
              const response = await fetch('https://graph.microsoft.com/v1.0/me', {
                headers: { Authorization: `Bearer ${tokens.accessToken}` },
              })
              if (!response.ok) {
                logger.error('Failed to fetch Microsoft user info', { status: response.status })
                throw new Error(`Failed to fetch Microsoft user info: ${response.statusText}`)
              }
              const profile = await response.json()
              const now = new Date()
              return {
                id: `${profile.id}-${crypto.randomUUID()}`,
                name: profile.displayName || 'Microsoft User',
                email: profile.mail || profile.userPrincipalName,
                emailVerified: true,
                createdAt: now,
                updatedAt: now,
              }
            } catch (error) {
              logger.error('Error in Microsoft getUserInfo', { error })
              throw error
            }
          },
        },

        {
          providerId: 'wealthbox',
          clientId: env.WEALTHBOX_CLIENT_ID as string,
          clientSecret: env.WEALTHBOX_CLIENT_SECRET as string,
          authorizationUrl: 'https://app.crmworkspace.com/oauth/authorize',
          tokenUrl: 'https://app.crmworkspace.com/oauth/token',
          userInfoUrl: 'https://dummy-not-used.wealthbox.com', // Dummy URL since no user info endpoint exists
          scopes: ['login', 'data'],
          responseType: 'code',
          redirectURI: `${getBaseUrl()}/api/auth/oauth2/callback/wealthbox`,
          getUserInfo: async (_tokens) => {
            try {
              logger.info('Creating Wealthbox user profile from token data')

              const uniqueId = 'wealthbox-user'
              const now = new Date()

              return {
                id: `${uniqueId}-${crypto.randomUUID()}`,
                name: 'Wealthbox User',
                email: `${uniqueId}@wealthbox.user`,
                emailVerified: false,
                createdAt: now,
                updatedAt: now,
              }
            } catch (error) {
              logger.error('Error creating Wealthbox user profile:', { error })
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
          scopes: [
            'base',
            'deals:full',
            'contacts:full',
            'leads:full',
            'activities:full',
            'mail:full',
            'projects:full',
          ],
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
                logger.error('Failed to fetch Pipedrive user info', {
                  status: response.status,
                })
                throw new Error('Failed to fetch user info')
              }

              const data = await response.json()
              const user = data.data

              return {
                id: `${user.id.toString()}-${crypto.randomUUID()}`,
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

        // HubSpot provider
        {
          providerId: 'hubspot',
          clientId: env.HUBSPOT_CLIENT_ID as string,
          clientSecret: env.HUBSPOT_CLIENT_SECRET as string,
          authorizationUrl: 'https://app.hubspot.com/oauth/authorize',
          tokenUrl: 'https://api.hubapi.com/oauth/v1/token',
          userInfoUrl: 'https://api.hubapi.com/oauth/v1/access-tokens',
          prompt: 'consent',
          scopes: [
            'crm.objects.contacts.read',
            'crm.objects.contacts.write',
            'crm.objects.companies.read',
            'crm.objects.companies.write',
            'crm.objects.deals.read',
            'crm.objects.deals.write',
            'crm.objects.owners.read',
            'crm.objects.users.read',
            'crm.objects.users.write',
            'crm.objects.marketing_events.read',
            'crm.objects.marketing_events.write',
            'crm.objects.line_items.read',
            'crm.objects.line_items.write',
            'crm.objects.quotes.read',
            'crm.objects.quotes.write',
            'crm.objects.appointments.read',
            'crm.objects.appointments.write',
            'crm.objects.carts.read',
            'crm.objects.carts.write',
            'crm.import',
            'crm.lists.read',
            'crm.lists.write',
            'tickets',
          ],
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
                hasScopes: !!data.scopes,
                scopesType: typeof data.scopes,
                scopesIsArray: Array.isArray(data.scopes),
                scopesValue: data.scopes,
                fullResponse: data,
              })

              return {
                id: `${data.user_id || data.hub_id.toString()}-${crypto.randomUUID()}`,
                name: data.user || 'HubSpot User',
                email: data.user || `hubspot-${data.hub_id}@hubspot.com`,
                emailVerified: true,
                image: undefined,
                createdAt: new Date(),
                updatedAt: new Date(),
                // Extract scopes from HubSpot's response and convert array to space-delimited string
                // Use 'scope' (singular) as that's what better-auth expects for the account table
                ...(data.scopes && Array.isArray(data.scopes)
                  ? { scope: data.scopes.join(' ') }
                  : {}),
              }
            } catch (error) {
              logger.error('Error creating HubSpot user profile:', { error })
              return null
            }
          },
        },

        // Salesforce provider
        {
          providerId: 'salesforce',
          clientId: env.SALESFORCE_CLIENT_ID as string,
          clientSecret: env.SALESFORCE_CLIENT_SECRET as string,
          authorizationUrl: 'https://login.salesforce.com/services/oauth2/authorize',
          tokenUrl: 'https://login.salesforce.com/services/oauth2/token',
          userInfoUrl: 'https://login.salesforce.com/services/oauth2/userinfo',
          scopes: ['api', 'refresh_token', 'openid', 'offline_access'],
          pkce: true,
          prompt: 'consent',
          accessType: 'offline',
          redirectURI: `${getBaseUrl()}/api/auth/oauth2/callback/salesforce`,
          getUserInfo: async (tokens) => {
            try {
              const response = await fetch(
                'https://login.salesforce.com/services/oauth2/userinfo',
                {
                  headers: {
                    Authorization: `Bearer ${tokens.accessToken}`,
                  },
                }
              )

              if (!response.ok) {
                logger.error('Failed to fetch Salesforce user info', {
                  status: response.status,
                })
                throw new Error('Failed to fetch user info')
              }

              const data = await response.json()

              return {
                id: `${data.user_id || data.sub}-${crypto.randomUUID()}`,
                name: data.name || 'Salesforce User',
                email: data.email || `salesforce-${data.user_id}@salesforce.com`,
                emailVerified: data.email_verified || true,
                image: data.picture || undefined,
                createdAt: new Date(),
                updatedAt: new Date(),
              }
            } catch (error) {
              logger.error('Error creating Salesforce user profile:', { error })
              return null
            }
          },
        },

        // X provider
        {
          providerId: 'x',
          clientId: env.X_CLIENT_ID as string,
          clientSecret: env.X_CLIENT_SECRET as string,
          authorizationUrl: 'https://x.com/i/oauth2/authorize',
          tokenUrl: 'https://api.x.com/2/oauth2/token',
          userInfoUrl: 'https://api.x.com/2/users/me',
          accessType: 'offline',
          scopes: ['tweet.read', 'tweet.write', 'users.read', 'offline.access'],
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
                id: `${profile.data.id}-${crypto.randomUUID()}`,
                name: profile.data.name || 'X User',
                email: `${profile.data.username}@x.com`,
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

        // Confluence provider
        {
          providerId: 'confluence',
          clientId: env.CONFLUENCE_CLIENT_ID as string,
          clientSecret: env.CONFLUENCE_CLIENT_SECRET as string,
          authorizationUrl: 'https://auth.atlassian.com/authorize',
          tokenUrl: 'https://auth.atlassian.com/oauth/token',
          userInfoUrl: 'https://api.atlassian.com/me',
          scopes: [
            'read:confluence-content.all',
            'read:confluence-space.summary',
            'read:space:confluence',
            'read:space-details:confluence',
            'write:confluence-content',
            'write:confluence-space',
            'write:confluence-file',
            'read:page:confluence',
            'write:page:confluence',
            'read:comment:confluence',
            'read:content:confluence',
            'write:comment:confluence',
            'delete:comment:confluence',
            'read:attachment:confluence',
            'write:attachment:confluence',
            'delete:attachment:confluence',
            'delete:page:confluence',
            'read:label:confluence',
            'write:label:confluence',
            'search:confluence',
            'read:me',
            'offline_access',
            'read:blogpost:confluence',
            'write:blogpost:confluence',
            'read:content.property:confluence',
            'write:content.property:confluence',
            'read:hierarchical-content:confluence',
            'read:content.metadata:confluence',
          ],
          responseType: 'code',
          pkce: true,
          accessType: 'offline',
          authentication: 'basic',
          prompt: 'consent',
          redirectURI: `${getBaseUrl()}/api/auth/oauth2/callback/confluence`,
          getUserInfo: async (tokens) => {
            try {
              const response = await fetch('https://api.atlassian.com/me', {
                headers: {
                  Authorization: `Bearer ${tokens.accessToken}`,
                },
              })

              if (!response.ok) {
                logger.error('Error fetching Confluence user info:', {
                  status: response.status,
                  statusText: response.statusText,
                })
                return null
              }

              const profile = await response.json()

              const now = new Date()

              return {
                id: `${profile.account_id}-${crypto.randomUUID()}`,
                name: profile.name || profile.display_name || 'Confluence User',
                email: profile.email || `${profile.account_id}@atlassian.com`,
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

        // Jira provider
        {
          providerId: 'jira',
          clientId: env.JIRA_CLIENT_ID as string,
          clientSecret: env.JIRA_CLIENT_SECRET as string,
          authorizationUrl: 'https://auth.atlassian.com/authorize',
          tokenUrl: 'https://auth.atlassian.com/oauth/token',
          userInfoUrl: 'https://api.atlassian.com/me',
          scopes: [
            'read:jira-user',
            'read:jira-work',
            'write:jira-work',
            'write:issue:jira',
            'read:project:jira',
            'read:issue-type:jira',
            'read:me',
            'offline_access',
            'read:issue-meta:jira',
            'read:issue-security-level:jira',
            'read:issue.vote:jira',
            'read:issue.changelog:jira',
            'read:avatar:jira',
            'read:issue:jira',
            'read:status:jira',
            'read:user:jira',
            'read:field-configuration:jira',
            'read:issue-details:jira',
            'read:issue-event:jira',
            'delete:issue:jira',
            'write:comment:jira',
            'read:comment:jira',
            'delete:comment:jira',
            'read:attachment:jira',
            'delete:attachment:jira',
            'write:issue-worklog:jira',
            'read:issue-worklog:jira',
            'delete:issue-worklog:jira',
            'write:issue-link:jira',
            'delete:issue-link:jira',
            // Jira Service Management scopes
            'read:servicedesk:jira-service-management',
            'read:requesttype:jira-service-management',
            'read:request:jira-service-management',
            'write:request:jira-service-management',
            'read:request.comment:jira-service-management',
            'write:request.comment:jira-service-management',
            'read:customer:jira-service-management',
            'write:customer:jira-service-management',
            'read:servicedesk.customer:jira-service-management',
            'write:servicedesk.customer:jira-service-management',
            'read:organization:jira-service-management',
            'write:organization:jira-service-management',
            'read:servicedesk.organization:jira-service-management',
            'write:servicedesk.organization:jira-service-management',
            'read:organization.user:jira-service-management',
            'write:organization.user:jira-service-management',
            'read:organization.property:jira-service-management',
            'write:organization.property:jira-service-management',
            'read:organization.profile:jira-service-management',
            'write:organization.profile:jira-service-management',
            'read:queue:jira-service-management',
            'read:request.sla:jira-service-management',
            'read:request.status:jira-service-management',
            'write:request.status:jira-service-management',
            'read:request.participant:jira-service-management',
            'write:request.participant:jira-service-management',
            'read:request.approval:jira-service-management',
            'write:request.approval:jira-service-management',
          ],
          responseType: 'code',
          pkce: true,
          accessType: 'offline',
          authentication: 'basic',
          prompt: 'consent',
          redirectURI: `${getBaseUrl()}/api/auth/oauth2/callback/jira`,
          getUserInfo: async (tokens) => {
            try {
              const response = await fetch('https://api.atlassian.com/me', {
                headers: {
                  Authorization: `Bearer ${tokens.accessToken}`,
                },
              })

              if (!response.ok) {
                logger.error('Error fetching Jira user info:', {
                  status: response.status,
                  statusText: response.statusText,
                })
                return null
              }

              const profile = await response.json()

              const now = new Date()

              return {
                id: `${profile.account_id}-${crypto.randomUUID()}`,
                name: profile.name || profile.display_name || 'Jira User',
                email: profile.email || `${profile.account_id}@atlassian.com`,
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

        // Airtable provider
        {
          providerId: 'airtable',
          clientId: env.AIRTABLE_CLIENT_ID as string,
          clientSecret: env.AIRTABLE_CLIENT_SECRET as string,
          authorizationUrl: 'https://airtable.com/oauth2/v1/authorize',
          tokenUrl: 'https://airtable.com/oauth2/v1/token',
          userInfoUrl: 'https://api.airtable.com/v0/meta/whoami',
          scopes: ['data.records:read', 'data.records:write', 'user.email:read', 'webhook:manage'],
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
                logger.error('Error fetching Airtable user info:', {
                  status: response.status,
                  statusText: response.statusText,
                })
                return null
              }

              const data = await response.json()
              const now = new Date()

              return {
                id: `${data.id}-${crypto.randomUUID()}`,
                name: data.email ? data.email.split('@')[0] : 'Airtable User',
                email: data.email || `${data.id}@airtable.user`,
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

        // Notion provider
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
                logger.error('Error fetching Notion user info:', {
                  status: response.status,
                  statusText: response.statusText,
                })
                return null
              }

              const profile = await response.json()
              const now = new Date()

              return {
                id: `${profile.bot?.owner?.user?.id || profile.id}-${crypto.randomUUID()}`,
                name: profile.name || profile.bot?.owner?.user?.name || 'Notion User',
                email: profile.person?.email || `${profile.id}@notion.user`,
                emailVerified: !!profile.person?.email,
                createdAt: now,
                updatedAt: now,
              }
            } catch (error) {
              logger.error('Error in Notion getUserInfo:', { error })
              return null
            }
          },
        },

        // Reddit provider
        {
          providerId: 'reddit',
          clientId: env.REDDIT_CLIENT_ID as string,
          clientSecret: env.REDDIT_CLIENT_SECRET as string,
          authorizationUrl: 'https://www.reddit.com/api/v1/authorize?duration=permanent',
          tokenUrl: 'https://www.reddit.com/api/v1/access_token',
          userInfoUrl: 'https://oauth.reddit.com/api/v1/me',
          scopes: [
            'identity',
            'read',
            'submit',
            'vote',
            'save',
            'edit',
            'subscribe',
            'history',
            'privatemessages',
            'account',
            'mysubreddits',
            'flair',
            'report',
            'modposts',
            'modflair',
            'modmail',
          ],
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
                  'User-Agent': 'sim-studio/1.0',
                },
              })

              if (!response.ok) {
                logger.error('Error fetching Reddit user info:', {
                  status: response.status,
                  statusText: response.statusText,
                })
                return null
              }

              const data = await response.json()
              const now = new Date()

              return {
                id: `${data.id}-${crypto.randomUUID()}`,
                name: data.name || 'Reddit User',
                email: `${data.name}@reddit.user`,
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
          providerId: 'linear',
          clientId: env.LINEAR_CLIENT_ID as string,
          clientSecret: env.LINEAR_CLIENT_SECRET as string,
          authorizationUrl: 'https://linear.app/oauth/authorize',
          tokenUrl: 'https://api.linear.app/oauth/token',
          scopes: ['read', 'write'],
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
                id: `${viewer.id}-${crypto.randomUUID()}`,
                email: viewer.email,
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
          providerId: 'dropbox',
          clientId: env.DROPBOX_CLIENT_ID as string,
          clientSecret: env.DROPBOX_CLIENT_SECRET as string,
          authorizationUrl: 'https://www.dropbox.com/oauth2/authorize',
          tokenUrl: 'https://api.dropboxapi.com/oauth2/token',
          scopes: [
            'account_info.read',
            'files.metadata.read',
            'files.metadata.write',
            'files.content.read',
            'files.content.write',
            'sharing.read',
            'sharing.write',
          ],
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
              const response = await fetch(
                'https://api.dropboxapi.com/2/users/get_current_account',
                {
                  method: 'POST',
                  headers: {
                    Authorization: `Bearer ${tokens.accessToken}`,
                  },
                }
              )

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
                id: `${data.account_id}-${crypto.randomUUID()}`,
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
          scopes: ['default'],
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
                id: `${profile.gid}-${crypto.randomUUID()}`,
                name: profile.name || 'Asana User',
                email: profile.email || `${profile.gid}@asana.user`,
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

        // Slack provider
        {
          providerId: 'slack',
          clientId: env.SLACK_CLIENT_ID as string,
          clientSecret: env.SLACK_CLIENT_SECRET as string,
          authorizationUrl: 'https://slack.com/oauth/v2/authorize',
          tokenUrl: 'https://slack.com/api/oauth.v2.access',
          userInfoUrl: 'https://slack.com/api/users.identity',
          scopes: [
            // Bot token scopes only - app acts as a bot user
            'channels:read',
            'channels:history',
            'groups:read',
            'groups:history',
            'chat:write',
            'chat:write.public',
            'im:write',
            'im:history',
            'im:read',
            'users:read',
            'files:write',
            'files:read',
            'canvases:write',
            'reactions:write',
          ],
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
              const userId = data.user_id || data.bot_id || 'bot'
              const teamName = data.team || 'Slack Workspace'

              const uniqueId = `${teamId}-${userId}`

              logger.info('Slack credential identifier', { teamId, userId, uniqueId, teamName })

              return {
                id: `${uniqueId}-${crypto.randomUUID()}`,
                name: teamName,
                email: `${teamId}-${userId}@slack.bot`,
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

        // Webflow provider
        {
          providerId: 'webflow',
          clientId: env.WEBFLOW_CLIENT_ID as string,
          clientSecret: env.WEBFLOW_CLIENT_SECRET as string,
          authorizationUrl: 'https://webflow.com/oauth/authorize',
          tokenUrl: 'https://api.webflow.com/oauth/access_token',
          userInfoUrl: 'https://api.webflow.com/v2/token/introspect',
          scopes: ['sites:read', 'sites:write', 'cms:read', 'cms:write', 'forms:read'],
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
                id: `${uniqueId}-${crypto.randomUUID()}`,
                name: data.user_name || 'Webflow User',
                email: `${uniqueId.replace(/[^a-zA-Z0-9]/g, '')}@webflow.user`,
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
        // LinkedIn provider
        {
          providerId: 'linkedin',
          clientId: env.LINKEDIN_CLIENT_ID as string,
          clientSecret: env.LINKEDIN_CLIENT_SECRET as string,
          authorizationUrl: 'https://www.linkedin.com/oauth/v2/authorization',
          tokenUrl: 'https://www.linkedin.com/oauth/v2/accessToken',
          userInfoUrl: 'https://api.linkedin.com/v2/userinfo',
          scopes: ['profile', 'openid', 'email', 'w_member_social'],
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
                logger.error('Failed to fetch LinkedIn user info', {
                  status: response.status,
                  statusText: response.statusText,
                })
                throw new Error('Failed to fetch user info')
              }

              const profile = await response.json()

              return {
                id: `${profile.sub}-${crypto.randomUUID()}`,
                name: profile.name || 'LinkedIn User',
                email: profile.email || `${profile.sub}@linkedin.user`,
                emailVerified: profile.email_verified || true,
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

        // Zoom provider
        {
          providerId: 'zoom',
          clientId: env.ZOOM_CLIENT_ID as string,
          clientSecret: env.ZOOM_CLIENT_SECRET as string,
          authorizationUrl: 'https://zoom.us/oauth/authorize',
          tokenUrl: 'https://zoom.us/oauth/token',
          userInfoUrl: 'https://api.zoom.us/v2/users/me',
          scopes: [
            'user:read:user',
            'meeting:write:meeting',
            'meeting:read:meeting',
            'meeting:read:list_meetings',
            'meeting:update:meeting',
            'meeting:delete:meeting',
            'meeting:read:invitation',
            'meeting:read:list_past_participants',
            'cloud_recording:read:list_user_recordings',
            'cloud_recording:read:list_recording_files',
            'cloud_recording:delete:recording_file',
          ],
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
                logger.error('Failed to fetch Zoom user info', {
                  status: response.status,
                  statusText: response.statusText,
                })
                throw new Error('Failed to fetch user info')
              }

              const profile = await response.json()

              return {
                id: `${profile.id}-${crypto.randomUUID()}`,
                name:
                  `${profile.first_name || ''} ${profile.last_name || ''}`.trim() || 'Zoom User',
                email: profile.email || `${profile.id}@zoom.user`,
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

        // Spotify provider
        {
          providerId: 'spotify',
          clientId: env.SPOTIFY_CLIENT_ID as string,
          clientSecret: env.SPOTIFY_CLIENT_SECRET as string,
          authorizationUrl: 'https://accounts.spotify.com/authorize',
          tokenUrl: 'https://accounts.spotify.com/api/token',
          userInfoUrl: 'https://api.spotify.com/v1/me',
          scopes: [
            'user-read-private',
            'user-read-email',
            'user-library-read',
            'user-library-modify',
            'playlist-read-private',
            'playlist-read-collaborative',
            'playlist-modify-public',
            'playlist-modify-private',
            'user-read-playback-state',
            'user-modify-playback-state',
            'user-read-currently-playing',
            'user-read-recently-played',
            'user-top-read',
            'user-follow-read',
            'user-follow-modify',
            'user-read-playback-position',
            'ugc-image-upload',
          ],
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
                logger.error('Failed to fetch Spotify user info', {
                  status: response.status,
                  statusText: response.statusText,
                })
                throw new Error('Failed to fetch user info')
              }

              const profile = await response.json()

              return {
                id: `${profile.id}-${crypto.randomUUID()}`,
                name: profile.display_name || 'Spotify User',
                email: profile.email || `${profile.id}@spotify.user`,
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

        // WordPress.com provider
        {
          providerId: 'wordpress',
          clientId: env.WORDPRESS_CLIENT_ID as string,
          clientSecret: env.WORDPRESS_CLIENT_SECRET as string,
          authorizationUrl: 'https://public-api.wordpress.com/oauth2/authorize',
          tokenUrl: 'https://public-api.wordpress.com/oauth2/token',
          userInfoUrl: 'https://public-api.wordpress.com/rest/v1.1/me',
          scopes: ['global'],
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
                logger.error('Failed to fetch WordPress.com user info', {
                  status: response.status,
                  statusText: response.statusText,
                })
                throw new Error('Failed to fetch user info')
              }

              const profile = await response.json()

              return {
                id: `${profile.ID?.toString() || profile.id?.toString()}-${crypto.randomUUID()}`,
                name: profile.display_name || profile.username || 'WordPress User',
                email: profile.email || `${profile.username}@wordpress.com`,
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

        // Cal.com provider
        {
          providerId: 'calcom',
          clientId: env.CALCOM_CLIENT_ID as string,
          authorizationUrl: 'https://app.cal.com/auth/oauth2/authorize',
          tokenUrl: 'https://app.cal.com/api/auth/oauth/token',
          scopes: [],
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
                logger.error('Failed to fetch Cal.com user info', {
                  status: response.status,
                  statusText: response.statusText,
                })
                throw new Error('Failed to fetch user info')
              }

              const data = await response.json()
              const profile = data.data || data

              return {
                id: `${profile.id?.toString()}-${crypto.randomUUID()}`,
                name: profile.name || 'Cal.com User',
                email: profile.email || `${profile.id}@cal.com`,
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
      ],
    }),
    // Include SSO plugin when enabled
    ...(env.SSO_ENABLED ? [sso()] : []),
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
              authorizeReference: async ({ user, referenceId }) => {
                return await authorizeSubscriptionReference(user.id, referenceId)
              },
              getCheckoutSessionParams: async ({ plan, subscription }) => {
                if (plan.name === 'team') {
                  return {
                    params: {
                      allow_promotion_codes: true,
                      line_items: [
                        {
                          price: plan.priceId,
                          quantity: subscription?.seats || 1,
                          adjustable_quantity: {
                            enabled: true,
                            minimum: 1,
                            maximum: 50,
                          },
                        },
                      ],
                    },
                  }
                }

                return {
                  params: {
                    allow_promotion_codes: true,
                  },
                }
              },
              onSubscriptionComplete: async ({
                stripeSubscription,
                subscription,
              }: {
                event: Stripe.Event
                stripeSubscription: Stripe.Subscription
                subscription: any
              }) => {
                const { priceId, planFromStripe, isTeamPlan } =
                  resolvePlanFromStripeSubscription(stripeSubscription)

                logger.info('[onSubscriptionComplete] Subscription created', {
                  subscriptionId: subscription.id,
                  referenceId: subscription.referenceId,
                  dbPlan: subscription.plan,
                  planFromStripe,
                  priceId,
                  status: subscription.status,
                })

                const subscriptionForOrgCreation = isTeamPlan
                  ? { ...subscription, plan: 'team' }
                  : subscription

                let resolvedSubscription = subscription
                try {
                  resolvedSubscription = await ensureOrganizationForTeamSubscription(
                    subscriptionForOrgCreation
                  )
                } catch (orgError) {
                  logger.error(
                    '[onSubscriptionComplete] Failed to ensure organization for team subscription',
                    {
                      subscriptionId: subscription.id,
                      referenceId: subscription.referenceId,
                      dbPlan: subscription.plan,
                      planFromStripe,
                      error: orgError instanceof Error ? orgError.message : String(orgError),
                      stack: orgError instanceof Error ? orgError.stack : undefined,
                    }
                  )
                  throw orgError
                }

                await handleSubscriptionCreated(resolvedSubscription)

                await syncSubscriptionUsageLimits(resolvedSubscription)

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
                const { priceId, planFromStripe, isTeamPlan } =
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

                const isUpgradeToTeam =
                  isTeamPlan &&
                  subscription.plan !== 'team' &&
                  !subscription.referenceId.startsWith('org_')

                const effectivePlanForTeamFeatures = planFromStripe ?? subscription.plan

                logger.info('[onSubscriptionUpdate] Subscription updated', {
                  subscriptionId: subscription.id,
                  status: subscription.status,
                  dbPlan: subscription.plan,
                  planFromStripe,
                  isUpgradeToTeam,
                  referenceId: subscription.referenceId,
                })

                const subscriptionForOrgCreation = isUpgradeToTeam
                  ? { ...subscription, plan: 'team' }
                  : subscription

                let resolvedSubscription = subscription
                try {
                  resolvedSubscription = await ensureOrganizationForTeamSubscription(
                    subscriptionForOrgCreation
                  )

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
                      error: orgError instanceof Error ? orgError.message : String(orgError),
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

                if (effectivePlanForTeamFeatures === 'team') {
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
              },
              onSubscriptionDeleted: async ({
                subscription,
              }: {
                event: Stripe.Event
                stripeSubscription: Stripe.Subscription
                subscription: any
              }) => {
                logger.info('[onSubscriptionDeleted] Subscription deleted', {
                  subscriptionId: subscription.id,
                  referenceId: subscription.referenceId,
                })

                try {
                  await handleSubscriptionDeleted(subscription)
                } catch (error) {
                  logger.error('[onSubscriptionDeleted] Failed to handle subscription deletion', {
                    subscriptionId: subscription.id,
                    referenceId: subscription.referenceId,
                    error,
                  })
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
                  case 'invoice.finalized': {
                    await handleInvoiceFinalized(event)
                    break
                  }
                  case 'customer.subscription.created': {
                    await handleManualEnterpriseSubscription(event)
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
            allowUserToCreateOrganization: async (user) => {
              if (!isBillingEnabled) {
                return true
              }
              const dbSubscriptions = await db
                .select()
                .from(schema.subscription)
                .where(eq(schema.subscription.referenceId, user.id))

              const hasTeamPlan = dbSubscriptions.some(
                (sub) =>
                  sub.status === 'active' && (sub.plan === 'team' || sub.plan === 'enterprise')
              )

              return hasTeamPlan
            },
            organizationCreation: {
              afterCreate: async ({ organization, user }) => {
                logger.info('[organizationCreation.afterCreate] Organization created', {
                  organizationId: organization.id,
                  creatorId: user.id,
                })
              },
            },
          }),
        ]
      : []),
  ],
  pages: {
    signIn: '/login',
    signUp: '/signup',
    error: '/error',
    verify: '/verify',
  },
})

export async function getSession() {
  if (isAuthDisabled) {
    await ensureAnonymousUserExists()
    return createAnonymousSession()
  }

  const hdrs = await headers()
  return await auth.api.getSession({
    headers: hdrs,
  })
}

export const signIn = auth.api.signInEmail
export const signUp = auth.api.signUpEmail
