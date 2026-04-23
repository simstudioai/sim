import { z } from 'zod'

const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  DATABASE_URL: z.string().url(),
  REDIS_URL: z.string().url().optional(),
  BETTER_AUTH_URL: z.string().url(),
  BETTER_AUTH_SECRET: z.string().min(32),
  INTERNAL_API_SECRET: z.string().min(32),
  NEXT_PUBLIC_APP_URL: z.string().url(),
  ALLOWED_ORIGINS: z.string().optional(),
  PORT: z.coerce.number().int().positive().default(3002),
  DISABLE_AUTH: z
    .string()
    .optional()
    .transform((value) => value === 'true' || value === '1'),
})

function parseEnv() {
  const parsed = EnvSchema.safeParse(process.env)
  if (!parsed.success) {
    const formatted = parsed.error.format()
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
