import { headers } from 'next/headers'
import { betterAuth } from 'better-auth'
import { drizzleAdapter } from 'better-auth/adapters/drizzle'
import { nextCookies } from 'better-auth/next-js'
import { Resend } from 'resend'
import { db } from '@/db'
import * as schema from '@/db/schema'

type EmailHandler = {
  user: { email: string }
  url: string
}

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
  emailAndPassword: {
    enabled: true,
    requireEmailVerification: true,
    sendResetPassword: async ({ user, url }: EmailHandler) => {
      await resend.emails.send({
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
    },
  },
  emailVerification: {
    sendVerificationEmail: async ({ user, url }: EmailHandler) => {
      console.log('Attempting to send verification email to:', user.email)
      console.log('Verification URL:', url)
      try {
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
        console.log('Resend API response:', result)
      } catch (error) {
        console.error('Error sending verification email:', error)
      }
    },
  },
  socialProviders: {
    github: {
      clientId: process.env.GITHUB_CLIENT_ID!,
      clientSecret: process.env.GITHUB_CLIENT_SECRET!,
    },
  },
  plugins: [nextCookies()],
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
