import { sso } from '@better-auth/sso'
import { stripe } from '@better-auth/stripe'
import { db } from '@sim/db'
import * as schema from '@sim/db/schema'
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
  renderInvitationEmail,
  renderOTPEmail,
  renderPasswordResetEmail,
} from '@/components/emails/render-email'
import { sendPlanWelcomeEmail } from '@/lib/billing'
import { authorizeSubscriptionReference } from '@/lib/billing/authorization'
import { handleNewUser } from '@/lib/billing/core/usage'
import { syncSubscriptionUsageLimits } from '@/lib/billing/organization'
import { getPlans } from '@/lib/billing/plans'
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
import { sendEmail } from '@/lib/email/mailer'
import { getFromEmailAddress } from '@/lib/email/utils'
import { quickValidateEmail } from '@/lib/email/validation'
import { env, isTruthy } from '@/lib/env'
import { isBillingEnabled, isEmailVerificationEnabled } from '@/lib/environment'
import { createLogger } from '@/lib/logs/console/logger'
import { getBaseUrl } from '@/lib/urls/utils'
import { SSO_TRUSTED_PROVIDERS } from './sso/consts'

const logger = createLogger('Auth')

// Only initialize Stripe if the key is provided
// This allows local development without a Stripe account
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
            await handleNewUser(user.id)
          } catch (error) {
            logger.error('[databaseHooks.user.create.after] Failed to initialize user stats', {
              userId: user.id,
              error,
            })
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
        // Standard OAuth providers
        'google',
        'github',
        'email-password',
        'confluence',
        'supabase',
        'x',
        'notion',
        'microsoft',
        'slack',
        'reddit',
        'webflow',
        'asana',
        'pipedrive',
        'hubspot',

        // Common SSO provider patterns
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
  emailAndPassword: {
    enabled: true,
    requireEmailVerification: isEmailVerificationEnabled,
    sendVerificationOnSignUp: false,
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
      if (ctx.path.startsWith('/sign-up') && isTruthy(env.DISABLE_REGISTRATION))
        throw new Error('Registration is disabled, please contact your admin.')

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
                id: profile.id.toString(),
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
            'https://www.googleapis.com/auth/drive.readonly',
            'https://www.googleapis.com/auth/drive.file',
          ],
          prompt: 'consent',
          redirectURI: `${getBaseUrl()}/api/auth/oauth2/callback/google-drive`,
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
            'https://www.googleapis.com/auth/drive.readonly',
            'https://www.googleapis.com/auth/drive.file',
          ],
          prompt: 'consent',
          redirectURI: `${getBaseUrl()}/api/auth/oauth2/callback/google-docs`,
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
            'https://www.googleapis.com/auth/drive.readonly',
            'https://www.googleapis.com/auth/drive.file',
          ],
          prompt: 'consent',
          redirectURI: `${getBaseUrl()}/api/auth/oauth2/callback/google-sheets`,
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
            'https://www.googleapis.com/auth/forms.responses.readonly',
          ],
          prompt: 'consent',
          redirectURI: `${getBaseUrl()}/api/auth/oauth2/callback/google-forms`,
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
          getUserInfo: async (tokens) => {
            try {
              logger.info('Creating Wealthbox user profile from token data')

              const uniqueId = `wealthbox-${Date.now()}`
              const now = new Date()

              return {
                id: uniqueId,
                name: 'Wealthbox User',
                email: `${uniqueId.replace(/[^a-zA-Z0-9]/g, '')}@wealthbox.user`,
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
                id: user.id.toString(),
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
                id: data.user_id || data.hub_id.toString(),
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
          scopes: ['api', 'refresh_token', 'openid'],
          pkce: true,
          prompt: 'consent',
          redirectURI: `${getBaseUrl()}/api/auth/oauth2/callback/salesforce`,
          getUserInfo: async (tokens) => {
            try {
              logger.info('Fetching Salesforce user profile')

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
                id: data.user_id || data.sub,
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

        // Supabase provider
        {
          providerId: 'supabase',
          clientId: env.SUPABASE_CLIENT_ID as string,
          clientSecret: env.SUPABASE_CLIENT_SECRET as string,
          authorizationUrl: 'https://api.supabase.com/v1/oauth/authorize',
          tokenUrl: 'https://api.supabase.com/v1/oauth/token',
          userInfoUrl: 'https://dummy-not-used.supabase.co',
          scopes: ['database.read', 'database.write', 'projects.read'],
          responseType: 'code',
          pkce: true,
          redirectURI: `${getBaseUrl()}/api/auth/oauth2/callback/supabase`,
          getUserInfo: async (tokens) => {
            try {
              logger.info('Creating Supabase user profile from token data')

              let userId = 'supabase-user'
              if (tokens.idToken) {
                try {
                  const decodedToken = JSON.parse(
                    Buffer.from(tokens.idToken.split('.')[1], 'base64').toString()
                  )
                  if (decodedToken.sub) {
                    userId = decodedToken.sub
                  }
                } catch (e) {
                  logger.warn('Failed to decode Supabase ID token', {
                    error: e,
                  })
                }
              }

              const uniqueId = `${userId}-${Date.now()}`
              const now = new Date()

              return {
                id: uniqueId,
                name: 'Supabase User',
                email: `${uniqueId.replace(/[^a-zA-Z0-9]/g, '')}@supabase.user`,
                emailVerified: false,
                createdAt: now,
                updatedAt: now,
              }
            } catch (error) {
              logger.error('Error creating Supabase user profile:', { error })
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
                id: profile.data.id,
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
                id: profile.account_id,
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

        // Discord provider
        {
          providerId: 'discord',
          clientId: env.DISCORD_CLIENT_ID as string,
          clientSecret: env.DISCORD_CLIENT_SECRET as string,
          authorizationUrl: 'https://discord.com/api/oauth2/authorize',
          tokenUrl: 'https://discord.com/api/oauth2/token',
          userInfoUrl: 'https://discord.com/api/users/@me',
          scopes: ['identify', 'bot', 'messages.read', 'guilds', 'guilds.members.read'],
          responseType: 'code',
          accessType: 'offline',
          authentication: 'basic',
          prompt: 'consent',
          redirectURI: `${getBaseUrl()}/api/auth/oauth2/callback/discord`,
          getUserInfo: async (tokens) => {
            try {
              const response = await fetch('https://discord.com/api/users/@me', {
                headers: {
                  Authorization: `Bearer ${tokens.accessToken}`,
                },
              })

              if (!response.ok) {
                logger.error('Error fetching Discord user info:', {
                  status: response.status,
                  statusText: response.statusText,
                })
                return null
              }

              const profile = await response.json()
              const now = new Date()

              return {
                id: profile.id,
                name: profile.username || 'Discord User',
                email: profile.email || `${profile.id}@discord.user`,
                image: profile.avatar
                  ? `https://cdn.discordapp.com/avatars/${profile.id}/${profile.avatar}.png`
                  : undefined,
                emailVerified: profile.verified || false,
                createdAt: now,
                updatedAt: now,
              }
            } catch (error) {
              logger.error('Error in Discord getUserInfo:', { error })
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
                id: profile.account_id,
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
                id: data.id,
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
          scopes: ['workspace.content', 'workspace.name', 'page.read', 'page.write'],
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
                id: profile.bot?.owner?.user?.id || profile.id,
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
                id: data.id,
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
                id: viewer.id,
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
                id: profile.gid,
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
              logger.info('Creating Slack bot profile from token data')

              // Extract user identifier from tokens if possible
              let userId = 'slack-bot'
              if (tokens.idToken) {
                try {
                  const decodedToken = JSON.parse(
                    Buffer.from(tokens.idToken.split('.')[1], 'base64').toString()
                  )
                  if (decodedToken.sub) {
                    userId = decodedToken.sub
                  }
                } catch (e) {
                  logger.warn('Failed to decode Slack ID token', { error: e })
                }
              }

              const uniqueId = `${userId}-${Date.now()}`
              const now = new Date()

              return {
                id: uniqueId,
                name: 'Slack Bot',
                email: `${uniqueId.replace(/[^a-zA-Z0-9]/g, '')}@slack.bot`,
                emailVerified: false,
                createdAt: now,
                updatedAt: now,
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
          scopes: ['sites:read', 'sites:write', 'cms:read', 'cms:write'],
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

              const userId = data.user_id || `webflow-${Date.now()}`
              const uniqueId = `webflow-${userId}`

              return {
                id: uniqueId,
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
                subscription,
              }: {
                event: Stripe.Event
                stripeSubscription: Stripe.Subscription
                subscription: any
              }) => {
                logger.info('[onSubscriptionComplete] Subscription created', {
                  subscriptionId: subscription.id,
                  referenceId: subscription.referenceId,
                  plan: subscription.plan,
                  status: subscription.status,
                })

                await handleSubscriptionCreated(subscription)

                await syncSubscriptionUsageLimits(subscription)

                await sendPlanWelcomeEmail(subscription)
              },
              onSubscriptionUpdate: async ({
                subscription,
              }: {
                event: Stripe.Event
                subscription: any
              }) => {
                logger.info('[onSubscriptionUpdate] Subscription updated', {
                  subscriptionId: subscription.id,
                  status: subscription.status,
                  plan: subscription.plan,
                })

                try {
                  await syncSubscriptionUsageLimits(subscription)
                } catch (error) {
                  logger.error('[onSubscriptionUpdate] Failed to sync usage limits', {
                    subscriptionId: subscription.id,
                    referenceId: subscription.referenceId,
                    error,
                  })
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

                  // Reset usage limits to free tier
                  await syncSubscriptionUsageLimits(subscription)

                  logger.info('[onSubscriptionDeleted] Reset usage limits to free tier', {
                    subscriptionId: subscription.id,
                    referenceId: subscription.referenceId,
                  })
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
                  // Note: customer.subscription.deleted is handled by better-auth's onSubscriptionDeleted callback above
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
          organization({
            allowUserToCreateOrganization: async (user) => {
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
            // Set a fixed membership limit of 50, but the actual limit will be enforced in the invitation flow
            membershipLimit: 50,
            // Validate seat limits before sending invitations
            beforeInvite: async ({ organization }: { organization: { id: string } }) => {
              const subscriptions = await db
                .select()
                .from(schema.subscription)
                .where(
                  and(
                    eq(schema.subscription.referenceId, organization.id),
                    eq(schema.subscription.status, 'active')
                  )
                )

              const teamOrEnterpriseSubscription = subscriptions.find(
                (sub) => sub.plan === 'team' || sub.plan === 'enterprise'
              )

              if (!teamOrEnterpriseSubscription) {
                throw new Error('No active team or enterprise subscription for this organization')
              }

              const members = await db
                .select()
                .from(schema.member)
                .where(eq(schema.member.organizationId, organization.id))

              const pendingInvites = await db
                .select()
                .from(schema.invitation)
                .where(
                  and(
                    eq(schema.invitation.organizationId, organization.id),
                    eq(schema.invitation.status, 'pending')
                  )
                )

              const totalCount = members.length + pendingInvites.length
              const seatLimit = teamOrEnterpriseSubscription.seats || 1

              if (totalCount >= seatLimit) {
                throw new Error(`Organization has reached its seat limit of ${seatLimit}`)
              }
            },
            sendInvitationEmail: async (data: any) => {
              try {
                const { invitation, organization, inviter } = data

                const inviteUrl = `${getBaseUrl()}/invite/${invitation.id}`
                const inviterName = inviter.user?.name || 'A team member'

                const html = await renderInvitationEmail(
                  inviterName,
                  organization.name,
                  inviteUrl,
                  invitation.email
                )

                const result = await sendEmail({
                  to: invitation.email,
                  subject: `${inviterName} has invited you to join ${organization.name} on Sim`,
                  html,
                  from: getFromEmailAddress(),
                  emailType: 'transactional',
                })

                if (!result.success) {
                  logger.error('Failed to send organization invitation email:', result.message)
                }
              } catch (error) {
                logger.error('Error sending invitation email', { error })
              }
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
  const hdrs = await headers()
  return await auth.api.getSession({
    headers: hdrs,
  })
}

export const signIn = auth.api.signInEmail
export const signUp = auth.api.signUpEmail
