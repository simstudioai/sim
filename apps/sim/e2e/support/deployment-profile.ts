import { buildChildEnvironment, type ChildEnvironment } from './env'
import { E2E_CACHE_DIR } from './paths'

export const E2E_PROFILE = 'hosted-billing-chromium'
export const E2E_HOST = 'e2e.sim.ai'
export const E2E_ORIGIN = `http://${E2E_HOST}:3000`
export const E2E_SOCKET_ORIGIN = `http://${E2E_HOST}:3002`

const APP_REQUIRED_KEYS = [
  'NODE_ENV',
  'NEXT_PUBLIC_APP_URL',
  'BETTER_AUTH_URL',
  'BETTER_AUTH_SECRET',
  'DATABASE_URL',
  'ENCRYPTION_KEY',
  'API_ENCRYPTION_KEY',
  'INTERNAL_API_SECRET',
  'ADMIN_API_KEY',
  'BILLING_ENABLED',
  'NEXT_PUBLIC_BILLING_ENABLED',
  'STRIPE_SECRET_KEY',
  'STRIPE_API_BASE_URL',
  'E2E_PROFILE',
  'E2E_RUN_ID',
  'HOME',
] as const
const APP_ENVIRONMENT_KEYS = [
  ...APP_REQUIRED_KEYS,
  'NODE_OPTIONS',
  'NEXT_TELEMETRY_DISABLED',
  'XDG_CONFIG_HOME',
  'AWS_EC2_METADATA_DISABLED',
  'AWS_SHARED_CREDENTIALS_FILE',
  'AWS_CONFIG_FILE',
  'CLOUDSDK_CONFIG',
  'AZURE_CONFIG_DIR',
  'E2E_BASE_URL',
  'EMAIL_VERIFICATION_ENABLED',
  'EMAIL_PASSWORD_SIGNUP_ENABLED',
  'NEXT_PUBLIC_EMAIL_PASSWORD_SIGNUP_ENABLED',
  'DISABLE_REGISTRATION',
  'DISABLE_EMAIL_SIGNUP',
  'SIGNUP_MX_VALIDATION_ENABLED',
  'NEXT_PUBLIC_POSTHOG_ENABLED',
  'BLACKLISTED_PROVIDERS',
  'STRIPE_WEBHOOK_SECRET',
  'STRIPE_FREE_PRICE_ID',
  'SOCKET_SERVER_URL',
  'NEXT_PUBLIC_SOCKET_URL',
  'CI',
] as const

const ALLOWED_SENSITIVE_KEYS = new Set([
  'BETTER_AUTH_SECRET',
  'ENCRYPTION_KEY',
  'API_ENCRYPTION_KEY',
  'INTERNAL_API_SECRET',
  'ADMIN_API_KEY',
  'EMAIL_PASSWORD_SIGNUP_ENABLED',
  'NEXT_PUBLIC_EMAIL_PASSWORD_SIGNUP_ENABLED',
  'STRIPE_SECRET_KEY',
  'STRIPE_WEBHOOK_SECRET',
])

export interface HostedBillingProfileOptions {
  runId: string
  databaseUrl: string
  stripeApiBaseUrl: string
  homeDirectory: string
  playwrightBrowsersPath: string
  ci: boolean
}

export interface HostedBillingProfile {
  id: typeof E2E_PROFILE
  origin: typeof E2E_ORIGIN
  environments: {
    build: ChildEnvironment
    app: ChildEnvironment
    realtime: ChildEnvironment
    migration: ChildEnvironment
    seed: ChildEnvironment
    authCapture: ChildEnvironment
    playwright: ChildEnvironment
  }
}

export function createHostedBillingProfile({
  runId,
  databaseUrl,
  stripeApiBaseUrl,
  homeDirectory,
  playwrightBrowsersPath,
  ci,
}: HostedBillingProfileOptions): HostedBillingProfile {
  const values: Record<string, string> = {
    NODE_ENV: 'production',
    NODE_OPTIONS: '--no-warnings --max-old-space-size=8192 --dns-result-order=ipv4first',
    NEXT_TELEMETRY_DISABLED: '1',
    HOME: homeDirectory,
    XDG_CONFIG_HOME: `${homeDirectory}/xdg`,
    AWS_EC2_METADATA_DISABLED: 'true',
    AWS_SHARED_CREDENTIALS_FILE: '/dev/null',
    AWS_CONFIG_FILE: '/dev/null',
    CLOUDSDK_CONFIG: `${homeDirectory}/gcloud`,
    AZURE_CONFIG_DIR: `${homeDirectory}/azure`,
    PLAYWRIGHT_BROWSERS_PATH: playwrightBrowsersPath,
    E2E_PROFILE,
    E2E_RUN_ID: runId,
    E2E_BASE_URL: E2E_ORIGIN,
    NEXT_PUBLIC_APP_URL: E2E_ORIGIN,
    BETTER_AUTH_URL: E2E_ORIGIN,
    BETTER_AUTH_SECRET: 'e2e-better-auth-secret-at-least-32-characters-long',
    DATABASE_URL: databaseUrl,
    MIGRATION_DATABASE_URL: databaseUrl,
    ENCRYPTION_KEY: '11'.repeat(32),
    API_ENCRYPTION_KEY: '22'.repeat(32),
    INTERNAL_API_SECRET: 'e2e-internal-api-secret-at-least-32-characters',
    ADMIN_API_KEY: 'e2e-admin-api-key-at-least-32-characters-long',
    BILLING_ENABLED: 'true',
    NEXT_PUBLIC_BILLING_ENABLED: 'true',
    EMAIL_VERIFICATION_ENABLED: 'false',
    EMAIL_PASSWORD_SIGNUP_ENABLED: 'true',
    NEXT_PUBLIC_EMAIL_PASSWORD_SIGNUP_ENABLED: 'true',
    DISABLE_REGISTRATION: 'false',
    DISABLE_EMAIL_SIGNUP: 'false',
    SIGNUP_MX_VALIDATION_ENABLED: 'false',
    NEXT_PUBLIC_POSTHOG_ENABLED: 'false',
    BLACKLISTED_PROVIDERS: 'ollama,ollama-cloud,vllm,litellm,openrouter,together,fireworks,baseten',
    STRIPE_SECRET_KEY: 'sk_test_sim_e2e_foundation',
    STRIPE_WEBHOOK_SECRET: 'whsec_sim_e2e_foundation',
    STRIPE_FREE_PRICE_ID: 'price_e2e_free',
    STRIPE_API_BASE_URL: stripeApiBaseUrl,
    SOCKET_SERVER_URL: 'http://127.0.0.1:3002',
    NEXT_PUBLIC_SOCKET_URL: E2E_SOCKET_ORIGIN,
    CI: ci ? 'true' : 'false',
  }

  validateProfileValues(values)
  const buildHomeDirectory = `${E2E_CACHE_DIR}/build-home`
  const buildValues = {
    ...pickValues(values, APP_ENVIRONMENT_KEYS),
    XDG_CONFIG_HOME: `${buildHomeDirectory}/xdg`,
    AWS_EC2_METADATA_DISABLED: values.AWS_EC2_METADATA_DISABLED,
    AWS_SHARED_CREDENTIALS_FILE: values.AWS_SHARED_CREDENTIALS_FILE,
    AWS_CONFIG_FILE: values.AWS_CONFIG_FILE,
    CLOUDSDK_CONFIG: `${buildHomeDirectory}/gcloud`,
    AZURE_CONFIG_DIR: `${buildHomeDirectory}/azure`,
    E2E_RUN_ID: 'build_sentinel',
    HOME: buildHomeDirectory,
    DATABASE_URL: 'postgresql://e2e_build:e2e_build@127.0.0.1:1/sim_e2e_build_sentinel',
    STRIPE_API_BASE_URL: 'http://127.0.0.1:1',
    CI: 'false',
  }
  validateProfileValues(buildValues)

  return {
    id: E2E_PROFILE,
    origin: E2E_ORIGIN,
    environments: {
      build: createEnvironment(buildValues, APP_REQUIRED_KEYS),
      app: createEnvironment(pickValues(values, APP_ENVIRONMENT_KEYS), APP_REQUIRED_KEYS),
      realtime: createEnvironment(
        pickValues(values, [
          'NODE_ENV',
          'NODE_OPTIONS',
          'HOME',
          'DATABASE_URL',
          'BETTER_AUTH_URL',
          'BETTER_AUTH_SECRET',
          'INTERNAL_API_SECRET',
          'NEXT_PUBLIC_APP_URL',
          'E2E_RUN_ID',
          'CI',
        ]),
        [
          'NODE_ENV',
          'HOME',
          'DATABASE_URL',
          'BETTER_AUTH_URL',
          'BETTER_AUTH_SECRET',
          'INTERNAL_API_SECRET',
          'NEXT_PUBLIC_APP_URL',
          'E2E_RUN_ID',
        ],
        false
      ),
      migration: createEnvironment(
        pickValues(values, [
          'NODE_ENV',
          'NODE_OPTIONS',
          'HOME',
          'MIGRATION_DATABASE_URL',
          'DATABASE_URL',
          'E2E_PROFILE',
          'E2E_RUN_ID',
          'CI',
        ]),
        ['NODE_ENV', 'HOME', 'MIGRATION_DATABASE_URL', 'DATABASE_URL', 'E2E_PROFILE', 'E2E_RUN_ID'],
        false
      ),
      seed: createEnvironment(
        pickValues(values, [
          'NODE_ENV',
          'NODE_OPTIONS',
          'HOME',
          'DATABASE_URL',
          'ADMIN_API_KEY',
          'E2E_PROFILE',
          'E2E_RUN_ID',
          'E2E_BASE_URL',
          'CI',
        ]),
        [
          'NODE_ENV',
          'HOME',
          'DATABASE_URL',
          'ADMIN_API_KEY',
          'E2E_PROFILE',
          'E2E_RUN_ID',
          'E2E_BASE_URL',
        ],
        false
      ),
      authCapture: createEnvironment(
        pickValues(values, [
          'NODE_ENV',
          'NODE_OPTIONS',
          'HOME',
          'PLAYWRIGHT_BROWSERS_PATH',
          'E2E_PROFILE',
          'E2E_RUN_ID',
          'E2E_BASE_URL',
          'CI',
        ]),
        [
          'NODE_ENV',
          'HOME',
          'PLAYWRIGHT_BROWSERS_PATH',
          'E2E_PROFILE',
          'E2E_RUN_ID',
          'E2E_BASE_URL',
        ],
        false
      ),
      playwright: createEnvironment(
        pickValues(values, [
          'NODE_ENV',
          'NODE_OPTIONS',
          'HOME',
          'PLAYWRIGHT_BROWSERS_PATH',
          'E2E_PROFILE',
          'E2E_RUN_ID',
          'E2E_BASE_URL',
          'CI',
        ]),
        [
          'NODE_ENV',
          'HOME',
          'PLAYWRIGHT_BROWSERS_PATH',
          'E2E_PROFILE',
          'E2E_RUN_ID',
          'E2E_BASE_URL',
        ],
        false
      ),
    },
  }
}

function createEnvironment(
  values: Record<string, string>,
  required: readonly string[],
  shadowDiscovered = true
): ChildEnvironment {
  return buildChildEnvironment({
    values,
    required,
    allowedSensitiveKeys: ALLOWED_SENSITIVE_KEYS,
    shadowDiscovered,
  })
}

function pickValues(
  values: Record<string, string>,
  keys: readonly string[]
): Record<string, string> {
  return Object.fromEntries(
    keys.flatMap((key) => {
      const value = values[key]
      return value === undefined ? [] : [[key, value]]
    })
  )
}

function validateProfileValues(values: Record<string, string>): void {
  if (values.NEXT_PUBLIC_APP_URL !== E2E_ORIGIN || values.BETTER_AUTH_URL !== E2E_ORIGIN) {
    throw new Error('E2E app and Better Auth origins must exactly match')
  }
  if (values.BILLING_ENABLED !== values.NEXT_PUBLIC_BILLING_ENABLED) {
    throw new Error('BILLING_ENABLED and NEXT_PUBLIC_BILLING_ENABLED must match')
  }
  if (!values.DATABASE_URL.includes('/sim_e2e_')) {
    throw new Error('E2E profile requires a sim_e2e_ database')
  }
  const stripeUrl = new URL(values.STRIPE_API_BASE_URL)
  if (stripeUrl.hostname !== '127.0.0.1') {
    throw new Error('E2E Stripe API must use numeric IPv4 loopback 127.0.0.1')
  }
}
