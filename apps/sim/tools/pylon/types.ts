// Shared types and utilities for Pylon tools

export const PYLON_API_BASE_URL = 'https://api.usepylon.com'

export function buildPylonUrl(path: string): string {
  return `${PYLON_API_BASE_URL}${path}`
}

export interface PylonErrorResponse {
  error?: {
    code?: string
    message?: string
    details?: any
  }
  request_id?: string
}

export function handlePylonError(
  data: PylonErrorResponse,
  status: number,
  operation: string
): never {
  const errorMessage = data.error?.message || `Pylon API error during ${operation}`
  const errorCode = data.error?.code || `HTTP_${status}`

  throw new Error(`${errorCode}: ${errorMessage}`)
}
