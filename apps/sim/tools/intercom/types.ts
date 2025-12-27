import { createLogger } from '@sim/logger'

const logger = createLogger('Intercom')

// Base params for Intercom API
export interface IntercomBaseParams {
  accessToken: string // OAuth token or API token (hidden)
}

export interface IntercomPaginationParams {
  per_page?: number
  starting_after?: string // Cursor for pagination
}

export interface IntercomPagingInfo {
  next?: {
    page: number
    starting_after: string
  } | null
  total_count?: number
}

export interface IntercomResponse<T> {
  success: boolean
  output: {
    data?: T
    pages?: IntercomPagingInfo
    metadata: {
      operation: string
      [key: string]: any
    }
    success: boolean
  }
}

// Helper function to build Intercom API URLs
export function buildIntercomUrl(path: string): string {
  return `https://api.intercom.io${path}`
}

// Helper function for consistent error handling
export function handleIntercomError(data: any, status: number, operation: string): never {
  logger.error(`Intercom API request failed for ${operation}`, { data, status })

  const errorMessage = data.errors?.[0]?.message || data.error || data.message || 'Unknown error'
  throw new Error(`Intercom ${operation} failed: ${errorMessage}`)
}
