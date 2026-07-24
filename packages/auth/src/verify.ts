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
 * Session payload returned by one-time-token verification. The session row is
 * created by `apps/sim`'s full auth config, so it can carry plugin fields
 * (e.g. `activeOrganizationId`) this minimal instance does not configure.
 */
export interface VerifiedOneTimeTokenSession {
  user: {
    id: string
    name: string | null
    email: string | null
    image?: string | null
  }
  session: {
    activeOrganizationId?: string | null
  }
}

/**
 * The verification surface consumers use. Declared explicitly (rather than
 * inferring Better Auth's instance type) so this package's emitted
 * declarations never reference Better Auth's internal zod instance — the
 * inferred type is not portable across install layouts (TS2883).
 */
export interface VerifyAuth {
  api: {
    verifyOneTimeToken: (input: {
      body: { token: string }
    }) => Promise<VerifiedOneTimeTokenSession | null>
  }
}

/**
 * Minimal Better Auth instance used by services that only need to verify
 * one-time tokens issued by the main app. Shares the Better Auth DB schema
 * (`verification` table) and secret with the main app, so tokens issued by
 * `apps/sim`'s full auth config are accepted here. The instance is wrapped in
 * the {@link VerifyAuth} contract rather than returned directly so consumers
 * (and this package's declaration output) never depend on Better Auth's
 * inferred endpoint types.
 */
export function createVerifyAuth(options: VerifyAuthOptions): VerifyAuth {
  const auth = betterAuth({
    baseURL: options.baseURL,
    secret: options.secret,
    database: drizzleAdapter(db, {
      provider: 'pg',
      schema,
    }),
    plugins: [
      oneTimeToken({
        expiresIn: 24 * 60,
      }),
    ],
  })

  return {
    api: {
      verifyOneTimeToken: async (input) => {
        const result = await auth.api.verifyOneTimeToken(input)
        if (!result?.user?.id) return null
        return {
          user: {
            id: result.user.id,
            name: result.user.name ?? null,
            email: result.user.email ?? null,
            image: result.user.image ?? null,
          },
          session: {
            activeOrganizationId:
              typeof result.session.activeOrganizationId === 'string'
                ? result.session.activeOrganizationId
                : null,
          },
        }
      },
    },
  }
}
