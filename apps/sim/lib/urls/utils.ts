/**
 * Returns the base URL of the application, respecting environment variables for deployment environments
 * @returns The base URL string (e.g., 'http://localhost:3000' or 'https://example.com')
 */
export function getBaseUrl(): string {
  if (typeof window !== 'undefined') {
    return window.location.origin
  }

  const baseUrl = process.env.NEXT_PUBLIC_APP_URL
  if (baseUrl) {
    if (baseUrl.startsWith('http://') || baseUrl.startsWith('https://')) {
      return baseUrl
    }

    const isProd = process.env.NODE_ENV === 'production'
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
    const isProd = process.env.NODE_ENV === 'production'
    return isProd ? 'simstudio.ai' : 'localhost:3000'
  }
}
