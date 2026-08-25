import type React from 'react'
import type { QueryKey } from '@tanstack/react-query'
import type { AnyApiRouteContract } from '@/lib/api/contracts/types'

export type SelectorKey =
  | 'airtable.bases'
  | 'airtable.tables'
  | 'asana.workspaces'
  | 'attio.lists'
  | 'attio.objects'
  | 'bigquery.datasets'
  | 'bigquery.tables'
  | 'googleAnalytics.accounts'
  | 'googleAnalytics.properties'
  | 'bitbucket.workspaces'
  | 'bitbucket.repositories'
  | 'calcom.eventTypes'
  | 'calcom.schedules'
  | 'clickup.workspaces'
  | 'clickup.spaces'
  | 'clickup.folders'
  | 'clickup.lists'
  | 'confluence.spaces'
  | 'google.tasks.lists'
  | 'harmonic.savedSearches'
  | 'managedAgent.agents'
  | 'managedAgent.environments'
  | 'managedAgent.vaults'
  | 'managedAgent.memoryStores'
  | 'hubspot.lists'
  | 'hubspot.owners'
  | 'hubspot.pipelines'
  | 'hubspot.pipelineStages'
  | 'hubspot.properties'
  | 'jsm.requestTypes'
  | 'jsm.serviceDesks'
  | 'microsoft.planner.plans'
  | 'notion.databases'
  | 'notion.pages'
  | 'netsuite.recordTypes'
  | 'netsuite.asyncTasks'
  | 'pipedrive.pipelines'
  | 'sharepoint.lists'
  | 'trello.boards'
  | 'zoho_desk.organizations'
  | 'zoho_desk.departments'
  | 'zoho_desk.agents'
  | 'zoom.meetings'
  | 'slack.channels'
  | 'snowflake.databases'
  | 'snowflake.schemas'
  | 'snowflake.tables'
  | 'snowflake.warehouses'
  | 'snowflake.roles'
  | 'snowflake.fileFormats'
  | 'snowflake.procedures'
  | 'slack.users'
  | 'gmail.labels'
  | 'outlook.folders'
  | 'outlook.calendars'
  | 'google.calendar'
  | 'jira.issues'
  | 'jira.projects'
  | 'linear.projects'
  | 'linear.teams'
  | 'confluence.pages'
  | 'microsoft.teams'
  | 'microsoft.chats'
  | 'microsoft.channels'
  | 'wealthbox.contacts'
  | 'onedrive.files'
  | 'onedrive.folders'
  | 'sharepoint.sites'
  | 'microsoft.excel'
  | 'microsoft.excel.drives'
  | 'microsoft.excel.sheets'
  | 'microsoft.word'
  | 'microsoft.planner'
  | 'google.drive'
  | 'google.sheets'
  | 'knowledge.documents'
  | 'webflow.sites'
  | 'webflow.collections'
  | 'webflow.items'
  | 'cloudwatch.logGroups'
  | 'cloudwatch.logStreams'
  | 'monday.boards'
  | 'monday.groups'
  | 'sim.workflows'
  | 'table.columns'
  | 'table.outputColumns'
  | 'workspace.credentialProviders'
  | 'workspace.credentialGroups'
  | 'workspace.credentialGroupProviders'
  | 'workspace.secretNames'
  | 'workspace.rawSecretNames'
  | 'workspace.sandboxes'
  | 'workspace.triggerTypes'
  | 'imap.mailboxes'
  | 'providers.openrouterEmbeddingModels'

export interface SelectorOption {
  id: string
  label: string
  icon?: React.ComponentType<{ className?: string }>
  meta?: Record<string, unknown>
}

export interface SelectorContext {
  workspaceId?: string
  workflowId?: string
  oauthCredential?: string
  serviceId?: string
  domain?: string
  teamId?: string
  projectId?: string
  knowledgeBaseId?: string
  planId?: string
  mimeType?: string
  fileId?: string
  siteId?: string
  collectionId?: string
  spreadsheetId?: string
  driveId?: string
  excludeWorkflowId?: string
  baseId?: string
  datasetId?: string
  serviceDeskId?: string
  impersonateUserEmail?: string
  boardId?: string
  spaceId?: string
  listSpaceId?: string
  folderId?: string
  awsAccessKeyId?: string
  awsSecretAccessKey?: string
  awsRegion?: string
  logGroupName?: string
  mcpServerId?: string
  tableId?: string
  /** NetSuite asynchronous job whose bounded task list a picker enumerates. */
  jobId?: string
  /** Snowflake database holding the objects a picker enumerates. */
  database?: string
  /** Snowflake schema holding the objects a picker enumerates. */
  schema?: string
  /** Zoho Desk organization (portal) id — the `orgId` header every Desk call but `/organizations` requires. */
  orgId?: string
  /** Bitbucket Cloud workspace slug that scopes repository discovery. */
  workspaceSlug?: string
  /**
   * HubSpot CRM object the pickers are scoped to (`contact` | `deal` | … | `custom`). Left
   * unset until the user picks one; the selectors apply HubSpot's own `contact` default so an
   * untouched dropdown still lists properties for what it visibly shows.
   */
  objectType?: string
  /** HubSpot custom object type id (e.g. `2-12345`), used when `objectType` is `custom`. */
  customObjectTypeId?: string
  /** HubSpot pipeline whose stages a stage picker enumerates. */
  pipelineId?: string
  /**
   * Managed Agent deployment mode (`cloud` | `self_hosted`). The two expose different fields,
   * so an environment list is filtered to the selected mode rather than mixing them.
   */
  environmentType?: string
  /** Credential group whose per-provider filter a picker enumerates. */
  credentialGroupId?: string
  /** Function block runtime (`python` | `javascript` | `shell`), scoping the sandbox list. */
  language?: string
  /**
   * IMAP connection parameters. `imapPassword` is a raw secret, so unlike `oauthCredential` —
   * which is only an id — it must NEVER appear in a query key; see `imap.mailboxes`.
   */
  host?: string
  port?: string
  secure?: string
  username?: string
  password?: string
}

export interface SelectorQueryArgs {
  key: SelectorKey
  context: SelectorContext
  search?: string
  detailId?: string
  signal?: AbortSignal
}

export interface SelectorPage {
  items: SelectorOption[]
  nextCursor?: string
}

interface SelectorPageArgs extends SelectorQueryArgs {
  cursor?: string
}

export interface SelectorDefinition {
  key: SelectorKey
  contracts?: readonly AnyApiRouteContract[]
  getQueryKey: (args: SelectorQueryArgs) => QueryKey
  /**
   * Loads the full option list in a single call. Required unless `fetchPage` is
   * defined, in which case the hook drives pagination through `fetchPage` and
   * `fetchList` is never invoked — provide one or the other, not both.
   */
  fetchList?: (args: SelectorQueryArgs) => Promise<SelectorOption[]>
  /**
   * Optional. When defined, the selector hook fetches one page at a time and
   * auto-drains remaining pages so the dropdown populates progressively.
   * Returns `{ items, nextCursor }`; `nextCursor: undefined` ends the stream.
   */
  fetchPage?: (args: SelectorPageArgs) => Promise<SelectorPage>
  fetchById?: (args: SelectorQueryArgs) => Promise<SelectorOption | null>
  /**
   * Set when `fetchById` tolerates an id that may not exist, returning `null` rather
   * than erroring. Only then is it safe to speculatively resolve whatever a user has
   * typed — most implementations resolve a record by id and would turn every partial
   * keystroke into a failed upstream request.
   */
  resolvesUnknownIds?: boolean
  enabled?: (args: SelectorQueryArgs) => boolean
  staleTime?: number
}
