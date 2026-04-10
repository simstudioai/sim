/**
 * Shared utilities for Jira Service Management tools
 * Reuses the getJiraCloudId from the Jira integration since JSM uses the same Atlassian Cloud ID
 */
export { getJiraCloudId } from '@/tools/jira/utils'

/**
 * Build the base URL for JSM Service Desk API
 * @param cloudId - The Jira Cloud ID
 * @returns The base URL for the Service Desk API
 */
export function getJsmApiBaseUrl(cloudId: string): string {
  return `https://api.atlassian.com/ex/jira/${cloudId}/rest/servicedeskapi`
}

/**
 * Build the base URL for JSM Forms (ProForma) API
 * @param cloudId - The Jira Cloud ID
 * @returns The base URL for the JSM Forms API
 */
export function getJsmFormsApiBaseUrl(cloudId: string): string {
  return `https://api.atlassian.com/ex/jira/${cloudId}/forms`
}

/**
 * Build common headers for JSM API requests
 * @param accessToken - The OAuth access token
 * @returns Headers object for API requests
 */
export function getJsmHeaders(accessToken: string): Record<string, string> {
  return {
    Authorization: `Bearer ${accessToken}`,
    Accept: 'application/json',
    'Content-Type': 'application/json',
    'X-ExperimentalApi': 'opt-in',
  }
}

/**
 * Parse error messages from JSM/Forms API responses
 * @param status - HTTP status code
 * @param statusText - HTTP status text
 * @param errorText - Raw error response body
 * @returns Formatted error message string
 */
export function parseJsmErrorMessage(
  status: number,
  statusText: string,
  errorText: string
): string {
  try {
    const errorData = JSON.parse(errorText)
    // JSM Service Desk: singular errorMessage
    if (errorData.errorMessage) {
      return errorData.errorMessage
    }
    // Jira Platform: errorMessages array
    if (Array.isArray(errorData.errorMessages) && errorData.errorMessages.length > 0) {
      return errorData.errorMessages.join(', ')
    }
    // Confluence v2 / Forms API: RFC 7807 errors array
    if (Array.isArray(errorData.errors) && errorData.errors.length > 0) {
      const err = errorData.errors[0]
      if (err?.title) {
        return err.detail ? `${err.title}: ${err.detail}` : err.title
      }
    }
    // Jira Platform field-level errors object
    if (errorData.errors && !Array.isArray(errorData.errors)) {
      const fieldErrors = Object.entries(errorData.errors)
        .map(([field, msg]) => `${field}: ${msg}`)
        .join(', ')
      if (fieldErrors) return fieldErrors
    }
    // Generic message fallback
    if (errorData.message) {
      return errorData.message
    }
  } catch {
    if (errorText) {
      return errorText
    }
  }
  return `${status} ${statusText}`
}
