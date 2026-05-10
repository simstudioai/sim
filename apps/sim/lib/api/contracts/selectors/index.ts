import {
  airtableBasesSelectorContract,
  airtableTablesSelectorContract,
} from '@/lib/api/contracts/selectors/airtable'
import { asanaWorkspacesSelectorContract } from '@/lib/api/contracts/selectors/asana'
import {
  attioListsSelectorContract,
  attioObjectsSelectorContract,
} from '@/lib/api/contracts/selectors/attio'
import {
  bigQueryDatasetsSelectorContract,
  bigQueryTablesSelectorContract,
} from '@/lib/api/contracts/selectors/bigquery'
import {
  calcomEventTypesSelectorContract,
  calcomSchedulesSelectorContract,
} from '@/lib/api/contracts/selectors/calcom'
import {
  cloudwatchLogGroupsSelectorContract,
  cloudwatchLogStreamsSelectorContract,
} from '@/lib/api/contracts/selectors/cloudwatch'
import {
  confluencePageSelectorContract,
  confluencePagesSelectorContract,
  confluenceSpacesSelectorContract,
} from '@/lib/api/contracts/selectors/confluence'
import {
  gmailLabelSelectorContract,
  gmailLabelsSelectorContract,
  googleCalendarSelectorContract,
  googleDriveFileSelectorContract,
  googleDriveFilesSelectorContract,
  googleSheetsSelectorContract,
  googleTasksTaskListsSelectorContract,
} from '@/lib/api/contracts/selectors/google'
import {
  jiraIssueSelectorContract,
  jiraIssuesSelectorContract,
  jiraProjectSelectorContract,
  jiraProjectsSelectorContract,
} from '@/lib/api/contracts/selectors/jira'
import {
  jsmRequestTypesSelectorContract,
  jsmServiceDesksSelectorContract,
} from '@/lib/api/contracts/selectors/jsm'
import {
  linearProjectsSelectorContract,
  linearTeamsSelectorContract,
} from '@/lib/api/contracts/selectors/linear'
import {
  microsoftChannelsSelectorContract,
  microsoftChatsSelectorContract,
  microsoftExcelDriveSelectorContract,
  microsoftExcelDrivesSelectorContract,
  microsoftExcelSheetsSelectorContract,
  microsoftFileSelectorContract,
  microsoftFilesSelectorContract,
  microsoftPlannerPlansSelectorContract,
  microsoftPlannerTasksSelectorContract,
  microsoftTeamsSelectorContract,
  onedriveFilesSelectorContract,
  onedriveFolderSelectorContract,
  onedriveFoldersSelectorContract,
  outlookFoldersSelectorContract,
} from '@/lib/api/contracts/selectors/microsoft'
import {
  mondayBoardsSelectorContract,
  mondayGroupsSelectorContract,
} from '@/lib/api/contracts/selectors/monday'
import {
  notionDatabasesSelectorContract,
  notionPagesSelectorContract,
} from '@/lib/api/contracts/selectors/notion'
import { pipedrivePipelinesSelectorContract } from '@/lib/api/contracts/selectors/pipedrive'
import {
  sharepointListsSelectorContract,
  sharepointSiteSelectorContract,
  sharepointSitesSelectorContract,
} from '@/lib/api/contracts/selectors/sharepoint'
import {
  slackChannelsSelectorContract,
  slackUserSelectorContract,
  slackUsersSelectorContract,
} from '@/lib/api/contracts/selectors/slack'
import { trelloBoardsSelectorContract } from '@/lib/api/contracts/selectors/trello'
import {
  wealthboxItemContract,
  wealthboxItemsSelectorContract,
  wealthboxOAuthItemContract,
  wealthboxOAuthItemsContract,
} from '@/lib/api/contracts/selectors/wealthbox'
import {
  webflowCollectionsSelectorContract,
  webflowItemsSelectorContract,
  webflowSitesSelectorContract,
} from '@/lib/api/contracts/selectors/webflow'
import { zoomMeetingsSelectorContract } from '@/lib/api/contracts/selectors/zoom'

export * from '@/lib/api/contracts/selectors/airtable'
export * from '@/lib/api/contracts/selectors/asana'
export * from '@/lib/api/contracts/selectors/attio'
export * from '@/lib/api/contracts/selectors/bigquery'
export * from '@/lib/api/contracts/selectors/calcom'
export * from '@/lib/api/contracts/selectors/cloudwatch'
export * from '@/lib/api/contracts/selectors/confluence'
export * from '@/lib/api/contracts/selectors/google'
export * from '@/lib/api/contracts/selectors/jira'
export * from '@/lib/api/contracts/selectors/jsm'
export * from '@/lib/api/contracts/selectors/knowledge'
export * from '@/lib/api/contracts/selectors/linear'
export * from '@/lib/api/contracts/selectors/microsoft'
export * from '@/lib/api/contracts/selectors/monday'
export * from '@/lib/api/contracts/selectors/notion'
export * from '@/lib/api/contracts/selectors/oauth'
export * from '@/lib/api/contracts/selectors/pipedrive'
export * from '@/lib/api/contracts/selectors/sharepoint'
export * from '@/lib/api/contracts/selectors/slack'
export * from '@/lib/api/contracts/selectors/trello'
export * from '@/lib/api/contracts/selectors/wealthbox'
export * from '@/lib/api/contracts/selectors/webflow'
export * from '@/lib/api/contracts/selectors/zoom'

export const selectorContractsByPath = {
  '/api/tools/airtable/bases': airtableBasesSelectorContract,
  '/api/tools/airtable/tables': airtableTablesSelectorContract,
  '/api/tools/asana/workspaces': asanaWorkspacesSelectorContract,
  '/api/tools/attio/objects': attioObjectsSelectorContract,
  '/api/tools/attio/lists': attioListsSelectorContract,
  '/api/tools/google_bigquery/datasets': bigQueryDatasetsSelectorContract,
  '/api/tools/google_bigquery/tables': bigQueryTablesSelectorContract,
  '/api/tools/calcom/event-types': calcomEventTypesSelectorContract,
  '/api/tools/calcom/schedules': calcomSchedulesSelectorContract,
  '/api/tools/confluence/selector-spaces': confluenceSpacesSelectorContract,
  '/api/tools/jsm/selector-servicedesks': jsmServiceDesksSelectorContract,
  '/api/tools/jsm/selector-requesttypes': jsmRequestTypesSelectorContract,
  '/api/tools/google_tasks/task-lists': googleTasksTaskListsSelectorContract,
  '/api/tools/microsoft_planner/plans': microsoftPlannerPlansSelectorContract,
  '/api/tools/microsoft_planner/tasks': microsoftPlannerTasksSelectorContract,
  '/api/tools/notion/databases': notionDatabasesSelectorContract,
  '/api/tools/notion/pages': notionPagesSelectorContract,
  '/api/tools/pipedrive/pipelines': pipedrivePipelinesSelectorContract,
  '/api/tools/sharepoint/lists': sharepointListsSelectorContract,
  '/api/tools/sharepoint/site': sharepointSiteSelectorContract,
  '/api/tools/sharepoint/sites': sharepointSitesSelectorContract,
  '/api/tools/trello/boards': trelloBoardsSelectorContract,
  '/api/tools/zoom/meetings': zoomMeetingsSelectorContract,
  '/api/tools/slack/channels': slackChannelsSelectorContract,
  '/api/tools/slack/users': slackUsersSelectorContract,
  '/api/tools/slack/users:detail': slackUserSelectorContract,
  '/api/tools/gmail/labels': gmailLabelsSelectorContract,
  '/api/tools/gmail/label': gmailLabelSelectorContract,
  '/api/tools/outlook/folders': outlookFoldersSelectorContract,
  '/api/tools/google_calendar/calendars': googleCalendarSelectorContract,
  '/api/tools/microsoft-teams/teams': microsoftTeamsSelectorContract,
  '/api/tools/microsoft-teams/chats': microsoftChatsSelectorContract,
  '/api/tools/microsoft-teams/channels': microsoftChannelsSelectorContract,
  '/api/tools/wealthbox/items': wealthboxItemsSelectorContract,
  '/api/tools/wealthbox/item': wealthboxItemContract,
  '/api/auth/oauth/wealthbox/items': wealthboxOAuthItemsContract,
  '/api/auth/oauth/wealthbox/item': wealthboxOAuthItemContract,
  '/api/tools/jira/projects': jiraProjectsSelectorContract,
  '/api/tools/jira/projects:POST': jiraProjectSelectorContract,
  '/api/tools/jira/issues': jiraIssuesSelectorContract,
  '/api/tools/jira/issues:POST': jiraIssueSelectorContract,
  '/api/tools/monday/boards': mondayBoardsSelectorContract,
  '/api/tools/monday/groups': mondayGroupsSelectorContract,
  '/api/tools/linear/teams': linearTeamsSelectorContract,
  '/api/tools/linear/projects': linearProjectsSelectorContract,
  '/api/tools/confluence/pages': confluencePagesSelectorContract,
  '/api/tools/confluence/page': confluencePageSelectorContract,
  '/api/tools/onedrive/files': onedriveFilesSelectorContract,
  '/api/tools/onedrive/folder': onedriveFolderSelectorContract,
  '/api/tools/onedrive/folders': onedriveFoldersSelectorContract,
  '/api/tools/drive/files': googleDriveFilesSelectorContract,
  '/api/tools/drive/file': googleDriveFileSelectorContract,
  '/api/tools/google_sheets/sheets': googleSheetsSelectorContract,
  '/api/tools/microsoft_excel/sheets': microsoftExcelSheetsSelectorContract,
  '/api/tools/microsoft_excel/drives': microsoftExcelDrivesSelectorContract,
  '/api/tools/microsoft_excel/drives:detail': microsoftExcelDriveSelectorContract,
  '/api/auth/oauth/microsoft/file': microsoftFileSelectorContract,
  '/api/auth/oauth/microsoft/files': microsoftFilesSelectorContract,
  '/api/tools/webflow/sites': webflowSitesSelectorContract,
  '/api/tools/webflow/collections': webflowCollectionsSelectorContract,
  '/api/tools/webflow/items': webflowItemsSelectorContract,
  '/api/tools/cloudwatch/describe-log-groups': cloudwatchLogGroupsSelectorContract,
  '/api/tools/cloudwatch/describe-log-streams': cloudwatchLogStreamsSelectorContract,
} as const

export type SelectorContractPath = keyof typeof selectorContractsByPath
