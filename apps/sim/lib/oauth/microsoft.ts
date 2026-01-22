export const MICROSOFT_REFRESH_TOKEN_LIFETIME_DAYS = 90
export const PROACTIVE_REFRESH_THRESHOLD_DAYS = 7

export const MICROSOFT_PROVIDERS = new Set([
  'microsoft-excel',
  'microsoft-planner',
  'microsoft-teams',
  'outlook',
  'onedrive',
  'sharepoint',
])

export function isMicrosoftProvider(providerId: string): boolean {
  return MICROSOFT_PROVIDERS.has(providerId)
}

export function getMicrosoftRefreshTokenExpiry(): Date {
  return new Date(Date.now() + MICROSOFT_REFRESH_TOKEN_LIFETIME_DAYS * 24 * 60 * 60 * 1000)
}
