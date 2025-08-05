import { createEnv } from '@t3-oss/env-nextjs'
import { env as runtimeEnv } from 'next-runtime-env'
import { z } from 'zod'

/**
 * Universal environment variable getter that works in both client and server contexts.
 * - Client-side: Uses next-runtime-env for runtime injection (supports Docker runtime vars)
 * - Server-side: Falls back to process.env when runtimeEnv returns undefined
 * - Provides seamless Docker runtime variable support for NEXT_PUBLIC_ vars
 */
const getEnv = (variable: string) => runtimeEnv(variable) ?? process.env[variable]

// biome-ignore format: keep alignment for readability
export const env = createEnv({
  skipValidation: true,

  server: {
    // Core Database & Authentication
    DATABASE_URL:                         z.string().url(),                     // Primary database connection string
    BETTER_AUTH_URL:                      z.string().url(),                     // Base URL for Better Auth service
    BETTER_AUTH_SECRET:                   z.string().min(32),                   // Secret key for Better Auth JWT signing
    DISABLE_REGISTRATION:                 z.boolean().optional(),               // Flag to disable new user registration
    ENCRYPTION_KEY:                       z.string().min(32),                   // Key for encrypting sensitive data
    INTERNAL_API_SECRET:                  z.string().min(32),                   // Secret for internal API authentication
    SIM_AGENT_API_KEY:                    z.string().min(1).optional(),         // Secret for internal sim agent API authentication
    SIM_AGENT_API_URL:                    z.string().url().optional(),          // URL for internal sim agent API

    // Database & Storage
    POSTGRES_URL:                         z.string().url().optional(),          // Alternative PostgreSQL connection string
    REDIS_URL:                            z.string().url().optional(),          // Redis connection string for caching/sessions

    // Payment & Billing (Stripe)
    STRIPE_SECRET_KEY:                    z.string().min(1).optional(),         // Stripe secret key for payment processing
    STRIPE_BILLING_WEBHOOK_SECRET:        z.string().min(1).optional(),         // Webhook secret for billing events
    STRIPE_WEBHOOK_SECRET:                z.string().min(1).optional(),         // General Stripe webhook secret
    STRIPE_FREE_PRICE_ID:                 z.string().min(1).optional(),         // Stripe price ID for free tier
    FREE_TIER_COST_LIMIT:                 z.number().optional(),                // Cost limit for free tier users
    STRIPE_PRO_PRICE_ID:                  z.string().min(1).optional(),         // Stripe price ID for pro tier
    PRO_TIER_COST_LIMIT:                  z.number().optional(),                // Cost limit for pro tier users
    STRIPE_TEAM_PRICE_ID:                 z.string().min(1).optional(),         // Stripe price ID for team tier
    TEAM_TIER_COST_LIMIT:                 z.number().optional(),                // Cost limit for team tier users
    STRIPE_ENTERPRISE_PRICE_ID:           z.string().min(1).optional(),         // Stripe price ID for enterprise tier
    ENTERPRISE_TIER_COST_LIMIT:           z.number().optional(),                // Cost limit for enterprise tier users

    // Email & Communication
    RESEND_API_KEY:                       z.string().min(1).optional(),         // Resend API key for transactional emails
    EMAIL_DOMAIN:                         z.string().min(1).optional(),         // Domain for sending emails

    // AI/LLM Provider API Keys
    OPENAI_API_KEY:                       z.string().min(1).optional(),         // Primary OpenAI API key
    OPENAI_API_KEY_1:                     z.string().min(1).optional(),         // Additional OpenAI API key for load balancing
    OPENAI_API_KEY_2:                     z.string().min(1).optional(),         // Additional OpenAI API key for load balancing
    OPENAI_API_KEY_3:                     z.string().min(1).optional(),         // Additional OpenAI API key for load balancing
    MISTRAL_API_KEY:                      z.string().min(1).optional(),         // Mistral AI API key
    ANTHROPIC_API_KEY_1:                  z.string().min(1).optional(),         // Primary Anthropic Claude API key
    ANTHROPIC_API_KEY_2:                  z.string().min(1).optional(),         // Additional Anthropic API key for load balancing
    ANTHROPIC_API_KEY_3:                  z.string().min(1).optional(),         // Additional Anthropic API key for load balancing
    FREESTYLE_API_KEY:                    z.string().min(1).optional(),         // Freestyle AI API key
    OLLAMA_URL:                           z.string().url().optional(),          // Ollama local LLM server URL
    ELEVENLABS_API_KEY:                   z.string().min(1).optional(),         // ElevenLabs API key for text-to-speech in deployed chat
    SERPER_API_KEY:                       z.string().min(1).optional(),         // Serper API key for online search

    // Azure OpenAI Configuration
    AZURE_OPENAI_ENDPOINT:                z.string().url().optional(),          // Azure OpenAI service endpoint
    AZURE_OPENAI_API_VERSION:             z.string().optional(),                // Azure OpenAI API version

    // Monitoring & Analytics
    TELEMETRY_ENDPOINT:                   z.string().url().optional(),          // Custom telemetry/analytics endpoint
    COST_MULTIPLIER:                      z.number().optional(),                // Multiplier for cost calculations
    COPILOT_COST_MULTIPLIER:              z.number().optional(),                // Multiplier for copilot cost calculations
    SENTRY_ORG:                           z.string().optional(),                // Sentry organization for error tracking
    SENTRY_PROJECT:                       z.string().optional(),                // Sentry project for error tracking
    SENTRY_AUTH_TOKEN:                    z.string().optional(),                // Sentry authentication token

    // External Services
    JWT_SECRET:                           z.string().min(1).optional(),         // JWT signing secret for custom tokens
    BROWSERBASE_API_KEY:                  z.string().min(1).optional(),         // Browserbase API key for browser automation
    BROWSERBASE_PROJECT_ID:               z.string().min(1).optional(),         // Browserbase project ID
    GITHUB_TOKEN:                         z.string().optional(),                // GitHub personal access token for API access

    // Infrastructure & Deployment
    NEXT_RUNTIME:                         z.string().optional(),                // Next.js runtime environment
    VERCEL_ENV:                           z.string().optional(),                // Vercel deployment environment
    DOCKER_BUILD:                         z.boolean().optional(),               // Flag indicating Docker build environment

    // Background Jobs & Scheduling
    TRIGGER_SECRET_KEY:                   z.string().min(1).optional(),         // Trigger.dev secret key for background jobs
    CRON_SECRET:                          z.string().optional(),                // Secret for authenticating cron job requests
    JOB_RETENTION_DAYS:                   z.string().optional().default('1'),   // Days to retain job logs/data

    // Cloud Storage - AWS S3
    AWS_REGION:                           z.string().optional(),                // AWS region for S3 buckets
    AWS_ACCESS_KEY_ID:                    z.string().optional(),                // AWS access key ID
    AWS_SECRET_ACCESS_KEY:                z.string().optional(),                // AWS secret access key
    S3_BUCKET_NAME:                       z.string().optional(),                // S3 bucket for general file storage
    S3_LOGS_BUCKET_NAME:                  z.string().optional(),                // S3 bucket for storing logs
    S3_KB_BUCKET_NAME:                    z.string().optional(),                // S3 bucket for knowledge base files
    S3_CHAT_BUCKET_NAME:                  z.string().optional(),                // S3 bucket for chat logos

    // Cloud Storage - Azure Blob
    AZURE_ACCOUNT_NAME:                   z.string().optional(),                // Azure storage account name
    AZURE_ACCOUNT_KEY:                    z.string().optional(),                // Azure storage account key
    AZURE_CONNECTION_STRING:              z.string().optional(),                // Azure storage connection string
    AZURE_STORAGE_CONTAINER_NAME:         z.string().optional(),                // Azure container for general files
    AZURE_STORAGE_KB_CONTAINER_NAME:      z.string().optional(),                // Azure container for knowledge base files
    AZURE_STORAGE_CHAT_CONTAINER_NAME:    z.string().optional(),                // Azure container for chat logos

    // Data Retention
    FREE_PLAN_LOG_RETENTION_DAYS:         z.string().optional(),                // Log retention days for free plan users

    // Real-time Communication
    SOCKET_SERVER_URL:                    z.string().url().optional(),          // WebSocket server URL for real-time features
    SOCKET_PORT:                          z.number().optional(),                // Port for WebSocket server
    PORT:                                 z.number().optional(),                // Main application port
    ALLOWED_ORIGINS:                      z.string().optional(),                // CORS allowed origins

    // OAuth Integration Credentials - All optional, enables third-party integrations
    GOOGLE_CLIENT_ID:                     z.string().optional(),                // Google OAuth client ID for Google services
    GOOGLE_CLIENT_SECRET:                 z.string().optional(),                // Google OAuth client secret
    GITHUB_CLIENT_ID:                     z.string().optional(),                // GitHub OAuth client ID for GitHub integration
    GITHUB_CLIENT_SECRET:                 z.string().optional(),                // GitHub OAuth client secret
    GITHUB_REPO_CLIENT_ID:                z.string().optional(),                // GitHub OAuth client ID for repo access
    GITHUB_REPO_CLIENT_SECRET:            z.string().optional(),                // GitHub OAuth client secret for repo access
    X_CLIENT_ID:                          z.string().optional(),                // X (Twitter) OAuth client ID
    X_CLIENT_SECRET:                      z.string().optional(),                // X (Twitter) OAuth client secret
    CONFLUENCE_CLIENT_ID:                 z.string().optional(),                // Atlassian Confluence OAuth client ID
    CONFLUENCE_CLIENT_SECRET:             z.string().optional(),                // Atlassian Confluence OAuth client secret
    JIRA_CLIENT_ID:                       z.string().optional(),                // Atlassian Jira OAuth client ID
    JIRA_CLIENT_SECRET:                   z.string().optional(),                // Atlassian Jira OAuth client secret
    AIRTABLE_CLIENT_ID:                   z.string().optional(),                // Airtable OAuth client ID
    AIRTABLE_CLIENT_SECRET:               z.string().optional(),                // Airtable OAuth client secret
    SUPABASE_CLIENT_ID:                   z.string().optional(),                // Supabase OAuth client ID
    SUPABASE_CLIENT_SECRET:               z.string().optional(),                // Supabase OAuth client secret
    NOTION_CLIENT_ID:                     z.string().optional(),                // Notion OAuth client ID
    NOTION_CLIENT_SECRET:                 z.string().optional(),                // Notion OAuth client secret
    DISCORD_CLIENT_ID:                    z.string().optional(),                // Discord OAuth client ID
    DISCORD_CLIENT_SECRET:                z.string().optional(),                // Discord OAuth client secret
    MICROSOFT_CLIENT_ID:                  z.string().optional(),                // Microsoft OAuth client ID for Office 365/Teams
    MICROSOFT_CLIENT_SECRET:              z.string().optional(),                // Microsoft OAuth client secret
    HUBSPOT_CLIENT_ID:                    z.string().optional(),                // HubSpot OAuth client ID
    HUBSPOT_CLIENT_SECRET:                z.string().optional(),                // HubSpot OAuth client secret
    WEALTHBOX_CLIENT_ID:                  z.string().optional(),                // WealthBox OAuth client ID
    WEALTHBOX_CLIENT_SECRET:              z.string().optional(),                // WealthBox OAuth client secret
    LINEAR_CLIENT_ID:                     z.string().optional(),                // Linear OAuth client ID
    LINEAR_CLIENT_SECRET:                 z.string().optional(),                // Linear OAuth client secret
    SLACK_CLIENT_ID:                      z.string().optional(),                // Slack OAuth client ID
    SLACK_CLIENT_SECRET:                  z.string().optional(),                // Slack OAuth client secret
    REDDIT_CLIENT_ID:                     z.string().optional(),                // Reddit OAuth client ID
    REDDIT_CLIENT_SECRET:                 z.string().optional(),                // Reddit OAuth client secret
  },

  client: {
    // Core Application URLs - Required for frontend functionality
    NEXT_PUBLIC_APP_URL:                  z.string().url(),                     // Base URL of the application (e.g., https://app.sim.ai)
    NEXT_PUBLIC_VERCEL_URL:               z.string().optional(),                // Vercel deployment URL for preview/production

    // Client-side Services
    NEXT_PUBLIC_SENTRY_DSN:               z.string().url().optional(),          // Sentry DSN for client-side error tracking
    NEXT_PUBLIC_SOCKET_URL:               z.string().url().optional(),          // WebSocket server URL for real-time features

    // Asset Storage
    NEXT_PUBLIC_BLOB_BASE_URL:            z.string().url().optional(),          // Base URL for Vercel Blob storage (CDN assets)

    // Google Services - For client-side Google integrations
    NEXT_PUBLIC_GOOGLE_CLIENT_ID:         z.string().optional(),                // Google OAuth client ID for browser auth
    
    // Analytics & Tracking
    NEXT_PUBLIC_RB2B_KEY:                 z.string().optional(),                // RB2B tracking key for B2B analytics
    NEXT_PUBLIC_GOOGLE_API_KEY:           z.string().optional(),                // Google API key for client-side API calls
    NEXT_PUBLIC_GOOGLE_PROJECT_NUMBER:    z.string().optional(),                // Google project number for Drive picker
  },

  // Variables available on both server and client
  shared: {
    NODE_ENV:                             z.enum(['development', 'test', 'production']).optional(), // Runtime environment
    NEXT_TELEMETRY_DISABLED:              z.string().optional(),                // Disable Next.js telemetry collection
  },

  experimental__runtimeEnv: {
    NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL,
    NEXT_PUBLIC_VERCEL_URL: process.env.NEXT_PUBLIC_VERCEL_URL,
    NEXT_PUBLIC_SENTRY_DSN: process.env.NEXT_PUBLIC_SENTRY_DSN,
    NEXT_PUBLIC_BLOB_BASE_URL: process.env.NEXT_PUBLIC_BLOB_BASE_URL,
    NEXT_PUBLIC_GOOGLE_CLIENT_ID: process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID,
    NEXT_PUBLIC_RB2B_KEY: process.env.NEXT_PUBLIC_RB2B_KEY,
    NEXT_PUBLIC_GOOGLE_API_KEY: process.env.NEXT_PUBLIC_GOOGLE_API_KEY,
    NEXT_PUBLIC_GOOGLE_PROJECT_NUMBER: process.env.NEXT_PUBLIC_GOOGLE_PROJECT_NUMBER,
    NEXT_PUBLIC_SOCKET_URL: process.env.NEXT_PUBLIC_SOCKET_URL,
    NODE_ENV: process.env.NODE_ENV,
    NEXT_TELEMETRY_DISABLED: process.env.NEXT_TELEMETRY_DISABLED,
  },
})

// Need this utility because t3-env is returning string for boolean values.
export const isTruthy = (value: string | boolean | number | undefined) =>
  typeof value === 'string' ? value === 'true' || value === '1' : Boolean(value)

export { getEnv }
