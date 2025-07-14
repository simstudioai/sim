import { env } from '@/lib/env'
import { isProd } from '@/lib/environment'

/**
 * Returns the base URL of the application, respecting environment variables for deployment environments
 * @returns The base URL string (e.g., 'http://localhost:3000' or 'https://example.com')
 */
export function getBaseUrl(): string {
  if (typeof window !== 'undefined') {
    return window.location.origin
  }

  const baseUrl = env.NEXT_PUBLIC_APP_URL
  if (baseUrl) {
    if (baseUrl.startsWith('http://') || baseUrl.startsWith('https://')) {
      return baseUrl
    }

    const protocol = isProd ? 'https://' : 'http://'
    return `${protocol}${baseUrl}`
  }

  return 'http://localhost:3000'
}

/**
 * Returns just the domain and port part of the application URL
 * @returns The domain with port if applicable (e.g., 'localhost:3000' or 'simstudio.ai')
 */
export function getBaseDomain(): string {
  try {
    const url = new URL(getBaseUrl())
    return url.host // host includes port if specified
  } catch (_e) {
    const fallbackUrl = env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'
    try {
      return new URL(fallbackUrl).host
    } catch {
      return isProd ? 'simstudio.ai' : 'localhost:3000'
    }
  }
}

/**
 * Returns the domain for email addresses, stripping www subdomain for Resend compatibility
 * @returns The email domain (e.g., 'simstudio.ai' instead of 'www.simstudio.ai')
 */
export function getEmailDomain(): string {
  try {
    const baseDomain = getBaseDomain()
    return baseDomain.startsWith('www.') ? baseDomain.substring(4) : baseDomain
  } catch (_e) {
    return isProd ? 'simstudio.ai' : 'localhost:3000'
  }
}
