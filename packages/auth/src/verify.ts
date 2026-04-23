import { db } from '@sim/db'
import * as schema from '@sim/db/schema'
import { betterAuth } from 'better-auth'
import { drizzleAdapter } from 'better-auth/adapters/drizzle'
import { oneTimeToken } from 'better-auth/plugins'

export interface VerifyAuthOptions {
  /** Better Auth shared secret. Must match the apps/sim Better Auth secret. */
  secret: string
  /** Public-facing Better Auth URL (usually same as NEXT_PUBLIC_APP_URL). */
  baseURL: string
}

/**
 * Minimal Better Auth instance used by services that only need to verify
 * one-time tokens issued by the main app. Shares the Better Auth DB schema
 * (`verification` table) and secret with the main app, so tokens issued by
 * `apps/sim`'s full auth config are accepted here.
 */
export function createVerifyAuth(options: VerifyAuthOptions) {
  return betterAuth({
    baseURL: options.baseURL,
    secret: options.secret,
    database: drizzleAdapter(db, {
      provider: 'pg',
      schema,
    }),
    plugins: [
      oneTimeToken({
        expiresIn: 24 * 60 * 60,
      }),
    ],
  })
}

export type VerifyAuth = ReturnType<typeof createVerifyAuth>
