import { createEnv } from '@t3-oss/env-nextjs'
import { z } from 'zod'

/**
 * Reads NEXT_PUBLIC_* env vars in both client and server contexts.
 * Client reads `window.__ENV` (populated by `<PublicEnvScript>`); server reads `process.env`.
 * We do not use next-runtime-env's `env()` helper because it calls `unstable_noStore()`,
 * which Next 16.2+ rejects outside a request scope.
 */
const getEnv = (variable: string): string | undefined => {
  if (typeof window === 'undefined') return process.env[variable]
  return window.__ENV?.[variable] ?? process.env[variable]
}

// biome-ignore format: keep alignment for readability
export const env = createEnv({
  skipValidation: true,

  server: {
    // Core Database & Authentication
    DATABASE_URL:                          z.string().url(),                       // Primary database connection string
    DATABASE_REPLICA_URL:                  z.string().url().optional(),            // Read-replica connection string; opt-in reads fall back to the primary when unset
    DB_APP_NAME:                           z.string().optional(),                  // Postgres application_name for query attribution (sim-app/sim-trigger/sim-realtime)
    SIM_DB_ROLE:                           z.enum(['web', 'trigger', 'realtime']).optional(), // Per-process pool profile selector (read directly by @sim/db)
    DATABASE_URL_WEB:                      z.string().url().optional(),            // Per-role primary URL override; @sim/db falls back to DATABASE_URL
    DATABASE_URL_TRIGGER:                  z.string().url().optional(),            // Per-role primary URL override (trigger)
    DATABASE_URL_REALTIME:                 z.string().url().optional(),            // Per-role primary URL override (realtime)
    DATABASE_REPLICA_URL_WEB:              z.string().url().optional(),            // Per-role replica URL override; falls back to DATABASE_REPLICA_URL
    DATABASE_REPLICA_URL_TRIGGER:          z.string().url().optional(),            // Per-role replica URL override (trigger)
    DATABASE_REPLICA_URL_REALTIME:         z.string().url().optional(),            // Per-role replica URL override (realtime)
    BETTER_AUTH_URL:                       z.string().url(),                       // Base URL for Better Auth service
    BETTER_AUTH_SECRET:                    z.string().min(32),                     // Secret key for Better Auth JWT signing
    DISABLE_REGISTRATION:                  z.boolean().optional(),                 // Flag to disable new user registration
    EMAIL_PASSWORD_SIGNUP_ENABLED:         z.boolean().optional().default(true),   // Enable email/password authentication (server-side enforcement)
    DISABLE_AUTH:                          z.boolean().optional(),                 // Bypass authentication entirely (self-hosted only, creates anonymous session)
    ALLOW_PRIVATE_DATABASE_HOSTS:          z.boolean().optional(),                 // Opt-in (self-hosted only): let database/connector tools reach private/reserved/loopback hosts (e.g. Docker/K8s service names). Loosens the SSRF boundary; ignored on the hosted platform.
    ALLOWED_LOGIN_EMAILS:                  z.string().optional(),                  // Comma-separated list of allowed email addresses for login
    ALLOWED_LOGIN_DOMAINS:                 z.string().optional(),                  // Comma-separated list of allowed email domains for login
    BLOCKED_SIGNUP_DOMAINS:                z.string().optional(),                  // Comma-separated list of email domains blocked from signing up (e.g., "gmail.com,yahoo.com")
    BLOCKED_EMAILS:                        z.string().optional(),                  // Comma-separated list of specific email addresses banned from the platform (signup, sign-in, executions)
    SIGNUP_MX_VALIDATION_ENABLED:          z.boolean().optional(),                 // Opt-in: validate the email's MX backend at signup (blocks no-MX domains and denylisted shared spam backends). Off by default; enable on hosted/abuse-targeted deployments.
    BLOCKED_EMAIL_MX_HOSTS:                z.string().optional(),                  // Comma-separated MX-host substrings blocked from signing up; matched against the domain's resolved MX backend to catch throwaway domains that share a mail backend. No defaults — operators supply their own list. Only used when SIGNUP_MX_VALIDATION_ENABLED is set.
    TRUSTED_ORIGINS:                       z.string().optional(),                  // Comma-separated additional origins to trust for auth (e.g., "https://app.example.com,https://www.example.com"). Merged into Better Auth trustedOrigins.
    TURNSTILE_SECRET_KEY:                  z.string().min(1).optional(),           // Cloudflare Turnstile secret key for captcha verification
    ENCRYPTION_KEY:                        z.string().min(32),                     // Key for encrypting sensitive data
    API_ENCRYPTION_KEY:                    z.string().min(32).optional(),          // Dedicated key for encrypting API keys (optional for OSS)
    INTERNAL_API_SECRET:                   z.string().min(32),                     // Secret for internal API authentication
    INTERNAL_JWT_SECRET:                   z.string().min(32).optional(),          // Dedicated signing key for internal JWTs (falls back to INTERNAL_API_SECRET); separating limits blast radius if one leaks

    // Full-stack Apps (separate origin — never add APP_PUBLIC_ORIGIN to Better Auth trustedOrigins)
    APP_PUBLIC_ORIGIN:                     z.string().url().optional(),            // Distinct apps hostname origin (e.g. https://apps.localhost:3005); required for Full-stack Apps
    APPS_PROXY_HOP_SECRET:                 z.string().min(32).optional(),          // HMAC secret for apps-domain → Sim hop proof (min 32 chars)
    APPS_ABUSE_TOKEN_SECRET:               z.string().min(32).optional(),          // Optional dedicated secret for visitor abuse tokens (falls back to hop secret)
    APPS_INTERNAL_GATEWAY_URL:             z.string().url().optional(),            // Sim base URL the apps-host proxies to (defaults to NEXT_PUBLIC_APP_URL)
    E2B_APP_BUILD_TEMPLATE_ID:             z.string().optional(),                  // Tagged E2B app-build image with curated deps (no user npm)
    E2B_APP_BUILD_IMAGE_DIGEST:            z.string().min(1).optional(),           // e2b-build:<buildId> emitted by build-app-e2b-template.ts
    APPS_ALLOW_FIXTURE_BUILDS:             z.boolean().optional(),                 // Dev-only: allow hash-only fixture builds (never for real artifacts)
    APPS_ALLOW_LOCAL_VITE_BUILDS:          z.boolean().optional(),                 // Dev/staging: trusted local Vite build (no E2B); never silent fallback from E2B
    APPS_ARTIFACT_ROOT:                    z.string().optional(),                  // Shared content-addressed artifact root (blobs/ + manifests/); apps-host must use the same path
    APPS_MONOREPO_ROOT:                    z.string().optional(),                  // Optional override for local Vite toolchain root (defaults to cwd/../..)
    APPS_TOOLCHAIN_ROOT:                   z.string().optional(),                  // Alias for APPS_MONOREPO_ROOT
    APPS_BLOB_GC_DRY_RUN:                  z.boolean().optional(),                 // Log orphan source/artifact blobs without deleting them
    APPS_BLOB_GC_MIN_AGE_HOURS:            z.coerce.number().positive().optional(), // Grace period before orphan blobs become eligible (default 24h)

    // Copilot
    COPILOT_API_KEY:                       z.string().min(1).optional(),           // Secret for internal sim agent API authentication
    /** Enables attributed-v1 only after compatible Copilot instances are deployed. */
    COPILOT_BILLING_ATTRIBUTION_V1_ENABLED: z.boolean().optional(),
    /** Rejects markerless old-Go billing traffic only when explicitly enabled. */
    COPILOT_BILLING_PROTOCOL_REQUIRED:     z.boolean().optional(),
    /** Demo-only Full-stack path: hosted Copilot + draft preview + publish-with-deploy. */
    FULLSTACK_DEMO_MODE:                   z.boolean().optional(),
    SIM_AGENT_API_URL:                     z.string().url().optional(),            // URL for internal sim agent API
    COPILOT_SOURCE_ENV:                    z.enum(['dev', 'staging', 'prod']).optional(), // Source Sim environment sent to mothership for callbacks
    COPILOT_DEV_URL:                       z.string().url().optional(),            // Sim agent API URL for the dev mothership environment
    COPILOT_STAGING_URL:                   z.string().url().optional(),            // Sim agent API URL for the staging mothership environment
    COPILOT_PROD_URL:                      z.string().url().optional(),            // Sim agent API URL for the production mothership environment
    AGENT_INDEXER_URL:                     z.string().url().optional(),            // URL for agent training data indexer
    AGENT_INDEXER_API_KEY:                 z.string().min(1).optional(),           // API key for agent indexer authentication
    COPILOT_STREAM_TTL_SECONDS:            z.number().optional(),                  // Redis TTL for copilot SSE buffer
    COPILOT_STREAM_EVENT_LIMIT:            z.number().optional(),                  // Max events retained per stream

    // Database & Storage
    REDIS_URL:                             z.string().url().optional(),            // Redis connection string for caching/sessions
    REDIS_TLS_SERVERNAME:                  z.string().min(1).optional(),           // TLS SNI override; required when REDIS_URL targets an IP over rediss:// (e.g. trigger.dev PrivateLink VPCE IP) so cert hostname verification matches the ElastiCache cert's CN

    // Payment & Billing
    STRIPE_SECRET_KEY:                     z.string().min(1).optional(),           // Stripe secret key for payment processing
    STRIPE_WEBHOOK_SECRET:                 z.string().min(1).optional(),           // General Stripe webhook secret
    STRIPE_FREE_PRICE_ID:                  z.string().min(1).optional(),           // Stripe price ID for free tier
    FREE_TIER_COST_LIMIT:                  z.number().optional(),                  // Cost limit for free tier users
    FREE_STORAGE_LIMIT_GB:                 z.number().optional(),                  // Free-tier storage limit in GB (default 5). With billing disabled, setting it explicitly opts into storage enforcement
    STRIPE_PRO_PRICE_ID:                   z.string().min(1).optional(),           // Stripe price ID for pro tier
    PRO_TIER_COST_LIMIT:                   z.number().optional(),                  // Cost limit for pro tier users
    PRO_STORAGE_LIMIT_GB:                  z.number().optional().default(50),      // Storage limit in GB for pro tier users
    STRIPE_TEAM_PRICE_ID:                  z.string().min(1).optional(),           // Stripe price ID for team tier
    TEAM_TIER_COST_LIMIT:                  z.number().optional(),                  // Cost limit for team tier users
    TEAM_STORAGE_LIMIT_GB:                 z.number().optional().default(500),     // Storage limit in GB for team tier organizations (pooled)
    STRIPE_ENTERPRISE_PRICE_ID:            z.string().min(1).optional(),           // Stripe price ID for enterprise tier
    ENTERPRISE_TIER_COST_LIMIT:            z.number().optional(),                  // Cost limit for enterprise tier users
    ENTERPRISE_STORAGE_LIMIT_GB:           z.number().optional().default(500),     // Default storage limit in GB for enterprise tier (can be overridden per org)
    BILLING_CONCURRENCY_LIMIT_FREE:         z.string().optional(),                  // In-flight executions per free billing account
    BILLING_CONCURRENCY_LIMIT_PRO:          z.string().optional(),                  // In-flight executions per Pro-tier billing account (Pro and Pro for Teams)
    BILLING_CONCURRENCY_LIMIT_TEAM:         z.string().optional(),                  // In-flight executions per Max-tier billing account (Max and Max for Teams)
    BILLING_CONCURRENCY_LIMIT_ENTERPRISE:   z.string().optional(),                  // In-flight executions per Enterprise billing account (metadata-overridable)
    BILLING_ENABLED:                       z.boolean().optional(),                 // Enable billing enforcement and usage tracking
    TABLE_SNAPSHOT_CACHE:                  z.boolean().optional(),                 // Mount tables into sandboxes by reference via a version-keyed CSV snapshot in object storage instead of draining the whole table into web-process heap
    PII_REDACTION:                         z.boolean().optional(),                 // Redact PII from workflow logs via configurable Data Retention rules (Presidio at the logger persist choke point) and expose the Data Retention config UI
    PII_GRANULAR_REDACTION:                z.boolean().optional(),                 // Expose the execution-altering PII redaction stages (redact workflow input + block outputs in-flight) in the Data Retention config; layered on top of PII_REDACTION
    TRIGGER_EU_REGION:                     z.boolean().optional(),                 // Route Trigger.dev runs to eu-central-1 instead of the default us-east-1 (fallback for the trigger-eu-region flag when AppConfig is not the source of truth)

    // Table feature limits (per plan). Apply when billing is disabled (free tier defaults) or for billed plans.
    FREE_TABLES_LIMIT:                     z.number().optional(),                  // Max user tables per workspace on free tier (default: 5)
    FREE_TABLE_ROWS_LIMIT:                 z.number().optional(),                  // Max rows per table on free tier (default: 50000)
    PRO_TABLES_LIMIT:                      z.number().optional(),                  // Max user tables per workspace on pro tier (default: 100)
    PRO_TABLE_ROWS_LIMIT:                  z.number().optional(),                  // Max rows per table on pro tier (default: 100000)
    TEAM_TABLES_LIMIT:                     z.number().optional(),                  // Max user tables per workspace on team tier (default: 1000)
    TEAM_TABLE_ROWS_LIMIT:                 z.number().optional(),                  // Max rows per table on team tier (default: 500000)
    ENTERPRISE_TABLES_LIMIT:               z.number().optional(),                  // Max user tables per workspace on enterprise tier (default: 10000)
    ENTERPRISE_TABLE_ROWS_LIMIT:           z.number().optional(),                  // Max rows per table on enterprise tier (default: 1000000)
    TABLE_MAX_ROW_SIZE_BYTES:              z.number().optional(),                  // Max serialized size in bytes of a single user-table row (default: 409600)
    TABLE_MAX_PAGE_BYTES:                  z.number().optional(),                  // Dev-preview: byte budget per row-page read; pages cut early past it (unset = disabled)
    TABLE_DISPATCH_CONCURRENCY_FREE:       z.number().optional(),                  // Rows one table run executes in parallel on free tier (default: 20)
    TABLE_DISPATCH_CONCURRENCY_PAID:       z.number().optional(),                  // Rows one table run executes in parallel on paid tiers (default: 50)

    // Credit-tier Stripe prices (monthly)
    STRIPE_PRICE_TIER_25_MO:               z.string().min(1).optional(),           // Pro: $25/mo (6,000 credits)
    STRIPE_PRICE_TIER_100_MO:              z.string().min(1).optional(),           // Max: $100/mo (25,000 credits)

    // Credit-tier Stripe prices (annual, 15% discount)
    STRIPE_PRICE_TIER_25_YR:               z.string().min(1).optional(),           // Pro: $255/yr (15% off $300)
    STRIPE_PRICE_TIER_100_YR:              z.string().min(1).optional(),           // Max: $1,020/yr (15% off $1,200)

    // Team-specific Stripe prices (separate products for Billing Portal compat)
    STRIPE_PRICE_TEAM_25_MO:               z.string().min(1).optional(),           // Team Pro: $25/seat/mo
    STRIPE_PRICE_TEAM_25_YR:               z.string().min(1).optional(),           // Team Pro: $255/seat/yr
    STRIPE_PRICE_TEAM_100_MO:              z.string().min(1).optional(),           // Team Max: $100/seat/mo
    STRIPE_PRICE_TEAM_100_YR:              z.string().min(1).optional(),           // Team Max: $1,020/seat/yr
    OVERAGE_THRESHOLD_DOLLARS:             z.number().optional().default(100),     // Dollar threshold for incremental overage billing (default: $100)

    // Email & Communication
    EMAIL_VERIFICATION_ENABLED:            z.boolean().optional(),                 // Enable email verification for user registration and login (defaults to false)
    RESEND_API_KEY:                        z.string().min(1).optional(),           // Resend API key for transactional emails
    FROM_EMAIL_ADDRESS:                    z.string().min(1).optional(),           // Complete from address (e.g., "Sim <noreply@domain.com>" or "noreply@domain.com")
    PERSONAL_EMAIL_FROM:                   z.string().min(1).optional(),           // From address for personalized emails
    EMAIL_DOMAIN:                          z.string().min(1).optional(),           // Domain for sending emails (fallback when FROM_EMAIL_ADDRESS not set)
    AZURE_ACS_CONNECTION_STRING:           z.string().optional(),                  // Azure Communication Services connection string
    AWS_SES_REGION:                        z.string().min(1).optional(),           // AWS region for SES (credentials resolved via default SDK provider chain)
    SMTP_HOST:                             z.string().min(1).optional(),           // SMTP server hostname
    SMTP_PORT:                             z.coerce.number().int().min(1).max(65535).optional(),
    SMTP_USER:                             z.string().min(1).optional(),           // SMTP username
    SMTP_PASS:                             z.string().min(1).optional(),           // SMTP password
    SMTP_SECURE:                           z.boolean().optional(),                 // Force TLS on connect (defaults to true on port 465); read via envBoolean to handle string values from process.env

    // SMS & Messaging
    TWILIO_ACCOUNT_SID:                    z.string().min(1).optional(),           // Twilio Account SID for SMS sending
    TWILIO_AUTH_TOKEN:                     z.string().min(1).optional(),           // Twilio Auth Token for API authentication
    TWILIO_PHONE_NUMBER:                   z.string().min(1).optional(),           // Twilio phone number for sending SMS

    // AI/LLM Provider API Keys
    OPENAI_API_KEY:                        z.string().min(1).optional(),           // Primary OpenAI API key
    OPENAI_API_KEY_1:                      z.string().min(1).optional(),           // Additional OpenAI API key for load balancing
    OPENAI_API_KEY_2:                      z.string().min(1).optional(),           // Additional OpenAI API key for load balancing
    OPENAI_API_KEY_3:                      z.string().min(1).optional(),           // Additional OpenAI API key for load balancing
    MISTRAL_API_KEY:                       z.string().min(1).optional(),           // Mistral AI API key
    ANTHROPIC_API_KEY_1:                   z.string().min(1).optional(),           // Primary Anthropic Claude API key
    ANTHROPIC_API_KEY_2:                   z.string().min(1).optional(),           // Additional Anthropic API key for load balancing
    ANTHROPIC_API_KEY_3:                   z.string().min(1).optional(),           // Additional Anthropic API key for load balancing
    GEMINI_API_KEY:                        z.string().min(1).optional(),           // Singular Gemini API key (used as fallback when rotation keys are unset)
    GEMINI_API_KEY_1:                      z.string().min(1).optional(),           // Primary Gemini API key
    GEMINI_API_KEY_2:                      z.string().min(1).optional(),           // Additional Gemini API key for load balancing
    GEMINI_API_KEY_3:                      z.string().min(1).optional(),           // Additional Gemini API key for load balancing
    ZAI_API_KEY_1:                         z.string().min(1).optional(),           // Primary Z.ai API key for load balancing
    ZAI_API_KEY_2:                         z.string().min(1).optional(),           // Additional Z.ai API key for load balancing
    ZAI_API_KEY_3:                         z.string().min(1).optional(),           // Additional Z.ai API key for load balancing
    KIMI_API_KEY_1:                        z.string().min(1).optional(),           // Primary Kimi (Moonshot AI) API key for load balancing
    KIMI_API_KEY_2:                        z.string().min(1).optional(),           // Additional Kimi API key for load balancing
    KIMI_API_KEY_3:                        z.string().min(1).optional(),           // Additional Kimi API key for load balancing
    XAI_API_KEY_1:                         z.string().min(1).optional(),           // Primary xAI API key for load balancing
    XAI_API_KEY_2:                         z.string().min(1).optional(),           // Additional xAI API key for load balancing
    XAI_API_KEY_3:                         z.string().min(1).optional(),           // Additional xAI API key for load balancing
    OLLAMA_URL:                            z.string().url().optional(),            // Ollama local LLM server URL
    VLLM_BASE_URL:                         z.string().url().optional(),            // vLLM self-hosted base URL (OpenAI-compatible)
    VLLM_API_KEY:                          z.string().optional(),                  // Optional bearer token for vLLM
    LITELLM_BASE_URL:                      z.string().url().optional(),            // LiteLLM proxy base URL (OpenAI-compatible)
    LITELLM_API_KEY:                       z.string().optional(),                  // Optional bearer token for LiteLLM
    FIREWORKS_API_KEY:                     z.string().optional(),                  // Optional Fireworks AI API key for model listing
    TOGETHER_API_KEY:                      z.string().optional(),                  // Optional Together AI API key for model listing and inference
    BASETEN_API_KEY:                       z.string().optional(),                  // Optional Baseten API key for model listing and inference
    COHERE_API_KEY:                        z.string().min(1).optional(),           // Cohere API key for reranker (rerank-v4.0-pro, rerank-v4.0-fast, rerank-v3.5)
    COHERE_API_KEY_1:                      z.string().min(1).optional(),           // Primary Cohere API key for rotation
    COHERE_API_KEY_2:                      z.string().min(1).optional(),           // Additional Cohere API key for load balancing
    COHERE_API_KEY_3:                      z.string().min(1).optional(),           // Additional Cohere API key for load balancing
    ELEVENLABS_API_KEY:                    z.string().min(1).optional(),           // ElevenLabs API key for text-to-speech in deployed chat
    SERPER_API_KEY:                        z.string().min(1).optional(),           // Serper API key for online search
    EXA_API_KEY:                           z.string().min(1).optional(),           // Exa AI API key for enhanced online search
    BLACKLISTED_PROVIDERS:                 z.string().optional(),                  // Comma-separated provider IDs to hide (e.g., "openai,anthropic")
    BLACKLISTED_MODELS:                    z.string().optional(),                  // Comma-separated model names/prefixes to hide (e.g., "gpt-4,claude-*")
    ALLOWED_MCP_DOMAINS:                   z.string().optional(),                  // Comma-separated domains for MCP servers (e.g., "internal.company.com,mcp.example.org"). Empty = all allowed.
    ALLOWED_INTEGRATIONS:                  z.string().optional(),                  // Comma-separated block types to allow (e.g., "slack,github,agent"). Empty = all allowed.
    PREVIEW_BLOCKS:                        z.string().optional(),                  // Comma-separated preview block types to reveal off-AppConfig (e.g., "gmail_v2,notion_v3"). Empty = all preview blocks hidden.

    // Azure Configuration - Shared credentials with feature-specific models
    AZURE_OPENAI_ENDPOINT:                 z.string().url().optional(),            // Shared Azure OpenAI service endpoint
    AZURE_OPENAI_API_VERSION:              z.string().optional(),                  // Shared Azure OpenAI API version
    AZURE_OPENAI_API_KEY:                  z.string().min(1).optional(),           // Shared Azure OpenAI API key
    AZURE_ANTHROPIC_ENDPOINT:              z.string().url().optional(),            // Azure Anthropic service endpoint
    AZURE_ANTHROPIC_API_KEY:               z.string().min(1).optional(),           // Azure Anthropic API key
    AZURE_ANTHROPIC_API_VERSION:           z.string().min(1).optional(),           // Azure Anthropic API version (e.g. 2023-06-01)
    KB_OPENAI_MODEL_NAME:                  z.string().optional(),                  // Azure deployment name serving the configured KB embedding model (used only when AZURE_OPENAI_* credentials are set).
    KB_EMBEDDING_MODEL:                    z.string().optional(),                  // Embedding model used for all new knowledge bases. Must be one of the supported model ids; defaults to text-embedding-3-small.
    WAND_OPENAI_MODEL_NAME:                z.string().optional(),                  // Wand generation OpenAI model name (works with both regular OpenAI and Azure OpenAI)
    OCR_AZURE_ENDPOINT:                    z.string().url().optional(),            // Azure Mistral OCR service endpoint
    OCR_AZURE_MODEL_NAME:                  z.string().optional(),                  // Azure Mistral OCR model name for document processing
    OCR_AZURE_API_KEY:                     z.string().min(1).optional(),           // Azure Mistral OCR API key

    // Vertex AI Configuration
    VERTEX_PROJECT:                        z.string().optional(),                  // Google Cloud project ID for Vertex AI
    VERTEX_LOCATION:                       z.string().optional(),                  // Google Cloud location/region for Vertex AI (defaults to us-central1)

    // Monitoring & Analytics
    TELEMETRY_ENDPOINT:                    z.string().url().optional(),            // Custom telemetry/analytics endpoint
    COST_MULTIPLIER:                       z.number().optional(),                  // Multiplier for cost calculations
    LOG_LEVEL:                             z.enum(['DEBUG', 'INFO', 'WARN', 'ERROR']).optional(), // Minimum log level to display (defaults to ERROR in production, DEBUG in development)
    PROFOUND_API_KEY:                      z.string().min(1).optional(),           // Profound analytics API key
    PROFOUND_ENDPOINT:                     z.string().url().optional(),            // Profound analytics endpoint
    GRAFANA_OTLP_ENDPOINT:                 z.string().url().optional(),            // Grafana Cloud OTLP HTTP gateway base URL (e.g., https://otlp-gateway-prod-us-east-0.grafana.net/otlp). Trigger.dev exporters append /v1/traces, /v1/logs, /v1/metrics.
    GRAFANA_OTLP_HEADERS:                  z.string().min(1).optional(),           // Comma-separated key=value headers for OTLP requests (e.g., "Authorization=Basic <base64(instanceId:token)>"). Same format as the OTEL_EXPORTER_OTLP_HEADERS spec.
    GRAFANA_DEPLOYMENT_ENVIRONMENT:        z.string().min(1).optional(),           // Deployment tier label (e.g., "production", "staging", "development"). Emitted as the stable `deployment.environment.name` resource attribute on Trigger.dev telemetry to match the rest of the Sim OTEL stack.

    // External Services
    BROWSERBASE_API_KEY:                   z.string().min(1).optional(),           // Browserbase API key for browser automation
    BROWSERBASE_PROJECT_ID:                z.string().min(1).optional(),           // Browserbase project ID
    GITHUB_TOKEN:                          z.string().optional(),                  // GitHub personal access token for API access

    // Admin API
    ADMIN_API_KEY:                         z.string().min(32).optional(),          // Admin API key for self-hosted GitOps access (generate with: openssl rand -hex 32)

    // Mothership Admin
    MOTHERSHIP_API_ADMIN_KEY:              z.string().min(1).optional(),           // Admin API key for mothership/copilot admin endpoints
    MOTHERSHIP_DEV_URL:                    z.string().url().optional(),            // Mothership dev environment URL
    MOTHERSHIP_STAGING_URL:                z.string().url().optional(),            // Mothership staging environment URL
    MOTHERSHIP_PROD_URL:                   z.string().url().optional(),            // Mothership production environment URL

    // Infrastructure & Deployment
    NEXT_RUNTIME:                          z.string().optional(),                  // Next.js runtime environment
    DOCKER_BUILD:                          z.boolean().optional(),                 // Flag indicating Docker build environment

    // Background Jobs & Scheduling
    TRIGGER_PROJECT_ID:                    z.string().optional(),                  // Trigger.dev project ID
    TRIGGER_SECRET_KEY:                    z.string().min(1).optional(),           // Trigger.dev secret key for background jobs
    TRIGGER_DEV_ENABLED:                   z.boolean().optional(),                 // Toggle to enable/disable Trigger.dev for async jobs
    CRON_SECRET:                           z.string().optional(),                  // Secret for authenticating cron job requests
    JOB_RETENTION_DAYS:                    z.string().optional().default('1'),     // Days to retain job logs/data
    SCHEDULE_EXECUTION_CONCURRENCY_LIMIT:  z.string().optional().default('30'),
    WORKFLOW_EXECUTION_CONCURRENCY_LIMIT:  z.string().optional().default('75'),
    WEBHOOK_EXECUTION_CONCURRENCY_LIMIT:   z.string().optional().default('75'),
    RESUME_EXECUTION_CONCURRENCY_LIMIT:    z.string().optional().default('50'),
    SCHEDULE_ENQUEUE_BUDGET_MULTIPLIER:    z.string().optional().default('2'),
    SCHEDULE_JITTER_MAX_MS:                z.string().optional().default('30000'),
    SCHEDULE_INFRA_RETRY_BASE_MS:          z.string().optional().default('60000'),
    SCHEDULE_INFRA_RETRY_MAX_MS:           z.string().optional().default('300000'),
    SCHEDULE_INFRA_RETRY_MAX_ATTEMPTS:     z.string().optional().default('10'),

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
    S3_PROFILE_PICTURES_BUCKET_NAME:       z.string().optional(),                  // S3 bucket for profile pictures
    S3_OG_IMAGES_BUCKET_NAME:              z.string().optional(),                  // S3 bucket for OpenGraph images
    S3_WORKSPACE_LOGOS_BUCKET_NAME:        z.string().optional(),                  // S3 bucket for workspace logos
    S3_ENDPOINT:                           z.string().optional(),                  // Custom endpoint for S3-compatible storage (Cloudflare R2, MinIO, Backblaze B2). Leave unset for AWS S3
    S3_FORCE_PATH_STYLE:                   z.string().optional(),                  // Force path-style addressing (MinIO/Ceph RGW). Defaults to false (AWS S3, R2). Coerced via envBoolean at the consumption site

    // Dynamic config - AWS AppConfig (hosted source of truth for signup/login gating lists; unset => env-var fallback)
    APPCONFIG_APPLICATION:                 z.string().optional(),                  // AppConfig application id/name. On hosted deployments, when set with APPCONFIG_ENVIRONMENT, gating lists come from AppConfig instead of env vars
    APPCONFIG_ENVIRONMENT:                 z.string().optional(),                  // AppConfig environment id/name. Profile name is an app-side constant ('access-control'), not an env var

    // Cloud Storage - Azure Blob
    AZURE_ACCOUNT_NAME:                    z.string().optional(),                  // Azure storage account name
    AZURE_ACCOUNT_KEY:                     z.string().optional(),                  // Azure storage account key
    AZURE_CONNECTION_STRING:               z.string().optional(),                  // Azure storage connection string
    AZURE_STORAGE_CONTAINER_NAME:          z.string().optional(),                  // Azure container for general files
    AZURE_STORAGE_KB_CONTAINER_NAME:       z.string().optional(),                  // Azure container for knowledge base files
    AZURE_STORAGE_EXECUTION_FILES_CONTAINER_NAME: z.string().optional(),          // Azure container for workflow execution files
    AZURE_STORAGE_CHAT_CONTAINER_NAME:     z.string().optional(),                  // Azure container for chat logos
    AZURE_STORAGE_COPILOT_CONTAINER_NAME:  z.string().optional(),                  // Azure container for copilot files
    AZURE_STORAGE_PROFILE_PICTURES_CONTAINER_NAME: z.string().optional(),          // Azure container for profile pictures
    AZURE_STORAGE_OG_IMAGES_CONTAINER_NAME: z.string().optional(),                 // Azure container for OpenGraph images
    AZURE_STORAGE_WORKSPACE_LOGOS_CONTAINER_NAME: z.string().optional(),            // Azure container for workspace logos


    // Admission & Burst Protection
    ADMISSION_GATE_MAX_INFLIGHT:           z.string().optional().default('500'),   // Max concurrent in-flight execution requests per pod
    API_MAX_JSON_BODY_BYTES:               z.string().optional().default('52428800'),// Default max JSON request body size for contract routes (50 MB)
    CHAT_MAX_REQUEST_BYTES:                z.string().optional().default('230686720'),// Max request body size for the public deployed-chat endpoint (220 MB; covers 15 base64 file attachments)
    WEBHOOK_MAX_REQUEST_BYTES:             z.string().optional().default('10485760'),// Max request body size for public webhook receiver endpoints (10 MB; provider payloads rarely exceed a few MB)

    // Rate Limiting Configuration
    RATE_LIMIT_WINDOW_MS:                  z.string().optional().default('60000'), // Rate limit window duration in milliseconds (default: 1 minute)
    MANUAL_EXECUTION_LIMIT:                z.string().optional().default('999999'),// Manual execution bypass value (effectively unlimited)
    RATE_LIMIT_FREE_SYNC:                  z.string().optional(),                  // Free tier sync API executions per minute (default 50). With billing disabled, setting it explicitly opts into rate limiting
    RATE_LIMIT_FREE_ASYNC:                 z.string().optional(),                  // Free tier async API executions per minute (default 200). With billing disabled, setting it explicitly opts into rate limiting
    RATE_LIMIT_FREE_API_ENDPOINT:          z.string().optional(),                  // Free tier v1 API endpoint requests per minute (default 30). With billing disabled, setting it explicitly opts into rate limiting
    RATE_LIMIT_PRO_SYNC:                   z.string().optional().default('150'),   // Pro tier sync API executions per minute
    RATE_LIMIT_PRO_ASYNC:                  z.string().optional().default('1000'),  // Pro tier async API executions per minute
    RATE_LIMIT_TEAM_SYNC:                  z.string().optional().default('300'),   // Team tier sync API executions per minute
    RATE_LIMIT_TEAM_ASYNC:                 z.string().optional().default('2500'),  // Team tier async API executions per minute
    RATE_LIMIT_ENTERPRISE_SYNC:            z.string().optional().default('600'),   // Enterprise tier sync API executions per minute
    RATE_LIMIT_ENTERPRISE_ASYNC:           z.string().optional().default('5000'),  // Enterprise tier async API executions per minute
    // Timeout Configuration
    EXECUTION_TIMEOUT_FREE:                z.string().optional(),                  // Free tier sync timeout in seconds (default 300). With billing disabled, setting it explicitly opts into sync timeouts
    EXECUTION_TIMEOUT_PRO:                 z.string().optional().default('3000'),  // 50 minutes
    EXECUTION_TIMEOUT_TEAM:                z.string().optional().default('3000'),  // 50 minutes
    EXECUTION_TIMEOUT_ENTERPRISE:          z.string().optional().default('3000'),  // 50 minutes
    EXECUTION_TIMEOUT_ASYNC_FREE:          z.string().optional(),                  // Free tier async timeout in seconds (default 5400). With billing disabled, setting it explicitly opts into async timeouts
    EXECUTION_TIMEOUT_ASYNC_PRO:           z.string().optional().default('5400'),  // 90 minutes
    EXECUTION_TIMEOUT_ASYNC_TEAM:          z.string().optional().default('5400'),  // 90 minutes
    EXECUTION_TIMEOUT_ASYNC_ENTERPRISE:    z.string().optional().default('5400'),  // 90 minutes

    // Isolated-VM Worker Pool Configuration
    IVM_POOL_SIZE:                         z.string().optional().default('4'),      // Max worker processes in pool
    IVM_MAX_CONCURRENT:                    z.string().optional().default('10000'),  // Max concurrent executions globally
    IVM_MAX_PER_WORKER:                    z.string().optional().default('2500'),   // Max concurrent executions per worker
    IVM_WORKER_IDLE_TIMEOUT_MS:            z.string().optional().default('60000'),  // Worker idle cleanup timeout (ms)
    IVM_MAX_QUEUE_SIZE:                    z.string().optional().default('10000'),  // Max pending queued executions in memory
    IVM_MAX_FETCH_RESPONSE_BYTES:          z.string().optional().default('8388608'),// Max bytes read from sandbox fetch responses
    IVM_MAX_FETCH_RESPONSE_CHARS:          z.string().optional().default('4000000'),// Max chars returned to sandbox from fetch body
    IVM_MAX_FETCH_OPTIONS_JSON_CHARS:      z.string().optional().default('262144'), // Max JSON payload size for sandbox fetch options
    IVM_MAX_FETCH_URL_LENGTH:              z.string().optional().default('8192'),   // Max URL length accepted by sandbox fetch
    IVM_MAX_STDOUT_CHARS:                  z.string().optional().default('200000'), // Max captured stdout characters per execution
    IVM_MAX_ACTIVE_PER_OWNER:              z.string().optional().default('200'),    // Max active executions per owner (per process)
    IVM_MAX_QUEUED_PER_OWNER:              z.string().optional().default('2000'),   // Max queued executions per owner (per process)
    IVM_MAX_OWNER_WEIGHT:                  z.string().optional().default('5'),      // Max accepted weight for weighted owner scheduling
    IVM_DISTRIBUTED_MAX_INFLIGHT_PER_OWNER:z.string().optional().default('2200'),   // Max owner in-flight leases across replicas
    IVM_DISTRIBUTED_LEASE_MIN_TTL_MS:      z.string().optional().default('120000'), // Min TTL for distributed in-flight leases (ms)
    IVM_QUEUE_TIMEOUT_MS:                  z.string().optional().default('300000'), // Max queue wait before rejection (ms)
    IVM_MAX_EXECUTIONS_PER_WORKER:         z.string().optional().default('200'),    // Max lifetime executions before worker is recycled
    IVM_MAX_BROKER_ARGS_JSON_CHARS:        z.string().optional().default('262144'),  // Max JSON payload size for sandbox task broker args (isolate→host)
    IVM_MAX_BROKER_RESULT_JSON_CHARS:      z.string().optional().default('16777216'),// Max JSON payload size for sandbox task broker results (host→isolate)
    IVM_MAX_BROKERS_PER_EXECUTION:         z.string().optional().default('1000'),    // Max broker calls per sandbox task execution

    // Knowledge Base Processing Configuration - Shared across all processing methods
    KB_CONFIG_MAX_DURATION:                z.number().optional().default(600),     // Max processing duration in seconds (10 minutes)
    KB_CONFIG_MAX_ATTEMPTS:                z.number().optional().default(3),       // Max retry attempts
    KB_CONFIG_RETRY_FACTOR:                z.number().optional().default(2),       // Retry backoff factor
    KB_CONFIG_MIN_TIMEOUT:                 z.number().optional().default(1000),    // Min timeout in ms
    KB_CONFIG_MAX_TIMEOUT:                 z.number().optional().default(10000),   // Max timeout in ms
    KB_CONFIG_CONCURRENCY_LIMIT:           z.number().optional().default(50),      // Concurrent embedding API calls
    KB_CONFIG_BATCH_SIZE:                  z.number().optional().default(2000),    // Chunks to process per embedding batch
    KB_CONFIG_DELAY_BETWEEN_BATCHES:       z.number().optional().default(0),       // Delay between batches in ms (0 for max speed)
    KB_CONFIG_DELAY_BETWEEN_DOCUMENTS:     z.number().optional().default(50),      // Delay between documents in ms
    KB_CONFIG_CHUNK_CONCURRENCY:           z.number().optional().default(10),      // Concurrent PDF chunk OCR processing

    // Real-time Communication
    SOCKET_SERVER_URL:                     z.string().url().optional(),            // WebSocket server URL for real-time features
    PORT:                                  z.number().optional(),                  // Main application port
    INTERNAL_API_BASE_URL:                 z.string().optional(),                  // Optional internal base URL for server-side self-calls; must include protocol if set (e.g., http://sim-app.namespace.svc.cluster.local:3000)
    ALLOWED_ORIGINS:                       z.string().optional(),                  // CORS allowed origins
    PII_URL:                               z.string().optional(),                  // Presidio PII service base URL serving /analyze + /anonymize (standalone ECS service; default http://localhost:5001 for local dev)
    PII_MASK_CHUNK_CONCURRENCY:            z.coerce.number().int().positive().optional(), // Max in-flight mask-batch requests per redaction (default 64); tune to the Presidio fleet size behind the internal ALB, lower to 1 for a single instance
    PII_REF_CONCURRENCY:                   z.coerce.number().int().positive().optional(), // Max large-value refs hydrated+masked+re-stored in parallel per payload (default 4); multiplies with PII_MASK_CHUNK_CONCURRENCY for total in-flight Presidio load
    PII_SERVICE_CHUNK_CONCURRENCY:         z.coerce.number().int().positive().optional(), // Max Presidio requests in flight from a single mask-batch call (route -> Presidio fan-out, default 4); inner to PII_MASK_CHUNK_CONCURRENCY

    // OAuth Integration Credentials - All optional, enables third-party integrations
    GOOGLE_CLIENT_ID:                      z.string().optional(),                  // Google OAuth client ID for Google services
    GOOGLE_CLIENT_SECRET:                  z.string().optional(),                  // Google OAuth client secret
    GITHUB_CLIENT_ID:                      z.string().optional(),                  // GitHub OAuth client ID for GitHub integration
    GITHUB_CLIENT_SECRET:                  z.string().optional(),                  // GitHub OAuth client secret
    DISABLE_GOOGLE_AUTH:                   z.boolean().optional(),                 // Disable Google OAuth login even when credentials are configured
    DISABLE_GITHUB_AUTH:                   z.boolean().optional(),                 // Disable GitHub OAuth login even when credentials are configured
    DISABLE_MICROSOFT_AUTH:               z.boolean().optional(),                 // Disable Microsoft OAuth login even when credentials are configured
    DISABLE_EMAIL_SIGNUP:                  z.boolean().optional(),                 // Block new email/password registrations while keeping email login working

    X_CLIENT_ID:                           z.string().optional(),                  // X (Twitter) OAuth client ID
    X_CLIENT_SECRET:                       z.string().optional(),                  // X (Twitter) OAuth client secret
    TIKTOK_CLIENT_ID:                      z.string().optional(),                  // TikTok OAuth client key (TikTok calls this "client_key")
    TIKTOK_CLIENT_SECRET:                  z.string().optional(),                  // TikTok OAuth client secret
    CONFLUENCE_CLIENT_ID:                  z.string().optional(),                  // Atlassian Confluence OAuth client ID
    CONFLUENCE_CLIENT_SECRET:              z.string().optional(),                  // Atlassian Confluence OAuth client secret
    JIRA_CLIENT_ID:                        z.string().optional(),                  // Atlassian Jira OAuth client ID
    JIRA_CLIENT_SECRET:                    z.string().optional(),                  // Atlassian Jira OAuth client secret
    ASANA_CLIENT_ID:                       z.string().optional(),                  // Asana OAuth client ID
    ASANA_CLIENT_SECRET:                   z.string().optional(),                  // Asana OAuth client secret
    AIRTABLE_CLIENT_ID:                    z.string().optional(),                  // Airtable OAuth client ID
    AIRTABLE_CLIENT_SECRET:                z.string().optional(),                  // Airtable OAuth client secret
    APOLLO_API_KEY:                        z.string().optional(),                  // Apollo API key (optional system-wide config)
    SUPABASE_CLIENT_ID:                    z.string().optional(),                  // Supabase OAuth client ID
    SUPABASE_CLIENT_SECRET:                z.string().optional(),                  // Supabase OAuth client secret
    NOTION_CLIENT_ID:                      z.string().optional(),                  // Notion OAuth client ID
    NOTION_CLIENT_SECRET:                  z.string().optional(),                  // Notion OAuth client secret
    MONDAY_CLIENT_ID:                      z.string().optional(),                  // Monday.com OAuth client ID
    MONDAY_CLIENT_SECRET:                  z.string().optional(),                  // Monday.com OAuth client secret
    DISCORD_CLIENT_ID:                     z.string().optional(),                  // Discord OAuth client ID
    DISCORD_CLIENT_SECRET:                 z.string().optional(),                  // Discord OAuth client secret
    DOCUSIGN_CLIENT_ID:                    z.string().optional(),                  // DocuSign OAuth client ID
    DOCUSIGN_CLIENT_SECRET:                z.string().optional(),                  // DocuSign OAuth client secret
    MICROSOFT_CLIENT_ID:                   z.string().optional(),                  // Microsoft OAuth client ID for Office 365/Teams
    MICROSOFT_CLIENT_SECRET:               z.string().optional(),                  // Microsoft OAuth client secret
    HUBSPOT_CLIENT_ID:                     z.string().optional(),                  // HubSpot OAuth client ID
    HUBSPOT_CLIENT_SECRET:                 z.string().optional(),                  // HubSpot OAuth client secret
    SALESFORCE_CLIENT_ID:                  z.string().optional(),                  // Salesforce OAuth client ID
    SALESFORCE_CLIENT_SECRET:              z.string().optional(),                  // Salesforce OAuth client secret
    WEALTHBOX_CLIENT_ID:                   z.string().optional(),                  // WealthBox OAuth client ID
    WEALTHBOX_CLIENT_SECRET:               z.string().optional(),                  // WealthBox OAuth client secret
    PIPEDRIVE_CLIENT_ID:                   z.string().optional(),                  // Pipedrive OAuth client ID
    PIPEDRIVE_CLIENT_SECRET:               z.string().optional(),                  // Pipedrive OAuth client secret
    LINEAR_CLIENT_ID:                      z.string().optional(),                  // Linear OAuth client ID
    LINEAR_CLIENT_SECRET:                  z.string().optional(),                  // Linear OAuth client secret
    CLICKUP_CLIENT_ID:                     z.string().optional(),                  // ClickUp OAuth client ID
    CLICKUP_CLIENT_SECRET:                 z.string().optional(),                  // ClickUp OAuth client secret
    BOX_CLIENT_ID:                         z.string().optional(),                  // Box OAuth client ID
    BOX_CLIENT_SECRET:                     z.string().optional(),                  // Box OAuth client secret
    DROPBOX_CLIENT_ID:                     z.string().optional(),                  // Dropbox OAuth client ID
    DROPBOX_CLIENT_SECRET:                 z.string().optional(),                  // Dropbox OAuth client secret
    SLACK_CLIENT_ID:                       z.string().optional(),                  // Slack OAuth client ID
    SLACK_CLIENT_SECRET:                   z.string().optional(),                  // Slack OAuth client secret
    SLACK_SIGNING_SECRET:                  z.string().optional(),                  // Official Sim Slack app signing secret (verifies inbound events for the native OAuth trigger)
    REDDIT_CLIENT_ID:                      z.string().optional(),                  // Reddit OAuth client ID
    REDDIT_CLIENT_SECRET:                  z.string().optional(),                  // Reddit OAuth client secret
    WEBFLOW_CLIENT_ID:                     z.string().optional(),                  // Webflow OAuth client ID
    WEBFLOW_CLIENT_SECRET:                 z.string().optional(),                  // Webflow OAuth client secret
    TRELLO_API_KEY:                        z.string().optional(),                  // Trello API Key
    LINKEDIN_CLIENT_ID:                    z.string().optional(),                  // LinkedIn OAuth client ID
    LINKEDIN_CLIENT_SECRET:                z.string().optional(),                  // LinkedIn OAuth client secret
    INSTAGRAM_CLIENT_ID:                   z.string().optional(),                  // Instagram App ID (Business Login)
    INSTAGRAM_CLIENT_SECRET:               z.string().optional(),                  // Instagram App Secret (Business Login)
    SHOPIFY_CLIENT_ID:                     z.string().optional(),                  // Shopify OAuth client ID
    SHOPIFY_CLIENT_SECRET:                 z.string().optional(),                  // Shopify OAuth client secret
    ZOOM_CLIENT_ID:                        z.string().optional(),                  // Zoom OAuth client ID
    ZOOM_CLIENT_SECRET:                    z.string().optional(),                  // Zoom OAuth client secret
    WORDPRESS_CLIENT_ID:                   z.string().optional(),                  // WordPress.com OAuth client ID
    WORDPRESS_CLIENT_SECRET:               z.string().optional(),                  // WordPress.com OAuth client secret
    SPOTIFY_CLIENT_ID:                     z.string().optional(),                  // Spotify OAuth client ID
    SPOTIFY_CLIENT_SECRET:                 z.string().optional(),                  // Spotify OAuth client secret
    CALCOM_CLIENT_ID:                      z.string().optional(),                  // Cal.com OAuth client ID
    ATTIO_CLIENT_ID:                       z.string().optional(),                  // Attio OAuth client ID
    ATTIO_CLIENT_SECRET:                   z.string().optional(),                  // Attio OAuth client secret

    // AgentMail - Mothership Email Inbox
    AGENTMAIL_API_KEY:                     z.string().min(1).optional(),           // AgentMail API key for mothership email inbox
    AGENTMAIL_DOMAIN:                      z.string().optional(),                  // Custom domain for AgentMail inboxes (default: agentmail.to)
    INBOX_ENABLED:                         z.boolean().optional(),                 // Enable inbox (Sim Mailer) on self-hosted (bypasses hosted requirements)

    // E2B Remote Code Execution
    E2B_ENABLED:                           z.string().optional(),                  // Enable E2B remote code execution
    E2B_API_KEY:                           z.string().optional(),                  // E2B API key for sandbox creation
    MOTHERSHIP_E2B_TEMPLATE_ID:             z.string().optional(),                  // Custom E2B template with pre-installed CLI tools for shell execution
    MOTHERSHIP_E2B_DOC_TEMPLATE_ID:         z.string().optional(),                  // Dedicated E2B template with python-pptx/docx/openpyxl/reportlab for document generation; when set (and E2B enabled), docs compile via Python instead of the JS isolated-vm path
    E2B_PI_TEMPLATE_ID:                     z.string().optional(),                  // E2B template ID/alias with the Pi CLI + git baked in (Pi Coding Agent cloud mode)

    // Access Control (Permission Groups) - for self-hosted deployments
    ACCESS_CONTROL_ENABLED:                z.boolean().optional(),                 // Enable access control on self-hosted (bypasses plan requirements)

    // Enterprise Feature Overrides - for self-hosted deployments
    WHITELABELING_ENABLED:                 z.boolean().optional(),                 // Enable whitelabeling on self-hosted (bypasses hosted requirements)
    AUDIT_LOGS_ENABLED:                    z.boolean().optional(),                 // Enable audit logs on self-hosted (bypasses hosted requirements)
    DATA_RETENTION_ENABLED:               z.boolean().optional(),                 // Enable data retention settings on self-hosted (bypasses hosted requirements)
    DATA_DRAINS_ENABLED:                  z.boolean().optional(),                 // Enable data drains on self-hosted (bypasses hosted requirements)
    FORKING_ENABLED:                      z.boolean().optional(),                 // Enable workspace forking on self-hosted (bypasses hosted requirements)
    DEPLOY_AS_BLOCK:                      z.boolean().optional(),                 // Enable deploy-as-block (publish a workflow as a reusable org-wide custom block)

    // Organizations - for self-hosted deployments
    ORGANIZATIONS_ENABLED:                 z.boolean().optional(),                 // Enable organizations on self-hosted (bypasses plan requirements)

    // Invitations - for self-hosted deployments
    DISABLE_INVITATIONS:                   z.boolean().optional(),                 // Disable workspace invitations globally (for self-hosted deployments)
    DISABLE_PUBLIC_API:                    z.boolean().optional(),                 // Disable public API access globally (for self-hosted deployments)
    MOTHERSHIP_BETA_FEATURES:              z.boolean().optional(),                 // Enable beta Mothership planning/changelog artifact surfaces

    // Development Tools
    REACT_GRAB_ENABLED:                    z.boolean().optional(),                 // Enable React Grab for UI element debugging in Cursor/AI agents (dev only)
    REACT_SCAN_ENABLED:                    z.boolean().optional(),                 // Enable React Scan for performance debugging (dev only)

    // SSO Configuration (for script-based registration)
    SSO_ENABLED:                           z.boolean().optional(),                 // Enable SSO functionality
    SSO_PROVIDER_TYPE:                     z.enum(['oidc', 'saml']).optional(),    // [REQUIRED] SSO provider type
    SSO_PROVIDER_ID:                       z.string().optional(),                  // [REQUIRED] SSO provider ID
    SSO_ISSUER:                            z.string().optional(),                  // [REQUIRED] SSO issuer URL
    SSO_DOMAIN:                            z.string().optional(),                  // [REQUIRED] SSO email domain
    SSO_USER_EMAIL:                        z.string().optional(),                  // [REQUIRED] User email for SSO registration
    SSO_ORGANIZATION_ID:                   z.string().optional(),                  // Organization ID for SSO registration (optional)
    SSO_TRUSTED_PROVIDER_IDS:              z.string().optional(),                  // Comma-separated SSO provider IDs to trust for automatic account linking when an existing account shares the same email. Use for IdPs that do not assert email_verified. Merged into Better Auth accountLinking.trustedProviders.

    // SSO Mapping Configuration (optional - sensible defaults provided)
    SSO_MAPPING_ID:                        z.string().optional(),                  // Custom ID claim mapping (default: sub for OIDC, nameidentifier for SAML)
    SSO_MAPPING_EMAIL:                     z.string().optional(),                  // Custom email claim mapping (default: email for OIDC, emailaddress for SAML)
    SSO_MAPPING_NAME:                      z.string().optional(),                  // Custom name claim mapping (default: name for both)
    SSO_MAPPING_IMAGE:                     z.string().optional(),                  // Custom image claim mapping (default: picture for OIDC)

    // SSO OIDC Configuration
    SSO_OIDC_CLIENT_ID:                    z.string().optional(),                  // [REQUIRED for OIDC] OIDC client ID
    SSO_OIDC_CLIENT_SECRET:                z.string().optional(),                  // [REQUIRED for OIDC] OIDC client secret
    SSO_OIDC_SCOPES:                       z.string().optional(),                  // OIDC scopes (default: openid,profile,email)
    SSO_OIDC_PKCE:                         z.string().optional(),                  // Enable PKCE (default: true)
    SSO_OIDC_AUTHORIZATION_ENDPOINT:       z.string().optional(),                  // OIDC authorization endpoint (optional, uses discovery)
    SSO_OIDC_TOKEN_ENDPOINT:               z.string().optional(),                  // OIDC token endpoint (optional, uses discovery)
    SSO_OIDC_USERINFO_ENDPOINT:            z.string().optional(),                  // OIDC userinfo endpoint (optional, uses discovery)
    SSO_OIDC_JWKS_ENDPOINT:                z.string().optional(),                  // OIDC JWKS endpoint (optional, uses discovery)
    SSO_OIDC_DISCOVERY_ENDPOINT:           z.string().optional(),                  // OIDC discovery endpoint (default: {issuer}/.well-known/openid-configuration)

    // SSO SAML Configuration
    SSO_SAML_ENTRY_POINT:                  z.string().optional(),                  // [REQUIRED for SAML] SAML IdP SSO URL
    SSO_SAML_CERT:                         z.string().optional(),                  // [REQUIRED for SAML] SAML IdP certificate
    SSO_SAML_CALLBACK_URL:                 z.string().optional(),                  // SAML callback URL (default: {issuer}/callback)
    SSO_SAML_SP_METADATA:                  z.string().optional(),                  // SAML SP metadata XML (auto-generated if not provided)
    SSO_SAML_IDP_METADATA:                 z.string().optional(),                  // SAML IdP metadata XML (optional)
    SSO_SAML_AUDIENCE:                     z.string().optional(),                  // SAML audience restriction (default: issuer URL)
    SSO_SAML_WANT_ASSERTIONS_SIGNED:       z.string().optional(),                  // Require signed SAML assertions (default: false)
    SSO_SAML_SIGNATURE_ALGORITHM:          z.string().optional(),                  // SAML signature algorithm (optional)
    SSO_SAML_DIGEST_ALGORITHM:             z.string().optional(),                  // SAML digest algorithm (optional)
    SSO_SAML_IDENTIFIER_FORMAT:            z.string().optional(),                  // SAML identifier format (optional)
  },

  client: {
    // Core Application URLs - Required for frontend functionality
    NEXT_PUBLIC_APP_URL:                   z.string().url(),                       // Base URL of the application (e.g., https://www.sim.ai)

    // Client-side Services
    NEXT_PUBLIC_SOCKET_URL:                z.string().url().optional(),            // WebSocket server URL for real-time features
    
    // Billing
    NEXT_PUBLIC_BILLING_ENABLED:           z.boolean().optional(),                 // Enable billing enforcement and usage tracking (client-side)
    
    // Analytics & Tracking
    NEXT_PUBLIC_POSTHOG_ENABLED:           z.boolean().optional(),                 // Enable PostHog analytics (client-side)
    NEXT_PUBLIC_POSTHOG_KEY:               z.string().optional(),                  // PostHog project API key

    // UI Branding & Whitelabeling
    NEXT_PUBLIC_BRAND_NAME:                z.string().optional(),                  // Custom brand name (defaults to "Sim")
    NEXT_PUBLIC_BRAND_LOGO_URL:            z.string().url().optional(),            // Custom logo URL
    NEXT_PUBLIC_BRAND_FAVICON_URL:         z.string().url().optional(),            // Custom favicon URL
    NEXT_PUBLIC_CUSTOM_CSS_URL:            z.string().url().optional(),            // Custom CSS stylesheet URL
    NEXT_PUBLIC_SUPPORT_EMAIL:             z.string().email().optional(),          // Custom support email

    NEXT_PUBLIC_E2B_ENABLED:               z.string().optional(),
    NEXT_PUBLIC_BEDROCK_DEFAULT_CREDENTIALS: z.string().optional(),              // Hide Bedrock credential fields when deployment uses AWS default credential chain (IAM roles, instance profiles, ECS task roles, IRSA)
    NEXT_PUBLIC_AZURE_CONFIGURED:          z.string().optional(),              // Hide Azure credential fields when endpoint/key/version are pre-configured server-side
    NEXT_PUBLIC_COHERE_CONFIGURED:         z.string().optional(),              // Hide Cohere API key field on Knowledge block when COHERE_API_KEY is pre-configured server-side
    NEXT_PUBLIC_COPILOT_TRAINING_ENABLED:  z.string().optional(),
    NEXT_PUBLIC_ENABLE_PLAYGROUND:         z.string().optional(),                  // Enable component playground at /playground
    NEXT_PUBLIC_DOCUMENTATION_URL:         z.string().url().optional(),            // Custom documentation URL
    NEXT_PUBLIC_TERMS_URL:                 z.string().url().optional(),            // Custom terms of service URL
    NEXT_PUBLIC_PRIVACY_URL:               z.string().url().optional(),            // Custom privacy policy URL

    // Theme Customization
    NEXT_PUBLIC_BRAND_PRIMARY_COLOR:       z.string().regex(/^#[0-9A-Fa-f]{6}$/).optional(),     // Primary brand color (hex format, e.g., "#33c482")
    NEXT_PUBLIC_BRAND_PRIMARY_HOVER_COLOR: z.string().regex(/^#[0-9A-Fa-f]{6}$/).optional(),     // Primary brand hover state (hex format)
    NEXT_PUBLIC_BRAND_ACCENT_COLOR:        z.string().regex(/^#[0-9A-Fa-f]{6}$/).optional(),     // Accent brand color (hex format)
    NEXT_PUBLIC_BRAND_ACCENT_HOVER_COLOR:  z.string().regex(/^#[0-9A-Fa-f]{6}$/).optional(),     // Accent brand hover state (hex format)
    NEXT_PUBLIC_BRAND_BACKGROUND_COLOR:    z.string().regex(/^#[0-9A-Fa-f]{6}$/).optional(),     // Brand background color (hex format)

    // Feature Flags
    NEXT_PUBLIC_SSO_ENABLED:               z.boolean().optional(),                   // Enable SSO login UI components
    NEXT_PUBLIC_ACCESS_CONTROL_ENABLED:    z.boolean().optional(),                   // Enable access control (permission groups) on self-hosted
    NEXT_PUBLIC_CUSTOM_BLOCKS_ENABLED:     z.boolean().optional(),                   // Enable custom blocks (deploy-as-block) settings on self-hosted
    NEXT_PUBLIC_WHITELABELING_ENABLED:     z.boolean().optional(),                   // Enable whitelabeling on self-hosted (bypasses hosted requirements)
    NEXT_PUBLIC_AUDIT_LOGS_ENABLED:        z.boolean().optional(),                   // Enable audit logs on self-hosted (bypasses hosted requirements)
    NEXT_PUBLIC_DATA_RETENTION_ENABLED:   z.boolean().optional(),                   // Enable data retention settings on self-hosted (bypasses hosted requirements)
    NEXT_PUBLIC_DATA_DRAINS_ENABLED:      z.boolean().optional(),                   // Enable data drains on self-hosted (bypasses hosted requirements)
    NEXT_PUBLIC_FORKING_ENABLED:          z.boolean().optional(),                   // Enable workspace forking on self-hosted (bypasses hosted requirements)
    NEXT_PUBLIC_WORKFLOW_COLUMNS_ENABLED: z.boolean().optional(),                   // Show the "Workflow" column type in user tables (defaults to false)
    NEXT_PUBLIC_ORGANIZATIONS_ENABLED:     z.boolean().optional(),                   // Enable organizations on self-hosted (bypasses plan requirements)
    NEXT_PUBLIC_DISABLE_INVITATIONS:       z.boolean().optional(),                   // Disable workspace invitations globally (for self-hosted deployments)
    NEXT_PUBLIC_DISABLE_PUBLIC_API:        z.boolean().optional(),                   // Disable public API access UI toggle globally
    NEXT_PUBLIC_INBOX_ENABLED:             z.boolean().optional(),                   // Enable inbox (Sim Mailer) on self-hosted
    NEXT_PUBLIC_EMAIL_PASSWORD_SIGNUP_ENABLED: z.boolean().optional().default(true), // Control visibility of email/password login forms
    NEXT_PUBLIC_TURNSTILE_SITE_KEY:        z.string().min(1).optional(),           // Cloudflare Turnstile site key for captcha widget
    NEXT_PUBLIC_APP_PUBLIC_ORIGIN:         z.string().url().optional(),            // Client-visible apps origin for preview iframes / builder frame-src
    /** Client-visible flag mirroring FULLSTACK_DEMO_MODE for home/app UI routing. */
    NEXT_PUBLIC_FULLSTACK_DEMO_MODE:       z.boolean().optional(),
  },

  // Variables available on both server and client
  shared: {
    NODE_ENV:                              z.enum(['development', 'test', 'production']).optional(), // Runtime environment
    NEXT_TELEMETRY_DISABLED:               z.string().optional(),                                    // Disable Next.js telemetry collection
  },

  experimental__runtimeEnv: {
    NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL,
    NEXT_PUBLIC_BILLING_ENABLED: process.env.NEXT_PUBLIC_BILLING_ENABLED,
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
    NEXT_PUBLIC_BRAND_ACCENT_COLOR: process.env.NEXT_PUBLIC_BRAND_ACCENT_COLOR,
    NEXT_PUBLIC_BRAND_ACCENT_HOVER_COLOR: process.env.NEXT_PUBLIC_BRAND_ACCENT_HOVER_COLOR,
    NEXT_PUBLIC_BRAND_BACKGROUND_COLOR: process.env.NEXT_PUBLIC_BRAND_BACKGROUND_COLOR,
    NEXT_PUBLIC_SSO_ENABLED: process.env.NEXT_PUBLIC_SSO_ENABLED,
    NEXT_PUBLIC_ACCESS_CONTROL_ENABLED: process.env.NEXT_PUBLIC_ACCESS_CONTROL_ENABLED,
    NEXT_PUBLIC_CUSTOM_BLOCKS_ENABLED: process.env.NEXT_PUBLIC_CUSTOM_BLOCKS_ENABLED,
    NEXT_PUBLIC_WHITELABELING_ENABLED: process.env.NEXT_PUBLIC_WHITELABELING_ENABLED,
    NEXT_PUBLIC_AUDIT_LOGS_ENABLED: process.env.NEXT_PUBLIC_AUDIT_LOGS_ENABLED,
    NEXT_PUBLIC_DATA_RETENTION_ENABLED: process.env.NEXT_PUBLIC_DATA_RETENTION_ENABLED,
    NEXT_PUBLIC_DATA_DRAINS_ENABLED: process.env.NEXT_PUBLIC_DATA_DRAINS_ENABLED,
    NEXT_PUBLIC_FORKING_ENABLED: process.env.NEXT_PUBLIC_FORKING_ENABLED,
    NEXT_PUBLIC_WORKFLOW_COLUMNS_ENABLED: process.env.NEXT_PUBLIC_WORKFLOW_COLUMNS_ENABLED,
    NEXT_PUBLIC_ORGANIZATIONS_ENABLED: process.env.NEXT_PUBLIC_ORGANIZATIONS_ENABLED,
    NEXT_PUBLIC_DISABLE_INVITATIONS: process.env.NEXT_PUBLIC_DISABLE_INVITATIONS,
    NEXT_PUBLIC_DISABLE_PUBLIC_API: process.env.NEXT_PUBLIC_DISABLE_PUBLIC_API,
    NEXT_PUBLIC_INBOX_ENABLED: process.env.NEXT_PUBLIC_INBOX_ENABLED,
    NEXT_PUBLIC_EMAIL_PASSWORD_SIGNUP_ENABLED: process.env.NEXT_PUBLIC_EMAIL_PASSWORD_SIGNUP_ENABLED,
    NEXT_PUBLIC_TURNSTILE_SITE_KEY: process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY,
    NEXT_PUBLIC_APP_PUBLIC_ORIGIN: process.env.NEXT_PUBLIC_APP_PUBLIC_ORIGIN,
    NEXT_PUBLIC_FULLSTACK_DEMO_MODE: process.env.NEXT_PUBLIC_FULLSTACK_DEMO_MODE,
    NEXT_PUBLIC_E2B_ENABLED: process.env.NEXT_PUBLIC_E2B_ENABLED,
    NEXT_PUBLIC_BEDROCK_DEFAULT_CREDENTIALS: process.env.NEXT_PUBLIC_BEDROCK_DEFAULT_CREDENTIALS,
    NEXT_PUBLIC_AZURE_CONFIGURED: process.env.NEXT_PUBLIC_AZURE_CONFIGURED,
    NEXT_PUBLIC_COHERE_CONFIGURED: process.env.NEXT_PUBLIC_COHERE_CONFIGURED,
    NEXT_PUBLIC_COPILOT_TRAINING_ENABLED: process.env.NEXT_PUBLIC_COPILOT_TRAINING_ENABLED,
    NEXT_PUBLIC_ENABLE_PLAYGROUND: process.env.NEXT_PUBLIC_ENABLE_PLAYGROUND,
    NEXT_PUBLIC_POSTHOG_ENABLED: process.env.NEXT_PUBLIC_POSTHOG_ENABLED,
    NEXT_PUBLIC_POSTHOG_KEY: process.env.NEXT_PUBLIC_POSTHOG_KEY,
    NODE_ENV: process.env.NODE_ENV,
    NEXT_TELEMETRY_DISABLED: process.env.NEXT_TELEMETRY_DISABLED,
  },
})

// Need this utility because t3-env is returning string for boolean values.
export const isTruthy = (value: string | boolean | number | undefined) =>
  typeof value === 'string' ? value.toLowerCase() === 'true' || value === '1' : Boolean(value)

// Utility to check if a value is explicitly false (defaults to false only if explicitly set)
export const isFalsy = (value: string | boolean | number | undefined) =>
  typeof value === 'string' ? value.toLowerCase() === 'false' || value === '0' : value === false

export { getEnv }

/**
 * Coerce an env-derived value to a finite number ≥ `min`, falling back to the
 * provided default when the value is unset, empty, non-finite, or below `min`.
 * `min` defaults to `0` so configs like `KB_CONFIG_DELAY_BETWEEN_BATCHES=0`
 * (meaning "no delay / max throughput") are honored. Pass `min: 1` for configs
 * where zero is invalid (e.g. Redis TTLs, capacity limits).
 *
 * `createEnv` is configured with `skipValidation: true`, so values declared as
 * `z.number()` arrive as raw strings when sourced from `process.env` or Helm.
 * Use this helper anywhere a numeric env override is consumed to normalize the
 * type at the boundary instead of relying on JS implicit coercion.
 */
export function envNumber(
  value: number | string | undefined | null,
  fallback: number,
  options: { min?: number; integer?: boolean } = {}
): number {
  const min = options.min ?? 0
  if (
    typeof value === 'number' &&
    Number.isFinite(value) &&
    value >= min &&
    (!options.integer || Number.isInteger(value))
  ) {
    return value
  }
  if (value === undefined || value === null || value === '') return fallback
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed >= min && (!options.integer || Number.isInteger(parsed))
    ? parsed
    : fallback
}

/**
 * Coerce an env-derived value to a boolean. Returns `undefined` when unset
 * so callers can apply context-aware defaults. Required because
 * `Boolean("false") === true`, so `z.coerce.boolean()` would silently flip
 * the meaning of `MY_FLAG=false`.
 */
export function envBoolean(value: boolean | string | undefined | null): boolean | undefined {
  if (typeof value === 'boolean') return value
  if (value === undefined || value === null || value === '') return undefined
  const normalized = String(value).trim().toLowerCase()
  return normalized === 'true' || normalized === '1' || normalized === 'yes' || normalized === 'on'
}
