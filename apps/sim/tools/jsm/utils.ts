/**
 * Shared utilities for Jira Service Management tools
 * Reuses the getJiraCloudId and parseAtlassianErrorMessage from the Jira integration
 */
/**
 * Re-export parseAtlassianErrorMessage as parseJsmErrorMessage for backwards compatibility.
 * All JSM routes already import this name.
 */
export {
  getJiraCloudId,
  parseAtlassianErrorMessage,
  parseAtlassianErrorMessage as parseJsmErrorMessage,
} from '@/tools/jira/utils'

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
