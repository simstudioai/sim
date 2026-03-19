import { createLogger } from '@sim/logger'

const logger = createLogger('ValidateCallbackUrl')

/**
 * Returns true if the URL is safe to redirect to after authentication.
 * Accepts relative paths and absolute URLs matching the current origin.
 */
export function validateCallbackUrl(url: string): boolean {
  try {
    if (url.startsWith('/')) return true

    const currentOrigin = typeof window !== 'undefined' ? window.location.origin : ''
    if (url.startsWith(currentOrigin)) return true

    return false
  } catch (error) {
    logger.error('Error validating callback URL:', { error, url })
    return false
  }
}
