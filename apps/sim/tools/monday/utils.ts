export const MONDAY_API_URL = 'https://api.monday.com/v2'

export function mondayHeaders(accessToken: string): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    Authorization: accessToken,
    'API-Version': '2024-10',
  }
}

export function extractMondayError(data: Record<string, unknown>): string | null {
  if (data.errors && Array.isArray(data.errors) && data.errors.length > 0) {
    const messages = (data.errors as Array<Record<string, unknown>>)
      .map((e) => e.message as string)
      .filter(Boolean)
    return messages.length > 0 ? messages.join('; ') : 'Unknown Monday.com API error'
  }
  if (data.error_message) {
    return data.error_message as string
  }
  return null
}
