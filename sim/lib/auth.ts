import { headers } from 'next/headers'
import { betterAuth } from 'better-auth'
import { drizzleAdapter } from 'better-auth/adapters/drizzle'
import { nextCookies } from 'better-auth/next-js'
import { emailOTP, genericOAuth } from 'better-auth/plugins'
import { Resend } from 'resend'
import {
  getEmailSubject,
  renderOTPEmail,
  renderPasswordResetEmail,
} from '@/components/emails/render-email'
import { createLogger } from '@/lib/logs/console-logger'
import { db } from '@/db'
import * as schema from '@/db/schema'

const logger = createLogger('Auth')

// If there is no resend key, it might be a local dev environment
// In that case, we don't want to send emails and just log them

const validResendAPIKEY =
  process.env.RESEND_API_KEY &&
  process.env.RESEND_API_KEY.trim() !== '' &&
  process.env.RESEND_API_KEY !== 'placeholder'

const resend = validResendAPIKEY
  ? new Resend(process.env.RESEND_API_KEY)
  : {
      emails: {
        send: async (...args: any[]) => {
          logger.info('Email would have been sent in production. Details:', args)
          return { id: 'local-dev-mode' }
        },
      },
    }

export const auth = betterAuth({
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
  account: {
    accountLinking: {
      enabled: true,
      allowDifferentEmails: true,
      trustedProviders: ['google', 'github', 'email-password', 'confluence', 'supabase', 'x'],
    },
  },
  socialProviders: {
    github: {
      clientId: process.env.GITHUB_CLIENT_ID as string,
      clientSecret: process.env.GITHUB_CLIENT_SECRET as string,
      scopes: ['user:email', 'repo'],
    },
    google: {
      clientId: process.env.GOOGLE_CLIENT_ID as string,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET as string,
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

      const result = await resend.emails.send({
        from: 'Sim Studio <team@simstudio.ai>',
        to: user.email,
        subject: getEmailSubject('reset-password'),
        html,
      })

      if (!result) {
        throw new Error('Failed to send reset password email')
      }
    },
  },
  plugins: [
    nextCookies(),
    emailOTP({
      sendVerificationOTP: async (data: {
        email: string
        otp: string
        type: 'sign-in' | 'email-verification' | 'forget-password'
      }) => {
        try {
          if (!data.email) {
            throw new Error('Email is required')
          }

          // In development with no RESEND_API_KEY, log verification code
          if (!validResendAPIKEY) {
            logger.info('🔑 VERIFICATION CODE FOR LOGIN/SIGNUP', {
              email: data.email,
              otp: data.otp,
              type: data.type,
            })
            return
          }

          const html = await renderOTPEmail(data.otp, data.email, data.type)

          // In production, send an actual email
          const result = await resend.emails.send({
            from: 'Sim Studio <onboarding@simstudio.ai>',
            to: data.email,
            subject: getEmailSubject(data.type),
            html,
          })

          if (!result) {
            throw new Error('Failed to send verification code')
          }
        } catch (error) {
          logger.error('Error sending verification code:', {
            error,
            email: data.email,
          })
          throw error
        }
      },
      sendVerificationOnSignUp: true,
      otpLength: 6, // Explicitly set the OTP length
      expiresIn: 15 * 60, // 15 minutes in seconds
    }),
    genericOAuth({
      config: [
        {
          providerId: 'github-repo',
          clientId: process.env.GITHUB_CLIENT_ID as string,
          clientSecret: process.env.GITHUB_CLIENT_SECRET as string,
          authorizationUrl: 'https://github.com/login/oauth/authorize',
          accessType: 'offline',
          prompt: 'consent',
          tokenUrl: 'https://github.com/login/oauth/access_token',
          userInfoUrl: 'https://api.github.com/user',
          scopes: ['user:email', 'repo'],
          redirectURI: `${process.env.NEXT_PUBLIC_APP_URL}/api/auth/oauth2/callback/github-repo`,
        },
        {
          providerId: 'github-workflow',
          clientId: process.env.GITHUB_CLIENT_ID as string,
          clientSecret: process.env.GITHUB_CLIENT_SECRET as string,
          authorizationUrl: 'https://github.com/login/oauth/authorize',
          accessType: 'offline',
          tokenUrl: 'https://github.com/login/oauth/access_token',
          userInfoUrl: 'https://api.github.com/user',
          scopes: ['workflow', 'repo'],
          prompt: 'consent',
          redirectURI: `${process.env.NEXT_PUBLIC_APP_URL}/api/auth/oauth2/callback/github-workflow`,
        },

        // Google providers for different purposes
        {
          providerId: 'google-email',
          clientId: process.env.GOOGLE_CLIENT_ID as string,
          clientSecret: process.env.GOOGLE_CLIENT_SECRET as string,
          discoveryUrl: 'https://accounts.google.com/.well-known/openid-configuration',
          accessType: 'offline',
          scopes: [
            'https://www.googleapis.com/auth/userinfo.email',
            'https://www.googleapis.com/auth/userinfo.profile',
            'https://www.googleapis.com/auth/gmail.send',
            // 'https://www.googleapis.com/auth/gmail.readonly',
            'https://www.googleapis.com/auth/gmail.labels',
          ],
          prompt: 'consent',
          redirectURI: `${process.env.NEXT_PUBLIC_APP_URL}/api/auth/oauth2/callback/google-email`,
        },
        {
          providerId: 'google-calendar',
          clientId: process.env.GOOGLE_CLIENT_ID as string,
          clientSecret: process.env.GOOGLE_CLIENT_SECRET as string,
          discoveryUrl: 'https://accounts.google.com/.well-known/openid-configuration',
          accessType: 'offline',
          scopes: [
            'https://www.googleapis.com/auth/userinfo.email',
            'https://www.googleapis.com/auth/userinfo.profile',
            'https://www.googleapis.com/auth/calendar',
          ],
          prompt: 'consent',
          redirectURI: `${process.env.NEXT_PUBLIC_APP_URL}/api/auth/oauth2/callback/google-calendar`,
        },
        {
          providerId: 'google-drive',
          clientId: process.env.GOOGLE_CLIENT_ID as string,
          clientSecret: process.env.GOOGLE_CLIENT_SECRET as string,
          discoveryUrl: 'https://accounts.google.com/.well-known/openid-configuration',
          accessType: 'offline',
          scopes: [
            'https://www.googleapis.com/auth/userinfo.email',
            'https://www.googleapis.com/auth/userinfo.profile',
            'https://www.googleapis.com/auth/drive.file',
          ],
          prompt: 'consent',
          redirectURI: `${process.env.NEXT_PUBLIC_APP_URL}/api/auth/oauth2/callback/google-drive`,
        },
        {
          providerId: 'google-docs',
          clientId: process.env.GOOGLE_CLIENT_ID as string,
          clientSecret: process.env.GOOGLE_CLIENT_SECRET as string,
          discoveryUrl: 'https://accounts.google.com/.well-known/openid-configuration',
          accessType: 'offline',
          scopes: [
            'https://www.googleapis.com/auth/userinfo.email',
            'https://www.googleapis.com/auth/userinfo.profile',
            'https://www.googleapis.com/auth/drive.file',
          ],
          prompt: 'consent',
          redirectURI: `${process.env.NEXT_PUBLIC_APP_URL}/api/auth/oauth2/callback/google-docs`,
        },
        {
          providerId: 'google-sheets',
          clientId: process.env.GOOGLE_CLIENT_ID as string,
          clientSecret: process.env.GOOGLE_CLIENT_SECRET as string,
          discoveryUrl: 'https://accounts.google.com/.well-known/openid-configuration',
          accessType: 'offline',
          scopes: [
            'https://www.googleapis.com/auth/userinfo.email',
            'https://www.googleapis.com/auth/userinfo.profile',
            'https://www.googleapis.com/auth/spreadsheets',
            'https://www.googleapis.com/auth/drive.file',
          ],
          prompt: 'consent',
          redirectURI: `${process.env.NEXT_PUBLIC_APP_URL}/api/auth/oauth2/callback/google-sheets`,
        },

        // Supabase provider
        {
          providerId: 'supabase',
          clientId: process.env.SUPABASE_CLIENT_ID as string,
          clientSecret: process.env.SUPABASE_CLIENT_SECRET as string,
          authorizationUrl: 'https://api.supabase.com/v1/oauth/authorize',
          tokenUrl: 'https://api.supabase.com/v1/oauth/token',
          // Supabase doesn't have a standard userInfo endpoint that works with our flow,
          // so we use a dummy URL and rely on our custom getUserInfo implementation
          userInfoUrl: 'https://dummy-not-used.supabase.co',
          scopes: ['database.read', 'database.write', 'projects.read'],
          responseType: 'code',
          pkce: true,
          redirectURI: `${process.env.NEXT_PUBLIC_APP_URL}/api/auth/oauth2/callback/supabase`,
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
                  logger.warn('Failed to decode Supabase ID token', { error: e })
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
          clientId: process.env.X_CLIENT_ID as string,
          clientSecret: process.env.X_CLIENT_SECRET as string,
          authorizationUrl: 'https://x.com/i/oauth2/authorize',
          tokenUrl: 'https://api.x.com/2/oauth2/token',
          userInfoUrl: 'https://api.x.com/2/users/me',
          accessType: 'offline',
          scopes: ['tweet.read', 'tweet.write', 'users.read', 'offline.access'],
          pkce: true,
          responseType: 'code',
          prompt: 'consent',
          redirectURI: `${process.env.NEXT_PUBLIC_APP_URL}/api/auth/oauth2/callback/x`,
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
          clientId: process.env.CONFLUENCE_CLIENT_ID as string,
          clientSecret: process.env.CONFLUENCE_CLIENT_SECRET as string,
          authorizationUrl: 'https://auth.atlassian.com/authorize',
          tokenUrl: 'https://auth.atlassian.com/oauth/token',
          userInfoUrl: 'https://api.atlassian.com/me',
          scopes: [
            'read:page:confluence',
            'read:confluence-content.all',
            'read:me',
            'offline_access',
            'write:confluence-content',
          ],
          responseType: 'code',
          pkce: true,
          accessType: 'offline',
          prompt: 'consent',
          redirectURI: `${process.env.NEXT_PUBLIC_APP_URL}/api/auth/oauth2/callback/confluence`,
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

        // Airtable provider
        {
          providerId: 'airtable',
          clientId: process.env.AIRTABLE_CLIENT_ID as string,
          clientSecret: process.env.AIRTABLE_CLIENT_SECRET as string,
          authorizationUrl: 'https://airtable.com/oauth2/v1/authorize',
          tokenUrl: 'https://airtable.com/oauth2/v1/token',
          userInfoUrl: 'https://api.airtable.com/v0/meta/whoami',
          scopes: ['data.records:read', 'data.records:write', 'user.email:read', 'webhook:manage'],
          responseType: 'code',
          pkce: true,
          accessType: 'offline',
          authentication: 'basic',
          prompt: 'consent',
          redirectURI: `${process.env.NEXT_PUBLIC_APP_URL}/api/auth/oauth2/callback/airtable`,
        },
      ],
    }),
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
  return await auth.api.getSession({
    headers: await headers(),
  })
}

export const signIn = auth.api.signInEmail
export const signUp = auth.api.signUpEmail
