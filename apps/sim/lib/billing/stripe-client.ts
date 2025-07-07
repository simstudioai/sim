import Stripe from 'stripe'
import { env } from '@/lib/env'
import { createLogger } from '@/lib/logs/console-logger'

const logger = createLogger('StripeClient')

// Lazily create a single Stripe client instance
let _stripeClient: Stripe | null = null

/**
 * Check if Stripe credentials are valid
 */
export function hasValidStripeCredentials(): boolean {
  return !!(
    env.STRIPE_SECRET_KEY &&
    env.STRIPE_SECRET_KEY.trim() !== '' &&
    env.STRIPE_SECRET_KEY !== 'placeholder'
  )
}

/**
 * Get the Stripe client instance
 * @returns Stripe client or null if credentials are not available
 */
export function getStripeClient(): Stripe | null {
  if (_stripeClient) return _stripeClient

  if (!hasValidStripeCredentials()) {
    logger.warn('Stripe credentials not available - Stripe operations will be disabled')
    return null
  }

  try {
    _stripeClient = new Stripe(env.STRIPE_SECRET_KEY || '', {
      apiVersion: '2025-02-24.acacia',
    })

    logger.info('Stripe client initialized successfully')
    return _stripeClient
  } catch (error) {
    logger.error('Failed to initialize Stripe client', { error })
    return null
  }
}

/**
 * Get the Stripe client instance, throwing an error if not available
 * Use this when Stripe operations are required
 */
export function requireStripeClient(): Stripe {
  const client = getStripeClient()

  if (!client) {
    throw new Error(
      'Stripe client is not available. Set STRIPE_SECRET_KEY in your environment variables.'
    )
  }

  return client
}
