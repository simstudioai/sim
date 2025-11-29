import { createLogger } from '@/lib/logs/console/logger'

const logger = createLogger('Mailchimp')

// Base params
export interface MailchimpBaseParams {
  apiKey: string // API key with server prefix (e.g., "key-us19")
}

export interface MailchimpPaginationParams {
  count?: string
  offset?: string
}

export interface MailchimpPagingInfo {
  totalItems: number
}

export interface MailchimpResponse<T> {
  success: boolean
  output: {
    data?: T
    paging?: MailchimpPagingInfo
    metadata: {
      operation: string
      [key: string]: any
    }
    success: boolean
  }
}

// Helper function to extract server prefix from API key
export function extractServerPrefix(apiKey: string): string {
  const parts = apiKey.split('-')
  if (parts.length < 2) {
    throw new Error('Invalid Mailchimp API key format. Expected format: key-dc (e.g., abc123-us19)')
  }
  return parts[parts.length - 1]
}

// Helper function to build Mailchimp API URLs
export function buildMailchimpUrl(apiKey: string, path: string): string {
  const serverPrefix = extractServerPrefix(apiKey)
  return `https://${serverPrefix}.api.mailchimp.com/3.0${path}`
}

// Helper function for consistent error handling
export function handleMailchimpError(data: any, status: number, operation: string): never {
  logger.error(`Mailchimp API request failed for ${operation}`, { data, status })

  const errorMessage = data.detail || data.title || data.error || data.message || 'Unknown error'
  throw new Error(`Mailchimp ${operation} failed: ${errorMessage}`)
}
