import 'server-only'
import type { IntegrationProvider } from '@/platform/lib/integrations/model'

const MEMBER_SEARCH = ['member'] as const
const MEMBER_OR_SERVICE_SEARCH = ['member', 'service_account'] as const

function provider(
  id: string,
  name: string,
  description: string,
  searchModes: IntegrationProvider['searchModes'] = [],
  accountMethods: IntegrationProvider['accountMethods'] = ['oauth']
): IntegrationProvider {
  return { id, name, description, searchModes, accountMethods }
}

export const integrationProviders: IntegrationProvider[] = [
  provider('airtable', 'Airtable', 'Work with bases, tables and records.'),
  provider('asana', 'Asana', 'Work with projects and their tasks.'),
  provider('attio', 'Attio', 'Work with company and contact records.'),
  provider('bitbucket', 'Bitbucket', 'Work with repositories and pull requests.'),
  provider('box', 'Box', 'Work with files and folders in Box.'),
  provider('calcom', 'Cal.com', 'Work with event types and bookings.'),
  provider('clickup', 'ClickUp', 'Work with lists, tasks and project updates.'),
  provider('coda', 'Coda', 'Search docs, pages and tables.', MEMBER_OR_SERVICE_SEARCH, ['mcp']),
  provider(
    'confluence',
    'Confluence',
    'Search pages across your spaces.',
    MEMBER_OR_SERVICE_SEARCH
  ),
  provider('databricks', 'Databricks', 'Connect a workspace MCP endpoint.', [], ['databricks']),
  provider('docusign', 'DocuSign', 'Work with agreements and signatures.'),
  provider('dropbox', 'Dropbox', 'Work with files in shared folders.'),
  provider('fireflies', 'Fireflies', 'Find meeting transcripts and summaries.', MEMBER_SEARCH, [
    'mcp',
  ]),
  provider('github', 'GitHub', 'Search code, issues and pull requests.', MEMBER_OR_SERVICE_SEARCH),
  provider('gitlab', 'GitLab', 'Search projects using a service account.', ['service_account'], []),
  provider('gmail', 'Gmail', 'Search mail, threads and labels.', MEMBER_OR_SERVICE_SEARCH),
  provider(
    'google_calendar',
    'Google Calendar',
    'Find events across calendars.',
    MEMBER_OR_SERVICE_SEARCH
  ),
  provider('google-chat', 'Google Chat', 'Work with messages and spaces.'),
  provider('google-docs', 'Google Docs', 'Read and edit shared documents.'),
  provider(
    'google_drive',
    'Google Drive',
    'Find files in folders and shared drives.',
    MEMBER_OR_SERVICE_SEARCH
  ),
  provider('google-forms', 'Google Forms', 'Work with forms and responses.'),
  provider('google_meet', 'Google Meet', 'Find meeting transcripts and notes.', MEMBER_SEARCH),
  provider('google-sheets', 'Google Sheets', 'Work with spreadsheets, ranges and cells.'),
  provider('granola', 'Granola', 'Find meeting notes and transcripts.', MEMBER_SEARCH, ['mcp']),
  provider('hubspot', 'HubSpot', 'Search CRM records and deals.', MEMBER_SEARCH, ['oauth', 'mcp']),
  provider('jira', 'Jira', 'Find issues across projects.', MEMBER_SEARCH),
  provider('linear', 'Linear', 'Find issues and project updates.', MEMBER_SEARCH),
  provider('linkedin', 'LinkedIn', 'Work with LinkedIn profiles and posts.'),
  provider('lucid', 'Lucid', 'Search Lucidchart diagrams and Lucidspark boards.', MEMBER_SEARCH, [
    'mcp',
  ]),
  provider('microsoft-excel', 'Microsoft Excel', 'Work with workbooks and worksheets.'),
  provider('microsoft-teams', 'Microsoft Teams', 'Work with teams, channels and messages.'),
  provider('monday', 'Monday.com', 'Work with boards, groups and items.'),
  provider('notion', 'Notion', 'Search pages and databases.', MEMBER_SEARCH, ['oauth', 'mcp']),
  provider('onedrive', 'OneDrive', 'Work with files and folders in OneDrive.'),
  provider('outlook', 'Outlook', 'Work with email and folders in Outlook.'),
  provider('pipedrive', 'Pipedrive', 'Work with deals, people and organizations.'),
  provider('salesforce', 'Salesforce', 'Work with accounts, opportunities and records.'),
  provider('sharepoint', 'SharePoint', 'Work with sites, lists and document libraries.'),
  provider('slack', 'Slack', 'Find messages and discussions across channels.', MEMBER_SEARCH, [
    'slack',
  ]),
  provider('wordpress', 'WordPress', 'Work with posts, pages and media.'),
  provider('zoom', 'Zoom', 'Find past meetings and recordings.', MEMBER_SEARCH, ['oauth', 'mcp']),
]
