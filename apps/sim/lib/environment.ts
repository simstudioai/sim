/**
 * Environment utility functions for consistent environment detection across the application
 */
import { env } from './env'

export const getNodeEnv = () => {
  try {
    return env.NODE_ENV
  } catch {
    return process.env.NODE_ENV
  }
}

/**
 * Is the application running in production mode
 */
export const isProd = getNodeEnv() === 'production'

/**
 * Is the application running in development mode
 */
export const isDev = getNodeEnv() === 'development'

/**
 * Is the application running in test mode
 */
export const isTest = getNodeEnv() === 'test'

/**
 * Is this the hosted version of the application
 */
export const isHosted = env.NEXT_PUBLIC_APP_URL === 'https://www.simstudio.ai'

/**
 * Get cost multiplier based on environment
 */
export function getCostMultiplier(): number {
  return isProd ? Number.parseFloat(env.COST_MULTIPLIER!) || 1 : 1
}
