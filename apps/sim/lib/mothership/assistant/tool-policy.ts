import { isLiveEnterpriseSearchEnabled } from '@/lib/core/config/env-flags'
import { projectAssistantConnectedAccountTool } from '@/lib/mothership/assistant/connected-account-tool'
import type { ToolMetadata } from '@/tools/metadata'

export const ASSISTANT_TOOLS = new Set([
  'search_workspace',
  'read_document',
  'oauth_get_auth_link',
  'run_function',
])

const CREDENTIAL_PARAMS = new Set(['credential', 'credentialId', 'oauthCredential'])

/** Read-only lookups complement search_workspace without exposing provider writes. */
const ASSISTANT_INTEGRATION_TOOLS = new Set([
  'slack_list_users',
  'slack_get_user',
  'slack_list_channels',
  'slack_list_user_conversations',
  'slack_get_channel_info',
  'slack_list_members',
  'gmail_list_labels_v2',
  'google_calendar_list_calendars_v2',
  'google_calendar_get_v2',
  'google_calendar_instances_v2',
  'google_calendar_freebusy_v2',
  'google_drive_get_file',
  'google_drive_list_comments',
  'google_sheets_get_spreadsheet_v2',
  'google_sheets_read_v2',
  'jira_search_users',
  'jira_list_projects',
  'jira_get_project',
  'jira_get_fields',
  'jira_get_comments',
  'confluence_list_spaces',
  'confluence_get_user',
  'confluence_get_page_children',
  'confluence_get_page_ancestors',
  'confluence_list_comments',
  'github_search_users_v2',
  'github_repo_info_v2',
  'github_get_tree_v2',
  'github_list_review_threads',
  'github_get_pr_files_v2',
  'gitlab_search_users',
  'gitlab_list_members',
  'gitlab_list_projects',
  'gitlab_get_merge_request_changes',
  'coda_resolve_browser_link',
  'coda_list_pages',
  'coda_list_tables',
  'coda_list_columns',
  'coda_list_rows',
])

/** Discovery and execution share the same operations and personal-account requirements. */
export function isAssistantIntegrationTool(tool: ToolMetadata | undefined): boolean {
  if (!tool || !ASSISTANT_INTEGRATION_TOOLS.has(tool.id)) return false
  tool = projectAssistantConnectedAccountTool(tool, isLiveEnterpriseSearchEnabled)
  const tokenBinding = tool.personalToken
  const supportsToken =
    tokenBinding && tool.params[tokenBinding.tokenParam] && tool.params[tokenBinding.hostParam]
  return Boolean(
    (supportsToken ||
      (tool.oauth?.required &&
        tool.oauth.personalTokenSupported !== false &&
        tool.oauth.credentialKind !== 'service-account')) &&
      !Object.entries(tool.params).some(
        ([name, param]) =>
          param.required &&
          param.visibility === 'user-only' &&
          !CREDENTIAL_PARAMS.has(name) &&
          name !== tokenBinding?.tokenParam &&
          name !== tokenBinding?.hostParam
      )
  )
}

export function isAssistantIntegrationParameter(tool: ToolMetadata, name: string): boolean {
  tool = projectAssistantConnectedAccountTool(tool, isLiveEnterpriseSearchEnabled)
  if (CREDENTIAL_PARAMS.has(name)) return true
  if (name === tool.personalToken?.tokenParam || name === tool.personalToken?.hostParam)
    return false
  const param = tool.params[name]
  return Boolean(
    param &&
      param.visibility !== 'hidden' &&
      param.visibility !== 'user-only' &&
      name !== 'impersonateUserEmail' &&
      !tool.oauth?.authoritativeParams?.some((key) => key === name)
  )
}

/** Validates model arguments before file, secret, hosted-key, or provider resolution can run. */
export function assertAssistantIntegrationCall(
  tool: ToolMetadata | undefined,
  params: Record<string, unknown>
): void {
  if (!tool || !isAssistantIntegrationTool(tool)) {
    throw new Error('Assistant requires an integration that supports your own connected account.')
  }
  for (const [name, value] of Object.entries(params)) {
    if (value !== undefined && !isAssistantIntegrationParameter(tool, name)) {
      throw new Error(
        `Assistant cannot supply the ${name} parameter. Authentication comes from your connected account.`
      )
    }
  }
  const selectors = [...CREDENTIAL_PARAMS]
    .map((name) => params[name])
    .filter((value) => value !== undefined)
  if (
    selectors.length === 0 ||
    selectors.some((value) => typeof value !== 'string' || !value.trim()) ||
    new Set(selectors).size !== 1
  ) {
    throw new Error('Select one of your connected accounts for this integration.')
  }
}
