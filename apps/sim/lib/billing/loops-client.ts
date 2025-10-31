import { Loops } from '@loops-fi/sdk'
import { env } from '@/lib/env'
import { createLogger } from '@/lib/logs/console/logger'

const logger = createLogger('LoopsClient')

/**
 * Check if Loops credentials are valid
 */
export function hasValidLoopsCredentials(): boolean {
  return !!env.LOOPS_API_KEY
}

/**
 * Secure Loops client singleton with initialization guard
 */
const createLoopsClientSingleton = () => {
  let loopsClient: Loops | null = null
  let isInitializing = false

  return {
    getInstance(): Loops | null {
      // If already initialized, return immediately
      if (loopsClient) return loopsClient

      // Prevent concurrent initialization attempts
      if (isInitializing) {
        logger.debug('Loops client initialization already in progress')
        return null
      }

      if (!hasValidLoopsCredentials()) {
        logger.warn('Loops credentials not available - Loops operations will be disabled')
        return null
      }

      try {
        isInitializing = true

        loopsClient = new Loops({
          apiKey: env.LOOPS_API_KEY || '',
        })

        logger.info('Loops client initialized successfully')
        return loopsClient
      } catch (error) {
        logger.error('Failed to initialize Loops client', { error })
        loopsClient = null // Ensure cleanup on failure
        return null
      } finally {
        isInitializing = false
      }
    },

    // For testing purposes only - allows resetting the singleton
    reset(): void {
      loopsClient = null
      isInitializing = false
    },
  }
}

const loopsClientSingleton = createLoopsClientSingleton()

/**
 * Get the Loops client instance
 * @returns Loops client or null if credentials are not available
 */
export function getLoopsClient(): Loops | null {
  return loopsClientSingleton.getInstance()
}

/**
 * Get the Loops client instance, throwing an error if not available
 * Use this when Loops operations are required
 */
export function requireLoopsClient(): Loops {
  const client = getLoopsClient()

  if (!client) {
    throw new Error(
      'Loops client is not available. Set LOOPS_API_KEY in your environment variables.'
    )
  }

  return client
}

