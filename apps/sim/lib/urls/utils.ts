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
    const fallbackUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'
    try {
      return new URL(fallbackUrl).host
    } catch {
      const isProd = process.env.NODE_ENV === 'production'
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
    const isProd = process.env.NODE_ENV === 'production'
    return isProd ? 'simstudio.ai' : 'localhost:3000'
  }
}

/**
 * OAuth URL construction utilities
 */

export interface OAuthUrlParams {
  provider: string
  service: string
  scopes: string[]
  returnUrl?: string
}

/**
 * Constructs a standardized OAuth URL for authentication
 * @param params OAuth URL parameters
 * @returns The complete OAuth URL
 */
export function buildOAuthUrl({ provider, service, scopes, returnUrl }: OAuthUrlParams): string {
  const currentReturnUrl = returnUrl || (typeof window !== 'undefined' ? window.location.href : '')

  return `/api/auth/oauth?provider=${provider}&service=${service}&scopes=${encodeURIComponent(
    scopes.join(',')
  )}&return_url=${encodeURIComponent(currentReturnUrl)}`
}

/**
 * Microsoft Teams URL construction utilities
 */

/**
 * Constructs a Microsoft Teams team URL
 * @param teamId The team ID
 * @returns The complete Teams team URL
 */
export function buildTeamsTeamUrl(teamId: string): string {
  return `https://teams.microsoft.com/l/team/${teamId}`
}

/**
 * Constructs a Microsoft Teams channel URL
 * @param teamId The team ID
 * @param channelDisplayName The channel display name
 * @param channelId The channel ID
 * @returns The complete Teams channel URL
 */
export function buildTeamsChannelUrl(
  teamId: string,
  channelDisplayName: string,
  channelId: string
): string {
  return `https://teams.microsoft.com/l/channel/${teamId}/${encodeURIComponent(channelDisplayName)}/${channelId}`
}

/**
 * Constructs a Microsoft Teams chat URL
 * @param chatId The chat ID
 * @returns The complete Teams chat URL
 */
export function buildTeamsChatUrl(chatId: string): string {
  return `https://teams.microsoft.com/l/chat/${chatId}`
}
