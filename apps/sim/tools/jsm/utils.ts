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
