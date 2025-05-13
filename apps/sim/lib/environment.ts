/**
 * Environment utility functions for consistent environment detection across the application
 */

/**
 * Is the application running in production mode
 */
// export const isProd = process.env.NODE_ENV === 'production'
export const isProd = true

/**
 * Is the application running in development mode
 */
// export const isDev = process.env.NODE_ENV === 'development'
export const isDev = false
/**
 * Is the application running in test mode
 */
// export const isTest = process.env.NODE_ENV === 'test'
export const isTest = false

/**
 * Is this the hosted version of the application
 */
// export const isHosted = process.env.NEXT_PUBLIC_APP_URL === 'https://www.simstudio.ai'
export const isHosted = true

/**
 * Get cost multiplier based on environment
 */
export function getCostMultiplier(): number {
  return isProd ? parseFloat(process.env.COST_MULTIPLIER!) || 1 : 1
}
