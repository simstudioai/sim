import { createLogger } from '@sim/logger'

const logger = createLogger('Zendesk')

// Base params - following Sentry pattern where subdomain is user-provided
export interface ZendeskBaseParams {
  email: string // Zendesk user email (required for API token authentication)
  apiToken: string // API token (hidden)
  subdomain: string // Zendesk subdomain (user-visible, required - e.g., "mycompany" for mycompany.zendesk.com)
}

export interface ZendeskPaginationParams {
  page?: string
  perPage?: string
}

export interface ZendeskPagingInfo {
  nextPage?: string | null
  previousPage?: string | null
  count: number
}

export interface ZendeskResponse<T> {
  success: boolean
  output: {
    data?: T
    paging?: ZendeskPagingInfo
    metadata: {
      operation: string
      [key: string]: any
    }
    success: boolean
  }
}

// Helper function to build Zendesk API URLs
// Subdomain is always provided by user as a parameter
export function buildZendeskUrl(subdomain: string, path: string): string {
  return `https://${subdomain}.zendesk.com/api/v2${path}`
}

// Helper function for consistent error handling
export function handleZendeskError(data: any, status: number, operation: string): never {
  logger.error(`Zendesk API request failed for ${operation}`, { data, status })

  const errorMessage = data.error || data.description || data.message || 'Unknown error'
  throw new Error(`Zendesk ${operation} failed: ${errorMessage}`)
}
