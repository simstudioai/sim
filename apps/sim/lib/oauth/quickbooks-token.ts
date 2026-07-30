const QUICKBOOKS_MAX_ACCESS_TOKEN_LENGTH = 4096

export function normalizeQuickBooksAccessToken(accessToken: string): string {
  if (/[\r\n]/.test(accessToken)) {
    throw new Error('QuickBooks access token contains invalid characters')
  }
  if (accessToken.length > QUICKBOOKS_MAX_ACCESS_TOKEN_LENGTH) {
    throw new Error(
      `QuickBooks access token must be ${QUICKBOOKS_MAX_ACCESS_TOKEN_LENGTH} characters or less`
    )
  }

  const normalizedAccessToken = accessToken.trim()
  if (!normalizedAccessToken) {
    throw new Error('QuickBooks access token is required')
  }
  return normalizedAccessToken
}
