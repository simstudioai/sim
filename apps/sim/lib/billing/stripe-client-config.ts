import type Stripe from 'stripe'

export const STRIPE_API_VERSION = '2025-08-27.basil' as const
export const STRIPE_E2E_PROFILE = 'hosted-billing-chromium' as const

export interface StripeClientConfigEnvironment {
  DATABASE_URL?: string
  E2E_PROFILE?: string
  STRIPE_API_BASE_URL?: string
  STRIPE_SECRET_KEY?: string
}

const E2E_DATABASE_NAME_PATTERN = /^sim_e2e_[A-Za-z0-9_-]+$/

function getDatabaseName(databaseUrl: string | undefined): string | null {
  if (!databaseUrl) return null

  try {
    const parsed = new URL(databaseUrl)
    if (parsed.protocol !== 'postgres:' && parsed.protocol !== 'postgresql:') return null

    const pathSegments = parsed.pathname.split('/').filter(Boolean)
    if (pathSegments.length !== 1) return null

    return decodeURIComponent(pathSegments[0])
  } catch {
    return null
  }
}

function hasLoopbackDatabaseHostname(databaseUrl: string | undefined): boolean {
  if (!databaseUrl) return false
  try {
    const parsed = new URL(databaseUrl)
    return (
      (parsed.protocol === 'postgres:' || parsed.protocol === 'postgresql:') &&
      isLoopbackHostname(parsed.hostname)
    )
  } catch {
    return false
  }
}

export function isGuardedE2eDatabaseUrl(databaseUrl: string | undefined): boolean {
  const databaseName = getDatabaseName(databaseUrl)
  return (
    databaseName !== null &&
    E2E_DATABASE_NAME_PATTERN.test(databaseName) &&
    hasLoopbackDatabaseHostname(databaseUrl)
  )
}

function isLoopbackHostname(hostname: string): boolean {
  const normalized = hostname.toLowerCase()
  if (normalized === 'localhost') return true

  const octets = normalized.split('.')
  return (
    octets.length === 4 &&
    octets.every((octet) => /^\d+$/.test(octet) && Number(octet) <= 255) &&
    Number(octets[0]) === 127
  )
}

function parseStripeApiBaseUrl(rawUrl: string): URL {
  if (rawUrl.trim() !== rawUrl) {
    throw new Error('STRIPE_API_BASE_URL must not contain surrounding whitespace')
  }

  let parsed: URL
  try {
    parsed = new URL(rawUrl)
  } catch {
    throw new Error('STRIPE_API_BASE_URL must be a valid absolute URL')
  }

  if (parsed.protocol !== 'http:') {
    throw new Error('STRIPE_API_BASE_URL must use HTTP for the loopback E2E fake')
  }
  if (!isLoopbackHostname(parsed.hostname)) {
    throw new Error('STRIPE_API_BASE_URL must use a loopback hostname')
  }
  if (parsed.username || parsed.password) {
    throw new Error('STRIPE_API_BASE_URL must not contain credentials')
  }
  if (parsed.search || parsed.hash) {
    throw new Error('STRIPE_API_BASE_URL must not contain a query or hash')
  }
  if (parsed.pathname !== '/') {
    throw new Error('STRIPE_API_BASE_URL must not contain a non-root path')
  }

  return parsed
}

/**
 * Builds the Stripe SDK configuration while keeping the E2E transport override
 * unavailable to normal deployments and production credentials.
 */
export function buildStripeClientConfig(
  environment: StripeClientConfigEnvironment
): Stripe.StripeConfig {
  const baseConfig: Stripe.StripeConfig = {
    apiVersion: STRIPE_API_VERSION,
  }
  const override = environment.STRIPE_API_BASE_URL

  if (override === undefined || override === '') {
    if (environment.E2E_PROFILE === STRIPE_E2E_PROFILE && environment.STRIPE_SECRET_KEY) {
      throw new Error(
        'STRIPE_API_BASE_URL is required when the hosted billing E2E profile configures Stripe'
      )
    }
    return baseConfig
  }

  if (environment.E2E_PROFILE !== STRIPE_E2E_PROFILE) {
    throw new Error(`STRIPE_API_BASE_URL requires E2E_PROFILE=${STRIPE_E2E_PROFILE}`)
  }
  if (!environment.STRIPE_SECRET_KEY?.startsWith('sk_test_')) {
    throw new Error('STRIPE_API_BASE_URL requires a Stripe test secret key')
  }

  const databaseName = getDatabaseName(environment.DATABASE_URL)
  if (!databaseName || !E2E_DATABASE_NAME_PATTERN.test(databaseName)) {
    throw new Error('STRIPE_API_BASE_URL requires a guarded sim_e2e_* database')
  }
  if (!hasLoopbackDatabaseHostname(environment.DATABASE_URL)) {
    throw new Error('STRIPE_API_BASE_URL requires a loopback Postgres database')
  }

  const endpoint = parseStripeApiBaseUrl(override)
  return {
    ...baseConfig,
    host: endpoint.hostname,
    port: endpoint.port || 80,
    protocol: 'http',
  }
}
