import { headers } from 'next/headers'
import { betterAuth } from 'better-auth'
import { drizzleAdapter } from 'better-auth/adapters/drizzle'
import { nextCookies } from 'better-auth/next-js'
import { genericOAuth } from 'better-auth/plugins'
import { Resend } from 'resend'
import { db } from '@/db'
import * as schema from '@/db/schema'

// If there is no resend key, it might be a local dev environment
// In that case, we don't want to send emails and just log them
const resend = process.env.RESEND_API_KEY
  ? new Resend(process.env.RESEND_API_KEY)
  : { emails: { send: async (...args: any[]) => console.log(args) } }

export const auth = betterAuth({
  database: drizzleAdapter(db, {
    provider: 'pg',
    schema,
  }),
  session: {
    cookieCache: {
      enabled: true,
      maxAge: 5 * 60, // Cache duration (5 minutes)
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
    // twitter: {
    //   clientId: process.env.TWITTER_CLIENT_ID as string,
    //   clientSecret: process.env.TWITTER_CLIENT_SECRET as string,
    //   scopes: ['tweet.read', 'users.read'],
    // },
  },
  emailAndPassword: {
    enabled: true,
    requireEmailVerification: true,
    throwOnMissingCredentials: true,
    throwOnInvalidCredentials: true,
    sendResetPassword: async ({ user, url, token }, request) => {
      const result = await resend.emails.send({
        from: 'Sim Studio <team@simstudio.ai>',
        to: user.email,
        subject: 'Reset your password',
        html: `
          <h2>Reset Your Password</h2>
          <p>Click the link below to reset your password:</p>
          <a href="${url}">${url}</a>
          <p>If you didn't request this, you can safely ignore this email.</p>
        `,
      })

      if (!result) {
        throw new Error('Failed to send reset password email')
      }
    },
  },
  emailVerification: {
    sendVerificationEmail: async ({ user, url, token }, request) => {
      try {
        if (!user.email) {
          throw new Error('User email is required')
        }

        const result = await resend.emails.send({
          from: 'Sim Studio <onboarding@simstudio.ai>',
          to: user.email,
          subject: 'Verify your email',
          html: `
            <h2>Welcome to Sim Studio!</h2>
            <p>Click the link below to verify your email:</p>
            <a href="${url}">${url}</a>
            <p>If you didn't create an account, you can safely ignore this email.</p>
          `,
        })

        if (!result) {
          throw new Error('Failed to send verification email')
        }
      } catch (error) {
        console.error('Error sending verification email:', {
          error,
          user: user.email,
          url,
          token,
        })
        throw error
      }
    },
  },
  plugins: [
    nextCookies(),
    genericOAuth({
      config: [
        {
          providerId: 'github-repo',
          clientId: process.env.GITHUB_CLIENT_ID as string,
          clientSecret: process.env.GITHUB_CLIENT_SECRET as string,
          authorizationUrl: 'https://github.com/login/oauth/authorize',
          tokenUrl: 'https://github.com/login/oauth/access_token',
          userInfoUrl: 'https://api.github.com/user',
          scopes: ['user:email', 'repo'],
        },
        {
          providerId: 'github-workflow',
          clientId: process.env.GITHUB_CLIENT_ID as string,
          clientSecret: process.env.GITHUB_CLIENT_SECRET as string,
          authorizationUrl: 'https://github.com/login/oauth/authorize',
          tokenUrl: 'https://github.com/login/oauth/access_token',
          userInfoUrl: 'https://api.github.com/user',
          scopes: ['workflow', 'repo'],
        },

        // Google providers for different purposes
        {
          providerId: 'google-email',
          clientId: process.env.GOOGLE_CLIENT_ID as string,
          clientSecret: process.env.GOOGLE_CLIENT_SECRET as string,
          discoveryUrl: 'https://accounts.google.com/.well-known/openid-configuration',
          scopes: [
            'https://www.googleapis.com/auth/userinfo.email',
            'https://www.googleapis.com/auth/userinfo.profile',
            'https://www.googleapis.com/auth/gmail.send',
          ],
        },
        {
          providerId: 'google-calendar',
          clientId: process.env.GOOGLE_CLIENT_ID as string,
          clientSecret: process.env.GOOGLE_CLIENT_SECRET as string,
          discoveryUrl: 'https://accounts.google.com/.well-known/openid-configuration',
          scopes: [
            'https://www.googleapis.com/auth/userinfo.email',
            'https://www.googleapis.com/auth/userinfo.profile',
            'https://www.googleapis.com/auth/calendar',
          ],
        },
        {
          providerId: 'google-drive',
          clientId: process.env.GOOGLE_CLIENT_ID as string,
          clientSecret: process.env.GOOGLE_CLIENT_SECRET as string,
          discoveryUrl: 'https://accounts.google.com/.well-known/openid-configuration',
          scopes: [
            'https://www.googleapis.com/auth/userinfo.email',
            'https://www.googleapis.com/auth/userinfo.profile',
            'https://www.googleapis.com/auth/drive',
          ],
        },
        {
          providerId: 'google-docs',
          clientId: process.env.GOOGLE_CLIENT_ID as string,
          clientSecret: process.env.GOOGLE_CLIENT_SECRET as string,
          discoveryUrl: 'https://accounts.google.com/.well-known/openid-configuration',
          scopes: [
            'https://www.googleapis.com/auth/userinfo.email',
            'https://www.googleapis.com/auth/userinfo.profile',
            'https://www.googleapis.com/auth/documents',
          ],
        },
        {
          providerId: 'google-sheets',
          clientId: process.env.GOOGLE_CLIENT_ID as string,
          clientSecret: process.env.GOOGLE_CLIENT_SECRET as string,
          discoveryUrl: 'https://accounts.google.com/.well-known/openid-configuration',
          scopes: [
            'https://www.googleapis.com/auth/userinfo.email',
            'https://www.googleapis.com/auth/userinfo.profile',
            'https://www.googleapis.com/auth/spreadsheets',
          ],
        },

        // Twitter providers
        // {
        //   providerId: 'twitter-read',
        //   clientId: process.env.TWITTER_CLIENT_ID as string,
        //   clientSecret: process.env.TWITTER_CLIENT_SECRET as string,
        //   authorizationUrl: 'https://twitter.com/i/oauth2/authorize',
        //   tokenUrl: 'https://api.twitter.com/2/oauth2/token',
        //   userInfoUrl: 'https://api.twitter.com/2/users/me',
        //   scopes: ['tweet.read', 'users.read'],
        // },
        // {
        //   providerId: 'twitter-write',
        //   clientId: process.env.TWITTER_CLIENT_ID as string,
        //   clientSecret: process.env.TWITTER_CLIENT_SECRET as string,
        //   authorizationUrl: 'https://twitter.com/i/oauth2/authorize',
        //   tokenUrl: 'https://api.twitter.com/2/oauth2/token',
        //   userInfoUrl: 'https://api.twitter.com/2/users/me',
        //   scopes: ['tweet.read', 'tweet.write', 'users.read', 'offline.access'],
        // },
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
