import { createEnv } from '@t3-oss/env-nextjs'
import { env as runtimeEnv } from 'next-runtime-env'
import { z } from 'zod'

const getEnv = (variable: string) => runtimeEnv(variable) ?? process.env[variable]

export const env = createEnv({
  skipValidation: true,

  server: {
    DATABASE_URL: z.string().url(),
    BETTER_AUTH_URL: z.string().url(),
    BETTER_AUTH_SECRET: z.string().min(32),
    ENCRYPTION_KEY: z.string().min(32),

    POSTGRES_URL: z.string().url().optional(),
    STRIPE_SECRET_KEY: z.string().min(1).optional(),
    STRIPE_WEBHOOK_SECRET: z.string().min(1).optional(),
    STRIPE_FREE_PRICE_ID: z.string().min(1).optional(),
    FREE_TIER_COST_LIMIT: z
      .string()
      .regex(/^\d+(\.\d+)?$/)
      .optional(),
    STRIPE_PRO_PRICE_ID: z.string().min(1).optional(),
    PRO_TIER_COST_LIMIT: z
      .string()
      .regex(/^\d+(\.\d+)?$/)
      .optional(),
    STRIPE_TEAM_PRICE_ID: z.string().min(1).optional(),
    TEAM_TIER_COST_LIMIT: z
      .string()
      .regex(/^\d+(\.\d+)?$/)
      .optional(),
    STRIPE_ENTERPRISE_PRICE_ID: z.string().min(1).optional(),
    ENTERPRISE_TIER_COST_LIMIT: z
      .string()
      .regex(/^\d+(\.\d+)?$/)
      .optional(),
    RESEND_API_KEY: z.string().min(1).optional(),
    OPENAI_API_KEY: z.string().min(1).optional(),
    OPENAI_API_KEY_1: z.string().min(1).optional(),
    OPENAI_API_KEY_2: z.string().min(1).optional(),
    OPENAI_API_KEY_3: z.string().min(1).optional(),
    ANTHROPIC_API_KEY_1: z.string().min(1).optional(),
    ANTHROPIC_API_KEY_2: z.string().min(1).optional(),
    ANTHROPIC_API_KEY_3: z.string().min(1).optional(),
    FREESTYLE_API_KEY: z.string().min(1).optional(),
    TELEMETRY_ENDPOINT: z.string().url().optional(),
    COST_MULTIPLIER: z
      .string()
      .regex(/^\d+(\.\d+)?$/)
      .optional(),
    JWT_SECRET: z.string().min(1).optional(),
    BROWSERBASE_API_KEY: z.string().min(1).optional(),
    BROWSERBASE_PROJECT_ID: z.string().min(1).optional(),
    OLLAMA_HOST: z.string().url().optional(),
    SENTRY_ORG: z.string().optional(),
    SENTRY_PROJECT: z.string().optional(),
    SENTRY_AUTH_TOKEN: z.string().optional(),
    REDIS_URL: z.string().url().optional(),
    NEXT_TELEMETRY_DISABLED: z.string().optional(),
    NEXT_RUNTIME: z.string().optional(),
    VERCEL_ENV: z.string().optional(),
    AWS_REGION: z.string().optional(),
    AWS_ACCESS_KEY_ID: z.string().optional(),
    AWS_SECRET_ACCESS_KEY: z.string().optional(),
    S3_BUCKET_NAME: z.string().optional(),
    S3_LOGS_BUCKET_NAME: z.string().optional(),
    USE_S3: z.coerce.boolean().optional(),
    CRON_SECRET: z.string().optional(),
    FREE_PLAN_LOG_RETENTION_DAYS: z.string().optional(),
    NODE_ENV: z.string().optional(),
    GITHUB_TOKEN: z.string().optional(),

    // OAuth blocks (all optional)
    GOOGLE_CLIENT_ID: z.string().optional(),
    GOOGLE_CLIENT_SECRET: z.string().optional(),
    GITHUB_CLIENT_ID: z.string().optional(),
    GITHUB_CLIENT_SECRET: z.string().optional(),
    GITHUB_REPO_CLIENT_ID: z.string().optional(),
    GITHUB_REPO_CLIENT_SECRET: z.string().optional(),
    X_CLIENT_ID: z.string().optional(),
    X_CLIENT_SECRET: z.string().optional(),
    CONFLUENCE_CLIENT_ID: z.string().optional(),
    CONFLUENCE_CLIENT_SECRET: z.string().optional(),
    JIRA_CLIENT_ID: z.string().optional(),
    JIRA_CLIENT_SECRET: z.string().optional(),
    AIRTABLE_CLIENT_ID: z.string().optional(),
    AIRTABLE_CLIENT_SECRET: z.string().optional(),
    SUPABASE_CLIENT_ID: z.string().optional(),
    SUPABASE_CLIENT_SECRET: z.string().optional(),
    NOTION_CLIENT_ID: z.string().optional(),
    NOTION_CLIENT_SECRET: z.string().optional(),
    DISCORD_CLIENT_ID: z.string().optional(),
    DISCORD_CLIENT_SECRET: z.string().optional(),
    HUBSPOT_CLIENT_ID: z.string().optional(),
    HUBSPOT_CLIENT_SECRET: z.string().optional(),
    DOCKER_BUILD: z.boolean().optional(),
  },

  client: {
    NEXT_PUBLIC_APP_URL: z.string().url(),
    NEXT_PUBLIC_VERCEL_URL: z.string().optional(),
    NEXT_PUBLIC_SENTRY_DSN: z.string().url().optional(),
    NEXT_PUBLIC_GOOGLE_CLIENT_ID: z.string().optional(),
    NEXT_PUBLIC_GOOGLE_API_KEY: z.string().optional(),
    NEXT_PUBLIC_GOOGLE_PROJECT_NUMBER: z.string().optional(),
  },

  // Only need to define client variables, server variables are automatically handled
  experimental__runtimeEnv: {
    NEXT_PUBLIC_APP_URL: getEnv('NEXT_PUBLIC_APP_URL'),
    NEXT_PUBLIC_VERCEL_URL: getEnv('NEXT_PUBLIC_VERCEL_URL'),
    NEXT_PUBLIC_SENTRY_DSN: getEnv('NEXT_PUBLIC_SENTRY_DSN'),
    NEXT_PUBLIC_GOOGLE_CLIENT_ID: getEnv('NEXT_PUBLIC_GOOGLE_CLIENT_ID'),
    NEXT_PUBLIC_GOOGLE_API_KEY: getEnv('NEXT_PUBLIC_GOOGLE_API_KEY'),
    NEXT_PUBLIC_GOOGLE_PROJECT_NUMBER: getEnv('NEXT_PUBLIC_GOOGLE_PROJECT_NUMBER'),
  },
})
