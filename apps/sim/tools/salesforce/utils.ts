import { createLogger } from '@/lib/logs/console/logger'

const logger = createLogger('SalesforceUtils')

/**
 * Salesforce metadata stored in the idToken field
 */
export interface SalesforceMetadata {
  instanceUrl: string
  authBaseUrl?: string
}

/**
 * Parses the Salesforce metadata from the idToken field
 * Handles multiple formats for backward compatibility:
 * 1. JSON object with instanceUrl and authBaseUrl (new format)
 * 2. Raw URL starting with https:// (legacy format)
 * 3. JWT token (very old legacy format)
 *
 * @param idToken - The value stored in the idToken field
 * @returns Parsed Salesforce metadata or null if parsing fails
 */
export function parseSalesforceMetadata(idToken?: string): SalesforceMetadata | null {
  if (!idToken) return null

  if (idToken.startsWith('{')) {
    try {
      const parsed = JSON.parse(idToken)
      if (parsed.instanceUrl) {
        return {
          instanceUrl: parsed.instanceUrl,
          authBaseUrl: parsed.authBaseUrl,
        }
      }
    } catch {
      // Not valid JSON, try other formats
    }
  }

  if (idToken.startsWith('https://') && idToken.includes('.salesforce.com')) {
    return { instanceUrl: idToken }
  }

  try {
    const base64Url = idToken.split('.')[1]
    if (base64Url) {
      const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/')
      const jsonPayload = decodeURIComponent(
        atob(base64)
          .split('')
          .map((c) => `%${(`00${c.charCodeAt(0).toString(16)}`).slice(-2)}`)
          .join('')
      )
      const decoded = JSON.parse(jsonPayload)
      if (decoded.profile) {
        const match = decoded.profile.match(/^(https:\/\/[^/]+)/)
        if (match) return { instanceUrl: match[1] }
      } else if (decoded.sub) {
        const match = decoded.sub.match(/^(https:\/\/[^/]+)/)
        if (match && match[1] !== 'https://login.salesforce.com') {
          return { instanceUrl: match[1] }
        }
      }
    }
  } catch (error) {
    logger.error('Failed to decode Salesforce idToken', { error })
  }

  return null
}

/**
 * Extracts Salesforce instance URL from ID token or uses provided instance URL
 * @param idToken - The Salesforce ID token (can be JSON metadata, raw URL, or JWT token)
 * @param instanceUrl - Direct instance URL if provided
 * @returns The Salesforce instance URL
 * @throws Error if instance URL cannot be determined
 */
export function getInstanceUrl(idToken?: string, instanceUrl?: string): string {
  if (instanceUrl) return instanceUrl

  const metadata = parseSalesforceMetadata(idToken)
  if (metadata?.instanceUrl) {
    return metadata.instanceUrl
  }

  throw new Error('Salesforce instance URL is required but not provided')
}

/**
 * Extracts a descriptive error message from Salesforce API responses
 * @param data - The response data from Salesforce API
 * @param status - HTTP status code
 * @param defaultMessage - Default message to use if no specific error found
 * @returns Formatted error message
 */
export function extractErrorMessage(data: any, status: number, defaultMessage: string): string {
  if (Array.isArray(data) && data[0]?.message) {
    return `Salesforce API Error (${status}): ${data[0].message}${data[0].errorCode ? ` [${data[0].errorCode}]` : ''}`
  }
  if (data?.message) {
    return `Salesforce API Error (${status}): ${data.message}`
  }
  if (data?.error) {
    return `Salesforce API Error (${status}): ${data.error}${data.error_description ? ` - ${data.error_description}` : ''}`
  }
  switch (status) {
    case 400:
      return `Salesforce API Error (400): Bad Request - The request was malformed or missing required parameters`
    case 401:
      return `Salesforce API Error (401): Unauthorized - Invalid or expired access token. Please re-authenticate.`
    case 403:
      return `Salesforce API Error (403): Forbidden - You do not have permission to access this resource.`
    case 404:
      return `Salesforce API Error (404): Not Found - The requested resource does not exist or you do not have access to it.`
    case 500:
      return `Salesforce API Error (500): Internal Server Error - An error occurred on Salesforce's servers.`
    default:
      return `${defaultMessage} (HTTP ${status})`
  }
}
