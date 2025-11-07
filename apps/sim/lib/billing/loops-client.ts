import { Loops } from '@loops-fi/sdk'
import { env } from '@/lib/env'
import { createLogger } from '@/lib/logs/console/logger'

const logger = createLogger('Loops')

// Initialize Loops client only if API key is provided
let loopsClient: Loops | null = null

if (env.LOOPS_API_KEY) {
  loopsClient = new Loops({
    apiKey: env.LOOPS_API_KEY,
  })
  logger.info('Loops client initialized')
} else {
  logger.warn('Loops API key not provided, Loops client not initialized')
}

export function getLoopsClient(): Loops {
  if (!loopsClient) {
    throw new Error('Loops client not initialized. Please provide LOOPS_API_KEY in environment variables.')
  }
  return loopsClient
}

export function isLoopsEnabled(): boolean {
  return !!env.LOOPS_API_KEY && !!loopsClient
}

