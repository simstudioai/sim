import Stripe from 'stripe'
import { env } from '@/lib/env'
import { createLogger } from '@/lib/logs/console/logger'

const logger = createLogger('StripeClient')

/**
 * Check if Stripe credentials are valid
 */
export function hasValidStripeCredentials(): boolean {
  return !!env.STRIPE_SECRET_KEY
}

/**
 * Secure Stripe client singleton with initialization guard
 */
const createStripeClientSingleton = () => {
  let stripeClient: Stripe | null = null
  let isInitializing = false

  return {
    getInstance(): Stripe | null {
      // If already initialized, return immediately
      if (stripeClient) return stripeClient

      // Prevent concurrent initialization attempts
      if (isInitializing) {
        logger.debug('Stripe client initialization already in progress')
        return null
      }

      if (!hasValidStripeCredentials()) {
        logger.warn('Stripe credentials not available - Stripe operations will be disabled')
        return null
      }

      try {
        isInitializing = true

        stripeClient = new Stripe(env.STRIPE_SECRET_KEY || '', {
          apiVersion: '2025-02-24.acacia',
        })

        logger.info('Stripe client initialized successfully')
        return stripeClient
      } catch (error) {
        logger.error('Failed to initialize Stripe client', { error })
        stripeClient = null // Ensure cleanup on failure
        return null
      } finally {
        isInitializing = false
      }
    },

    // For testing purposes only - allows resetting the singleton
    reset(): void {
      stripeClient = null
      isInitializing = false
    },
  }
}

const stripeClientSingleton = createStripeClientSingleton()

/**
 * Get the Stripe client instance
 * @returns Stripe client or null if credentials are not available
 */
export function getStripeClient(): Stripe | null {
  return stripeClientSingleton.getInstance()
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
