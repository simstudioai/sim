import { hasUnexpandedShellSubstitution } from '@sim/security/secrets'
import { z } from 'zod'

/** `min(32)` alone passes: an unexpanded `$(openssl rand -hex 32)` literal clears it. */
const secretSchema = z
  .string()
  .min(32)
  .refine((value) => !hasUnexpandedShellSubstitution(value), {
    message:
      'holds an unexpanded shell substitution rather than a value; generate one with `openssl rand -hex 32`',
  })

const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  DATABASE_URL: z.string().url(),
  DATABASE_URL_REALTIME: z.string().url().optional(),
  DATABASE_REPLICA_URL_REALTIME: z.string().url().optional(),
  REDIS_URL: z.preprocess(
    (value) => (typeof value === 'string' && value.trim() === '' ? undefined : value),
    z.string().url().optional()
  ),
  BETTER_AUTH_URL: z.string().url(),
  BETTER_AUTH_SECRET: secretSchema,
  INTERNAL_API_SECRET: secretSchema,
  NEXT_PUBLIC_APP_URL: z.string().url(),
  ALLOWED_ORIGINS: z.string().optional(),
  PORT: z.coerce.number().int().positive().default(3002),
  SIM_DB_ROLE: z.enum(['web', 'trigger', 'realtime']).optional(),
  DISABLE_AUTH: z
    .string()
    .optional()
    .transform((value) => value === 'true' || value === '1'),
})

function parseEnv() {
  const parsed = EnvSchema.safeParse(process.env)
  if (!parsed.success) {
    const formatted = z.treeifyError(parsed.error)
    throw new Error(`Invalid realtime server environment: ${JSON.stringify(formatted, null, 2)}`)
  }
  return parsed.data
}

export const env = parseEnv()

export const isProd = env.NODE_ENV === 'production'
export const isDev = env.NODE_ENV === 'development'
export const isTest = env.NODE_ENV === 'test'

let appHostname = ''
try {
  appHostname = new URL(env.NEXT_PUBLIC_APP_URL).hostname
} catch {}
export const isHosted = appHostname === 'sim.ai' || appHostname.endsWith('.sim.ai')

export const isAuthDisabled = env.DISABLE_AUTH === true && !isHosted

export function getBaseUrl(): string {
  return env.NEXT_PUBLIC_APP_URL
}
