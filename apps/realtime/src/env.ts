import { z } from 'zod'

const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  DATABASE_URL: z.string().url(),
  REDIS_URL: z.string().url().optional(),
  BETTER_AUTH_URL: z.string().url(),
  BETTER_AUTH_SECRET: z.string().min(32),
  INTERNAL_API_SECRET: z.string().min(32),
  NEXT_PUBLIC_APP_URL: z.string().url(),
  INTERNAL_API_BASE_URL: z.string().url().optional(),
  ALLOWED_ORIGINS: z.string().optional(),
  SOCKET_SERVER_URL: z.string().url().optional(),
  PORT: z.coerce.number().int().positive().default(3002),
  SOCKET_PORT: z.coerce.number().int().positive().optional(),
  HOSTNAME: z.string().default('0.0.0.0'),
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

export function getInternalApiBaseUrl(): string {
  return env.INTERNAL_API_BASE_URL ?? env.NEXT_PUBLIC_APP_URL
}
