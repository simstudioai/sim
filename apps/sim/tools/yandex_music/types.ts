/**
 * YandexMusic API integration types and shared utilities.
 */

export interface YandexMusicCredentials {
  apiKey: string
}

export interface YandexMusicErrorResponse {
  error: {
    code?: string
    type: string
    message: string
  }
}

export function transformYandexMusicError(response: unknown): string {
  if (response && typeof response === 'object' && 'error' in response) {
    const err = response as YandexMusicErrorResponse
    return err.error?.message ?? 'Unknown error'
  }
  return 'Request failed'
}
