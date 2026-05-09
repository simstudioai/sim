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
  | 'calcom.eventTypes'
  | 'calcom.schedules'
  | 'confluence.spaces'
  | 'google.tasks.lists'
  | 'jsm.requestTypes'
  | 'jsm.serviceDesks'
  | 'microsoft.planner.plans'
  | 'notion.databases'
  | 'notion.pages'
  | 'pipedrive.pipelines'
  | 'sharepoint.lists'
  | 'trello.boards'
  | 'zoom.meetings'
  | 'slack.channels'
  | 'slack.users'
  | 'gmail.labels'
  | 'outlook.folders'
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
  awsAccessKeyId?: string
  awsSecretAccessKey?: string
  awsRegion?: string
  logGroupName?: string
  mcpServerId?: string
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

export interface SelectorPageArgs extends SelectorQueryArgs {
  cursor?: string
}

export interface SelectorDefinition {
  key: SelectorKey
  contracts?: readonly AnyApiRouteContract[]
  getQueryKey: (args: SelectorQueryArgs) => QueryKey
  fetchList: (args: SelectorQueryArgs) => Promise<SelectorOption[]>
  /**
   * Optional. When defined, the selector hook fetches one page at a time and
   * auto-drains remaining pages so the dropdown populates progressively.
   * Returns `{ items, nextCursor }`; `nextCursor: undefined` ends the stream.
   */
  fetchPage?: (args: SelectorPageArgs) => Promise<SelectorPage>
  fetchById?: (args: SelectorQueryArgs) => Promise<SelectorOption | null>
  enabled?: (args: SelectorQueryArgs) => boolean
  staleTime?: number
}
