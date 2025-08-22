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
    DATABASE_URL:                          z.string().url(),                       // Primary database connection string
    BETTER_AUTH_URL:                       z.string().url(),                       // Base URL for Better Auth service
    BETTER_AUTH_SECRET:                    z.string().min(32),                     // Secret key for Better Auth JWT signing
    DISABLE_REGISTRATION:                  z.boolean().optional(),                 // Flag to disable new user registration
    ALLOWED_LOGIN_EMAILS:                  z.string().optional(),                  // Comma-separated list of allowed email addresses for login
    ALLOWED_LOGIN_DOMAINS:                 z.string().optional(),                  // Comma-separated list of allowed email domains for login
    ENCRYPTION_KEY:                        z.string().min(32),                     // Key for encrypting sensitive data
    INTERNAL_API_SECRET:                   z.string().min(32),                     // Secret for internal API authentication
    COPILOT_API_KEY:                       z.string().min(1).optional(),           // Secret for internal sim agent API authentication
    SIM_AGENT_API_URL:                     z.string().url().optional(),            // URL for internal sim agent API
    AGENT_API_DB_ENCRYPTION_KEY:           z.string().min(32).optional(),          // Key for encrypting sensitive data for sim agent
    AGENT_API_NETWORK_ENCRYPTION_KEY:      z.string().min(32).optional(),          // Key for encrypting sensitive data for sim agent

    // Database & Storage
    POSTGRES_URL:                          z.string().url().optional(),            // Alternative PostgreSQL connection string
    REDIS_URL:                             z.string().url().optional(),            // Redis connection string for caching/sessions

    // Payment & Billing
    STRIPE_SECRET_KEY:                     z.string().min(1).optional(),           // Stripe secret key for payment processing
    STRIPE_BILLING_WEBHOOK_SECRET:         z.string().min(1).optional(),           // Webhook secret for billing events
    STRIPE_WEBHOOK_SECRET:                 z.string().min(1).optional(),           // General Stripe webhook secret
    STRIPE_FREE_PRICE_ID:                  z.string().min(1).optional(),           // Stripe price ID for free tier
    FREE_TIER_COST_LIMIT:                  z.number().optional(),                  // Cost limit for free tier users
    STRIPE_PRO_PRICE_ID:                   z.string().min(1).optional(),           // Stripe price ID for pro tier
    PRO_TIER_COST_LIMIT:                   z.number().optional(),                  // Cost limit for pro tier users
    STRIPE_TEAM_PRICE_ID:                  z.string().min(1).optional(),           // Stripe price ID for team tier
    TEAM_TIER_COST_LIMIT:                  z.number().optional(),                  // Cost limit for team tier users
    STRIPE_ENTERPRISE_PRICE_ID:            z.string().min(1).optional(),           // Stripe price ID for enterprise tier
    ENTERPRISE_TIER_COST_LIMIT:            z.number().optional(),                  // Cost limit for enterprise tier users
    BILLING_ENABLED:                       z.boolean().optional(),                 // Enable billing enforcement and usage tracking

    // Email & Communication
    RESEND_API_KEY:                        z.string().min(1).optional(),           // Resend API key for transactional emails
    FROM_EMAIL_ADDRESS:                    z.string().min(1).optional(),           // Complete from address (e.g., "Sim <noreply@domain.com>" or "noreply@domain.com")
    EMAIL_DOMAIN:                          z.string().min(1).optional(),           // Domain for sending emails (fallback when FROM_EMAIL_ADDRESS not set)
    AZURE_ACS_CONNECTION_STRING:           z.string().optional(),                  // Azure Communication Services connection string

    // AI/LLM Provider API Keys
    OPENAI_API_KEY:                        z.string().min(1).optional(),           // Primary OpenAI API key
    OPENAI_API_KEY_1:                      z.string().min(1).optional(),           // Additional OpenAI API key for load balancing
    OPENAI_API_KEY_2:                      z.string().min(1).optional(),           // Additional OpenAI API key for load balancing
    OPENAI_API_KEY_3:                      z.string().min(1).optional(),           // Additional OpenAI API key for load balancing
    MISTRAL_API_KEY:                       z.string().min(1).optional(),           // Mistral AI API key
    ANTHROPIC_API_KEY_1:                   z.string().min(1).optional(),           // Primary Anthropic Claude API key
    ANTHROPIC_API_KEY_2:                   z.string().min(1).optional(),           // Additional Anthropic API key for load balancing
    ANTHROPIC_API_KEY_3:                   z.string().min(1).optional(),           // Additional Anthropic API key for load balancing
    OLLAMA_URL:                            z.string().url().optional(),            // Ollama local LLM server URL
    ELEVENLABS_API_KEY:                    z.string().min(1).optional(),           // ElevenLabs API key for text-to-speech in deployed chat
    SERPER_API_KEY:                        z.string().min(1).optional(),           // Serper API key for online search

    // Azure Configuration - Shared credentials with feature-specific models
    AZURE_OPENAI_ENDPOINT:                 z.string().url().optional(),            // Shared Azure OpenAI service endpoint
    AZURE_OPENAI_API_VERSION:              z.string().optional(),                  // Shared Azure OpenAI API version
    AZURE_OPENAI_API_KEY:                  z.string().min(1).optional(),           // Shared Azure OpenAI API key
    KB_OPENAI_MODEL_NAME:                  z.string().optional(),                  // Knowledge base OpenAI model name (works with both regular OpenAI and Azure OpenAI)
    WAND_OPENAI_MODEL_NAME:                z.string().optional(),                  // Wand generation OpenAI model name (works with both regular OpenAI and Azure OpenAI)
    OCR_AZURE_ENDPOINT:                    z.string().url().optional(),            // Azure Mistral OCR service endpoint
    OCR_AZURE_MODEL_NAME:                  z.string().optional(),                  // Azure Mistral OCR model name for document processing

    // Monitoring & Analytics
    TELEMETRY_ENDPOINT:                    z.string().url().optional(),            // Custom telemetry/analytics endpoint
    COST_MULTIPLIER:                       z.number().optional(),                  // Multiplier for cost calculations
    SENTRY_ORG:                            z.string().optional(),                  // Sentry organization for error tracking
    SENTRY_PROJECT:                        z.string().optional(),                  // Sentry project for error tracking
    SENTRY_AUTH_TOKEN:                     z.string().optional(),                  // Sentry authentication token

    // External Services
    JWT_SECRET:                            z.string().min(1).optional(),           // JWT signing secret for custom tokens
    BROWSERBASE_API_KEY:                   z.string().min(1).optional(),           // Browserbase API key for browser automation
    BROWSERBASE_PROJECT_ID:                z.string().min(1).optional(),           // Browserbase project ID
    GITHUB_TOKEN:                          z.string().optional(),                  // GitHub personal access token for API access

    // Infrastructure & Deployment
    NEXT_RUNTIME:                          z.string().optional(),                  // Next.js runtime environment
    VERCEL_ENV:                            z.string().optional(),                  // Vercel deployment environment
    DOCKER_BUILD:                          z.boolean().optional(),                 // Flag indicating Docker build environment

    // Background Jobs & Scheduling
    TRIGGER_SECRET_KEY:                    z.string().min(1).optional(),           // Trigger.dev secret key for background jobs
    CRON_SECRET:                           z.string().optional(),                  // Secret for authenticating cron job requests
    JOB_RETENTION_DAYS:                    z.string().optional().default('1'),     // Days to retain job logs/data

    // Cloud Storage - AWS S3
    AWS_REGION:                            z.string().optional(),                  // AWS region for S3 buckets
    AWS_ACCESS_KEY_ID:                     z.string().optional(),                  // AWS access key ID
    AWS_SECRET_ACCESS_KEY:                 z.string().optional(),                  // AWS secret access key
    S3_BUCKET_NAME:                        z.string().optional(),                  // S3 bucket for general file storage
    S3_LOGS_BUCKET_NAME:                   z.string().optional(),                  // S3 bucket for storing logs
    S3_KB_BUCKET_NAME:                     z.string().optional(),                  // S3 bucket for knowledge base files
    S3_EXECUTION_FILES_BUCKET_NAME:        z.string().optional(),                  // S3 bucket for workflow execution files
    S3_CHAT_BUCKET_NAME:                   z.string().optional(),                  // S3 bucket for chat logos
    S3_COPILOT_BUCKET_NAME:                z.string().optional(),                  // S3 bucket for copilot files

    // Cloud Storage - Azure Blob 
    AZURE_ACCOUNT_NAME:                    z.string().optional(),                  // Azure storage account name
    AZURE_ACCOUNT_KEY:                     z.string().optional(),                  // Azure storage account key
    AZURE_CONNECTION_STRING:               z.string().optional(),                  // Azure storage connection string
    AZURE_STORAGE_CONTAINER_NAME:          z.string().optional(),                  // Azure container for general files
    AZURE_STORAGE_KB_CONTAINER_NAME:       z.string().optional(),                  // Azure container for knowledge base files
    AZURE_STORAGE_EXECUTION_FILES_CONTAINER_NAME: z.string().optional(),          // Azure container for workflow execution files
    AZURE_STORAGE_CHAT_CONTAINER_NAME:     z.string().optional(),                  // Azure container for chat logos
    AZURE_STORAGE_COPILOT_CONTAINER_NAME:  z.string().optional(),                  // Azure container for copilot files

    // Data Retention
    FREE_PLAN_LOG_RETENTION_DAYS:          z.string().optional(),                  // Log retention days for free plan users

    // Rate Limiting Configuration
    RATE_LIMIT_WINDOW_MS:                  z.string().optional().default('60000'), // Rate limit window duration in milliseconds (default: 1 minute)
    MANUAL_EXECUTION_LIMIT:                z.string().optional().default('999999'),// Manual execution bypass value (effectively unlimited)
    RATE_LIMIT_FREE_SYNC:                  z.string().optional().default('10'),    // Free tier sync API executions per minute
    RATE_LIMIT_FREE_ASYNC:                 z.string().optional().default('50'),    // Free tier async API executions per minute
    RATE_LIMIT_PRO_SYNC:                   z.string().optional().default('25'),    // Pro tier sync API executions per minute
    RATE_LIMIT_PRO_ASYNC:                  z.string().optional().default('200'),   // Pro tier async API executions per minute
    RATE_LIMIT_TEAM_SYNC:                  z.string().optional().default('75'),    // Team tier sync API executions per minute
    RATE_LIMIT_TEAM_ASYNC:                 z.string().optional().default('500'),   // Team tier async API executions per minute
    RATE_LIMIT_ENTERPRISE_SYNC:            z.string().optional().default('150'),   // Enterprise tier sync API executions per minute
    RATE_LIMIT_ENTERPRISE_ASYNC:           z.string().optional().default('1000'),  // Enterprise tier async API executions per minute

    // Real-time Communication
    SOCKET_SERVER_URL:                     z.string().url().optional(),            // WebSocket server URL for real-time features
    SOCKET_PORT:                           z.number().optional(),                  // Port for WebSocket server
    PORT:                                  z.number().optional(),                  // Main application port
    ALLOWED_ORIGINS:                       z.string().optional(),                  // CORS allowed origins

    // OAuth Integration Credentials - All optional, enables third-party integrations
    GOOGLE_CLIENT_ID:                      z.string().optional(),                  // Google OAuth client ID for Google services
    GOOGLE_CLIENT_SECRET:                  z.string().optional(),                  // Google OAuth client secret
    GITHUB_CLIENT_ID:                      z.string().optional(),                  // GitHub OAuth client ID for GitHub integration
    GITHUB_CLIENT_SECRET:                  z.string().optional(),                  // GitHub OAuth client secret
    GITHUB_REPO_CLIENT_ID:                 z.string().optional(),                  // GitHub OAuth client ID for repo access
    GITHUB_REPO_CLIENT_SECRET:             z.string().optional(),                  // GitHub OAuth client secret for repo access
    X_CLIENT_ID:                           z.string().optional(),                  // X (Twitter) OAuth client ID
    X_CLIENT_SECRET:                       z.string().optional(),                  // X (Twitter) OAuth client secret
    CONFLUENCE_CLIENT_ID:                  z.string().optional(),                  // Atlassian Confluence OAuth client ID
    CONFLUENCE_CLIENT_SECRET:              z.string().optional(),                  // Atlassian Confluence OAuth client secret
    JIRA_CLIENT_ID:                        z.string().optional(),                  // Atlassian Jira OAuth client ID
    JIRA_CLIENT_SECRET:                    z.string().optional(),                  // Atlassian Jira OAuth client secret
    AIRTABLE_CLIENT_ID:                    z.string().optional(),                  // Airtable OAuth client ID
    AIRTABLE_CLIENT_SECRET:                z.string().optional(),                  // Airtable OAuth client secret
    SUPABASE_CLIENT_ID:                    z.string().optional(),                  // Supabase OAuth client ID
    SUPABASE_CLIENT_SECRET:                z.string().optional(),                  // Supabase OAuth client secret
    NOTION_CLIENT_ID:                      z.string().optional(),                  // Notion OAuth client ID
    NOTION_CLIENT_SECRET:                  z.string().optional(),                  // Notion OAuth client secret
    DISCORD_CLIENT_ID:                     z.string().optional(),                  // Discord OAuth client ID
    DISCORD_CLIENT_SECRET:                 z.string().optional(),                  // Discord OAuth client secret
    MICROSOFT_CLIENT_ID:                   z.string().optional(),                  // Microsoft OAuth client ID for Office 365/Teams
    MICROSOFT_CLIENT_SECRET:               z.string().optional(),                  // Microsoft OAuth client secret
    HUBSPOT_CLIENT_ID:                     z.string().optional(),                  // HubSpot OAuth client ID
    HUBSPOT_CLIENT_SECRET:                 z.string().optional(),                  // HubSpot OAuth client secret
    WEALTHBOX_CLIENT_ID:                   z.string().optional(),                  // WealthBox OAuth client ID
    WEALTHBOX_CLIENT_SECRET:               z.string().optional(),                  // WealthBox OAuth client secret
    LINEAR_CLIENT_ID:                      z.string().optional(),                  // Linear OAuth client ID
    LINEAR_CLIENT_SECRET:                  z.string().optional(),                  // Linear OAuth client secret
    SLACK_CLIENT_ID:                       z.string().optional(),                  // Slack OAuth client ID
    SLACK_CLIENT_SECRET:                   z.string().optional(),                  // Slack OAuth client secret
    REDDIT_CLIENT_ID:                      z.string().optional(),                  // Reddit OAuth client ID
    REDDIT_CLIENT_SECRET:                  z.string().optional(),                  // Reddit OAuth client secret
  },

  client: {
    // Core Application URLs - Required for frontend functionality
    NEXT_PUBLIC_APP_URL:                   z.string().url(),                       // Base URL of the application (e.g., https://app.sim.ai)
    NEXT_PUBLIC_VERCEL_URL:                z.string().optional(),                  // Vercel deployment URL for preview/production

    // Client-side Services
    NEXT_PUBLIC_SENTRY_DSN:                z.string().url().optional(),            // Sentry DSN for client-side error tracking
    NEXT_PUBLIC_SOCKET_URL:                z.string().url().optional(),            // WebSocket server URL for real-time features

    // Asset Storage
    NEXT_PUBLIC_BLOB_BASE_URL:             z.string().url().optional(),            // Base URL for Vercel Blob storage (CDN assets)
    
    // Billing
    NEXT_PUBLIC_BILLING_ENABLED:           z.boolean().optional(),                 // Enable billing enforcement and usage tracking (client-side)

    // Google Services - For client-side Google integrations
    NEXT_PUBLIC_GOOGLE_CLIENT_ID:          z.string().optional(),                  // Google OAuth client ID for browser auth
    
    // Analytics & Tracking
    NEXT_PUBLIC_RB2B_KEY:                  z.string().optional(),                  // RB2B tracking key for B2B analytics
    NEXT_PUBLIC_GOOGLE_API_KEY:            z.string().optional(),                  // Google API key for client-side API calls
    NEXT_PUBLIC_GOOGLE_PROJECT_NUMBER:     z.string().optional(),                  // Google project number for Drive picker

    // UI Branding & Whitelabeling
    NEXT_PUBLIC_BRAND_NAME:                z.string().optional(),                  // Custom brand name (defaults to "Sim")
    NEXT_PUBLIC_BRAND_LOGO_URL:            z.string().url().optional(),            // Custom logo URL
    NEXT_PUBLIC_BRAND_FAVICON_URL:         z.string().url().optional(),            // Custom favicon URL
    NEXT_PUBLIC_CUSTOM_CSS_URL:            z.string().url().optional(),            // Custom CSS stylesheet URL
    NEXT_PUBLIC_SUPPORT_EMAIL:             z.string().email().optional(),          // Custom support email
    NEXT_PUBLIC_DOCUMENTATION_URL:         z.string().url().optional(),            // Custom documentation URL
    NEXT_PUBLIC_TERMS_URL:                 z.string().url().optional(),            // Custom terms of service URL
    NEXT_PUBLIC_PRIVACY_URL:               z.string().url().optional(),            // Custom privacy policy URL

    // Theme Customization
    NEXT_PUBLIC_BRAND_PRIMARY_COLOR:       z.string().regex(/^#[0-9A-Fa-f]{6}$/).optional(),     // Primary brand color (hex format, e.g., "#701ffc")
    NEXT_PUBLIC_BRAND_PRIMARY_HOVER_COLOR: z.string().regex(/^#[0-9A-Fa-f]{6}$/).optional(),    // Primary brand hover state (hex format)
    NEXT_PUBLIC_BRAND_SECONDARY_COLOR:     z.string().regex(/^#[0-9A-Fa-f]{6}$/).optional(),     // Secondary brand color (hex format)
    NEXT_PUBLIC_BRAND_ACCENT_COLOR:        z.string().regex(/^#[0-9A-Fa-f]{6}$/).optional(),     // Accent brand color (hex format)
    NEXT_PUBLIC_BRAND_ACCENT_HOVER_COLOR:  z.string().regex(/^#[0-9A-Fa-f]{6}$/).optional(),     // Accent brand hover state (hex format)
    NEXT_PUBLIC_BRAND_BACKGROUND_COLOR:    z.string().regex(/^#[0-9A-Fa-f]{6}$/).optional(),     // Brand background color (hex format)
  },

  // Variables available on both server and client
  shared: {
    NODE_ENV:                              z.enum(['development', 'test', 'production']).optional(), // Runtime environment
    NEXT_TELEMETRY_DISABLED:               z.string().optional(),                // Disable Next.js telemetry collection
  },

  experimental__runtimeEnv: {
    NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL,
    NEXT_PUBLIC_VERCEL_URL: process.env.NEXT_PUBLIC_VERCEL_URL,
    NEXT_PUBLIC_SENTRY_DSN: process.env.NEXT_PUBLIC_SENTRY_DSN,
    NEXT_PUBLIC_BLOB_BASE_URL: process.env.NEXT_PUBLIC_BLOB_BASE_URL,
    NEXT_PUBLIC_BILLING_ENABLED: process.env.NEXT_PUBLIC_BILLING_ENABLED,
    NEXT_PUBLIC_GOOGLE_CLIENT_ID: process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID,
    NEXT_PUBLIC_RB2B_KEY: process.env.NEXT_PUBLIC_RB2B_KEY,
    NEXT_PUBLIC_GOOGLE_API_KEY: process.env.NEXT_PUBLIC_GOOGLE_API_KEY,
    NEXT_PUBLIC_GOOGLE_PROJECT_NUMBER: process.env.NEXT_PUBLIC_GOOGLE_PROJECT_NUMBER,
    NEXT_PUBLIC_SOCKET_URL: process.env.NEXT_PUBLIC_SOCKET_URL,
    NEXT_PUBLIC_BRAND_NAME: process.env.NEXT_PUBLIC_BRAND_NAME,
    NEXT_PUBLIC_BRAND_LOGO_URL: process.env.NEXT_PUBLIC_BRAND_LOGO_URL,
    NEXT_PUBLIC_BRAND_FAVICON_URL: process.env.NEXT_PUBLIC_BRAND_FAVICON_URL,
    NEXT_PUBLIC_CUSTOM_CSS_URL: process.env.NEXT_PUBLIC_CUSTOM_CSS_URL,
    NEXT_PUBLIC_SUPPORT_EMAIL: process.env.NEXT_PUBLIC_SUPPORT_EMAIL,
    NEXT_PUBLIC_DOCUMENTATION_URL: process.env.NEXT_PUBLIC_DOCUMENTATION_URL,
    NEXT_PUBLIC_TERMS_URL: process.env.NEXT_PUBLIC_TERMS_URL,
    NEXT_PUBLIC_PRIVACY_URL: process.env.NEXT_PUBLIC_PRIVACY_URL,
    NEXT_PUBLIC_BRAND_PRIMARY_COLOR: process.env.NEXT_PUBLIC_BRAND_PRIMARY_COLOR,
    NEXT_PUBLIC_BRAND_PRIMARY_HOVER_COLOR: process.env.NEXT_PUBLIC_BRAND_PRIMARY_HOVER_COLOR,
    NEXT_PUBLIC_BRAND_SECONDARY_COLOR: process.env.NEXT_PUBLIC_BRAND_SECONDARY_COLOR,
    NEXT_PUBLIC_BRAND_ACCENT_COLOR: process.env.NEXT_PUBLIC_BRAND_ACCENT_COLOR,
    NEXT_PUBLIC_BRAND_ACCENT_HOVER_COLOR: process.env.NEXT_PUBLIC_BRAND_ACCENT_HOVER_COLOR,
    NEXT_PUBLIC_BRAND_BACKGROUND_COLOR: process.env.NEXT_PUBLIC_BRAND_BACKGROUND_COLOR,
    NODE_ENV: process.env.NODE_ENV,
    NEXT_TELEMETRY_DISABLED: process.env.NEXT_TELEMETRY_DISABLED,
  },
})

// Need this utility because t3-env is returning string for boolean values.
export const isTruthy = (value: string | boolean | number | undefined) =>
  typeof value === 'string' ? value.toLowerCase() === 'true' || value === '1' : Boolean(value)

export { getEnv }
