import { stripe } from '@better-auth/stripe'
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
import { getBaseURL } from '@/lib/auth-client'
import { DEFAULT_FREE_CREDITS } from '@/lib/billing/constants'
import { sendEmail } from '@/lib/email/mailer'
import { getFromEmailAddress } from '@/lib/email/utils'
import { quickValidateEmail } from '@/lib/email/validation'
import { env, isTruthy } from '@/lib/env'
import { isBillingEnabled, isProd } from '@/lib/environment'
import { createLogger } from '@/lib/logs/console/logger'
import { db } from '@/db'
import * as schema from '@/db/schema'

const logger = createLogger('Auth')

// Only initialize Stripe if the key is provided
// This allows local development without a Stripe account
const validStripeKey =
  env.STRIPE_SECRET_KEY &&
  env.STRIPE_SECRET_KEY.trim() !== '' &&
  env.STRIPE_SECRET_KEY !== 'placeholder'

let stripeClient = null
if (validStripeKey) {
  stripeClient = new Stripe(env.STRIPE_SECRET_KEY || '', {
    apiVersion: '2025-02-24.acacia',
  })
}

export const auth = betterAuth({
  baseURL: getBaseURL(),
  trustedOrigins: [
    env.NEXT_PUBLIC_APP_URL,
    ...(env.NEXT_PUBLIC_VERCEL_URL ? [`https://${env.NEXT_PUBLIC_VERCEL_URL}`] : []),
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
        'supabase',
        'x',
        'notion',
        'microsoft',
        'slack',
        'reddit',
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
    requireEmailVerification: false,
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

      // Check email and domain whitelist for sign-in and sign-up
      if (
        (ctx.path.startsWith('/sign-in') || ctx.path.startsWith('/sign-up')) &&
        (env.ALLOWED_LOGIN_EMAILS || env.ALLOWED_LOGIN_DOMAINS)
      ) {
        const requestEmail = ctx.body?.email?.toLowerCase()

        if (requestEmail) {
          let isAllowed = false

          // Check specific email whitelist
          if (env.ALLOWED_LOGIN_EMAILS) {
            const allowedEmails = env.ALLOWED_LOGIN_EMAILS.split(',').map((email) =>
              email.trim().toLowerCase()
            )
            isAllowed = allowedEmails.includes(requestEmail)
          }

          // Check domain whitelist if not already allowed
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
        if (!isProd) {
          logger.info('Skipping email verification in dev/docker')
          return
        }
        try {
          if (!data.email) {
            throw new Error('Email is required')
          }

          // Validate email before sending OTP
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

          // Send email via consolidated mailer (supports Resend, Azure, or logging fallback)
          const result = await sendEmail({
            to: data.email,
            subject: getEmailSubject(data.type),
            html,
            from: getFromEmailAddress(),
            emailType: 'transactional',
          })

          // If no email service is configured, log verification code for development
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
          redirectURI: `${env.NEXT_PUBLIC_APP_URL}/api/auth/oauth2/callback/github-repo`,
          getUserInfo: async (tokens) => {
            try {
              // Fetch user profile
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

              // If email is null, fetch emails separately
              if (!profile.email) {
                const emailsResponse = await fetch('https://api.github.com/user/emails', {
                  headers: {
                    Authorization: `Bearer ${tokens.accessToken}`,
                    'User-Agent': 'sim-studio',
                  },
                })

                if (emailsResponse.ok) {
                  const emails = await emailsResponse.json()

                  // Find primary email or use the first one
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

        // Google providers for different purposes
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
            // 'https://www.googleapis.com/auth/gmail.readonly',
            'https://www.googleapis.com/auth/gmail.labels',
          ],
          prompt: 'consent',
          redirectURI: `${env.NEXT_PUBLIC_APP_URL}/api/auth/oauth2/callback/google-email`,
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
          redirectURI: `${env.NEXT_PUBLIC_APP_URL}/api/auth/oauth2/callback/google-calendar`,
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
          ],
          prompt: 'consent',
          redirectURI: `${env.NEXT_PUBLIC_APP_URL}/api/auth/oauth2/callback/google-drive`,
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
          ],
          prompt: 'consent',
          redirectURI: `${env.NEXT_PUBLIC_APP_URL}/api/auth/oauth2/callback/google-docs`,
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
          ],
          prompt: 'consent',
          redirectURI: `${env.NEXT_PUBLIC_APP_URL}/api/auth/oauth2/callback/google-sheets`,
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
            'Channel.ReadBasic.All',
            'ChannelMessage.Send',
            'ChannelMessage.Read.All',
            'Group.Read.All',
            'Group.ReadWrite.All',
            'Team.ReadBasic.All',
            'offline_access',
          ],
          responseType: 'code',
          accessType: 'offline',
          authentication: 'basic',
          pkce: true,
          redirectURI: `${env.NEXT_PUBLIC_APP_URL}/api/auth/oauth2/callback/microsoft-teams`,
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
          redirectURI: `${env.NEXT_PUBLIC_APP_URL}/api/auth/oauth2/callback/microsoft-excel`,
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
          redirectURI: `${env.NEXT_PUBLIC_APP_URL}/api/auth/oauth2/callback/microsoft-planner`,
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
          redirectURI: `${env.NEXT_PUBLIC_APP_URL}/api/auth/oauth2/callback/outlook`,
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
          redirectURI: `${env.NEXT_PUBLIC_APP_URL}/api/auth/oauth2/callback/onedrive`,
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
            'offline_access',
          ],
          responseType: 'code',
          accessType: 'offline',
          authentication: 'basic',
          pkce: true,
          redirectURI: `${env.NEXT_PUBLIC_APP_URL}/api/auth/oauth2/callback/sharepoint`,
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
          redirectURI: `${env.NEXT_PUBLIC_APP_URL}/api/auth/oauth2/callback/wealthbox`,
          getUserInfo: async (tokens) => {
            try {
              logger.info('Creating Wealthbox user profile from token data')

              // Generate a unique identifier since we can't fetch user info
              const uniqueId = `wealthbox-${Date.now()}`
              const now = new Date()

              // Create a synthetic user profile
              return {
                id: uniqueId,
                name: 'Wealthbox User',
                email: `${uniqueId.replace(/[^a-zA-Z0-9]/g, '')}@wealthbox.user`,
                image: null,
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

        // Supabase provider
        {
          providerId: 'supabase',
          clientId: env.SUPABASE_CLIENT_ID as string,
          clientSecret: env.SUPABASE_CLIENT_SECRET as string,
          authorizationUrl: 'https://api.supabase.com/v1/oauth/authorize',
          tokenUrl: 'https://api.supabase.com/v1/oauth/token',
          // Supabase doesn't have a standard userInfo endpoint that works with our flow,
          // so we use a dummy URL and rely on our custom getUserInfo implementation
          userInfoUrl: 'https://dummy-not-used.supabase.co',
          scopes: ['database.read', 'database.write', 'projects.read'],
          responseType: 'code',
          pkce: true,
          redirectURI: `${env.NEXT_PUBLIC_APP_URL}/api/auth/oauth2/callback/supabase`,
          getUserInfo: async (tokens) => {
            try {
              logger.info('Creating Supabase user profile from token data')

              // Extract user identifier from tokens if possible
              let userId = 'supabase-user'
              if (tokens.idToken) {
                try {
                  // Try to decode the JWT to get user information
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

              // Generate a unique enough identifier
              const uniqueId = `${userId}-${Date.now()}`

              const now = new Date()

              // Create a synthetic user profile since we can't fetch one
              return {
                id: uniqueId,
                name: 'Supabase User',
                email: `${uniqueId.replace(/[^a-zA-Z0-9]/g, '')}@supabase.user`,
                image: null,
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
          redirectURI: `${env.NEXT_PUBLIC_APP_URL}/api/auth/oauth2/callback/x`,
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
                email: `${profile.data.username}@x.com`, // Create synthetic email with username
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
          scopes: ['read:page:confluence', 'write:page:confluence', 'read:me', 'offline_access'],
          responseType: 'code',
          pkce: true,
          accessType: 'offline',
          authentication: 'basic',
          prompt: 'consent',
          redirectURI: `${env.NEXT_PUBLIC_APP_URL}/api/auth/oauth2/callback/confluence`,
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
                image: profile.picture || null,
                emailVerified: true, // Assume verified since it's an Atlassian account
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
          redirectURI: `${env.NEXT_PUBLIC_APP_URL}/api/auth/oauth2/callback/discord`,
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
                  : null,
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
          ],
          responseType: 'code',
          pkce: true,
          accessType: 'offline',
          authentication: 'basic',
          prompt: 'consent',
          redirectURI: `${env.NEXT_PUBLIC_APP_URL}/api/auth/oauth2/callback/jira`,
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
                image: profile.picture || null,
                emailVerified: true, // Assume verified since it's an Atlassian account
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
          redirectURI: `${env.NEXT_PUBLIC_APP_URL}/api/auth/oauth2/callback/airtable`,
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
          pkce: false, // Notion doesn't support PKCE
          accessType: 'offline',
          authentication: 'basic',
          prompt: 'consent',
          redirectURI: `${env.NEXT_PUBLIC_APP_URL}/api/auth/oauth2/callback/notion`,
          getUserInfo: async (tokens) => {
            try {
              const response = await fetch('https://api.notion.com/v1/users/me', {
                headers: {
                  Authorization: `Bearer ${tokens.accessToken}`,
                  'Notion-Version': '2022-06-28', // Specify the Notion API version
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
                image: null, // Notion API doesn't provide profile images
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
          scopes: ['identity', 'read'],
          responseType: 'code',
          pkce: false,
          accessType: 'offline',
          authentication: 'basic',
          prompt: 'consent',
          redirectURI: `${env.NEXT_PUBLIC_APP_URL}/api/auth/oauth2/callback/reddit`,
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
                email: `${data.name}@reddit.user`, // Reddit doesn't provide email in identity scope
                image: data.icon_img || null,
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
          redirectURI: `${env.NEXT_PUBLIC_APP_URL}/api/auth/oauth2/callback/linear`,
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
                console.error('Linear API error:', {
                  status: response.status,
                  statusText: response.statusText,
                  body: errorText,
                })
                throw new Error(`Linear API error: ${response.status} ${response.statusText}`)
              }

              const { data, errors } = await response.json()

              if (errors) {
                console.error('GraphQL errors:', errors)
                throw new Error(`GraphQL errors: ${JSON.stringify(errors)}`)
              }

              if (!data?.viewer) {
                console.error('No viewer data in response:', data)
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
                image: viewer.avatarUrl || null,
              }
            } catch (error) {
              console.error('Error in getUserInfo:', error)
              throw error
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
            'canvases:write',
          ],
          responseType: 'code',
          accessType: 'offline',
          prompt: 'consent',
          redirectURI: `${env.NEXT_PUBLIC_APP_URL}/api/auth/oauth2/callback/slack`,
          getUserInfo: async (tokens) => {
            try {
              logger.info('Creating Slack bot profile from token data')

              // Extract user identifier from tokens if possible
              let userId = 'slack-bot'
              if (tokens.idToken) {
                try {
                  // Try to decode the JWT to get user information
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

              // Generate a unique enough identifier
              const uniqueId = `${userId}-${Date.now()}`

              const now = new Date()

              // Create a synthetic user profile since we can't fetch one
              return {
                id: uniqueId,
                name: 'Slack Bot',
                email: `${uniqueId.replace(/[^a-zA-Z0-9]/g, '')}@slack.bot`,
                image: null,
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
      ],
    }),
    // Only include the Stripe plugin when billing is enabled
    ...(isBillingEnabled && stripeClient
      ? [
          stripe({
            stripeClient,
            stripeWebhookSecret: env.STRIPE_WEBHOOK_SECRET || '',
            createCustomerOnSignUp: true,
            onCustomerCreate: async ({ stripeCustomer, user }, request) => {
              logger.info('Stripe customer created', {
                customerId: stripeCustomer.id,
                userId: user.id,
              })

              // Initialize usage limits for new user
              try {
                const { initializeUserUsageLimit } = await import('@/lib/billing')
                await initializeUserUsageLimit(user.id)
                logger.info('Usage limits initialized for new user', { userId: user.id })
              } catch (error) {
                logger.error('Failed to initialize usage limits for new user', {
                  userId: user.id,
                  error,
                })
              }
            },
            subscription: {
              enabled: true,
              plans: [
                {
                  name: 'free',
                  priceId: env.STRIPE_FREE_PRICE_ID || '',
                  limits: {
                    cost: env.FREE_TIER_COST_LIMIT ?? DEFAULT_FREE_CREDITS,
                    sharingEnabled: 0,
                    multiplayerEnabled: 0,
                    workspaceCollaborationEnabled: 0,
                  },
                },
                {
                  name: 'pro',
                  priceId: env.STRIPE_PRO_PRICE_ID || '',
                  limits: {
                    cost: env.PRO_TIER_COST_LIMIT ?? 20,
                    sharingEnabled: 1,
                    multiplayerEnabled: 0,
                    workspaceCollaborationEnabled: 0,
                  },
                },
                {
                  name: 'team',
                  priceId: env.STRIPE_TEAM_PRICE_ID || '',
                  limits: {
                    cost: env.TEAM_TIER_COST_LIMIT ?? 40, // $40 per seat
                    sharingEnabled: 1,
                    multiplayerEnabled: 1,
                    workspaceCollaborationEnabled: 1,
                  },
                },
              ],
              authorizeReference: async ({ user, referenceId, action }) => {
                // User can always manage their own subscriptions
                if (referenceId === user.id) {
                  return true
                }

                // Check if referenceId is an organizationId the user has admin rights to
                const members = await db
                  .select()
                  .from(schema.member)
                  .where(
                    and(
                      eq(schema.member.userId, user.id),
                      eq(schema.member.organizationId, referenceId)
                    )
                  )

                const member = members[0]

                // Allow if the user is an owner or admin of the organization
                return member?.role === 'owner' || member?.role === 'admin'
              },
              getCheckoutSessionParams: async ({ user, plan, subscription }, request) => {
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
                event,
                stripeSubscription,
                subscription,
              }: {
                event: Stripe.Event
                stripeSubscription: Stripe.Subscription
                subscription: any
              }) => {
                logger.info('Subscription created', {
                  subscriptionId: subscription.id,
                  referenceId: subscription.referenceId,
                  plan: subscription.plan,
                  status: subscription.status,
                })

                // Auto-create organization for team plan purchases
                try {
                  const { handleTeamPlanOrganization } = await import(
                    '@/lib/billing/team-management'
                  )
                  await handleTeamPlanOrganization(subscription)
                } catch (error) {
                  logger.error('Failed to handle team plan organization creation', {
                    subscriptionId: subscription.id,
                    referenceId: subscription.referenceId,
                    error,
                  })
                }

                // Initialize billing period and sync usage limits
                try {
                  const { initializeBillingPeriod } = await import(
                    '@/lib/billing/core/billing-periods'
                  )
                  const { syncSubscriptionUsageLimits } = await import(
                    '@/lib/billing/team-management'
                  )

                  // Sync usage limits for user or organization members
                  await syncSubscriptionUsageLimits(subscription)

                  // Initialize billing period for new subscription using Stripe dates
                  if (subscription.plan !== 'free') {
                    const stripeStart = new Date(stripeSubscription.current_period_start * 1000)
                    const stripeEnd = new Date(stripeSubscription.current_period_end * 1000)

                    await initializeBillingPeriod(subscription.referenceId, stripeStart, stripeEnd)
                    logger.info(
                      'Billing period initialized for new subscription with Stripe dates',
                      {
                        referenceId: subscription.referenceId,
                        billingStart: stripeStart,
                        billingEnd: stripeEnd,
                      }
                    )
                  }
                } catch (error) {
                  logger.error(
                    'Failed to sync usage limits or initialize billing period after subscription creation',
                    {
                      referenceId: subscription.referenceId,
                      error,
                    }
                  )
                }
              },
              onSubscriptionUpdate: async ({
                event,
                subscription,
              }: {
                event: Stripe.Event
                subscription: any
              }) => {
                logger.info('Subscription updated', {
                  subscriptionId: subscription.id,
                  status: subscription.status,
                  plan: subscription.plan,
                })

                // Auto-create organization for team plan upgrades (free -> team)
                try {
                  const { handleTeamPlanOrganization } = await import(
                    '@/lib/billing/team-management'
                  )
                  await handleTeamPlanOrganization(subscription)
                } catch (error) {
                  logger.error('Failed to handle team plan organization creation on update', {
                    subscriptionId: subscription.id,
                    referenceId: subscription.referenceId,
                    error,
                  })
                }

                // Sync usage limits for the user/organization
                try {
                  const { syncSubscriptionUsageLimits } = await import(
                    '@/lib/billing/team-management'
                  )
                  await syncSubscriptionUsageLimits(subscription)
                } catch (error) {
                  logger.error('Failed to sync usage limits after subscription update', {
                    referenceId: subscription.referenceId,
                    error,
                  })
                }
              },
              onSubscriptionDeleted: async ({
                event,
                stripeSubscription,
                subscription,
              }: {
                event: Stripe.Event
                stripeSubscription: Stripe.Subscription
                subscription: any
              }) => {
                logger.info('Subscription deleted', {
                  subscriptionId: subscription.id,
                  referenceId: subscription.referenceId,
                })
              },
            },
          }),
          // Add organization plugin as a separate entry in the plugins array
          organization({
            // Allow team plan subscribers to create organizations
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

              const teamSubscription = subscriptions.find((sub) => sub.plan === 'team')

              if (!teamSubscription) {
                throw new Error('No active team subscription for this organization')
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
              const seatLimit = teamSubscription.seats || 1

              if (totalCount >= seatLimit) {
                throw new Error(`Organization has reached its seat limit of ${seatLimit}`)
              }
            },
            sendInvitationEmail: async (data: any) => {
              try {
                const { invitation, organization, inviter } = data

                const inviteUrl = `${env.NEXT_PUBLIC_APP_URL}/invite/${invitation.id}`
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
              afterCreate: async ({ organization, member, user }) => {
                logger.info('Organization created', {
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
    verifyRequest: '/verify-request',
  },
})

// Server-side auth helpers
export async function getSession() {
  const hdrs = await headers()
  return await auth.api.getSession({
    headers: hdrs,
  })
}

export const signIn = auth.api.signInEmail
export const signUp = auth.api.signUpEmail
