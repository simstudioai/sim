import type React from 'react'
import type { QueryKey } from '@tanstack/react-query'

export type SelectorKey =
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
  | 'microsoft.excel.sheets'
  | 'microsoft.word'
  | 'microsoft.planner'
  | 'google.drive'
  | 'google.sheets'
  | 'knowledge.documents'
  | 'webflow.sites'
  | 'webflow.collections'
  | 'webflow.items'
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
  credentialId?: string
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
  excludeWorkflowId?: string
}

export interface SelectorQueryArgs {
  key: SelectorKey
  context: SelectorContext
  search?: string
  detailId?: string
}

export interface SelectorDefinition {
  key: SelectorKey
  getQueryKey: (args: SelectorQueryArgs) => QueryKey
  fetchList: (args: SelectorQueryArgs) => Promise<SelectorOption[]>
  fetchById?: (args: SelectorQueryArgs) => Promise<SelectorOption | null>
  enabled?: (args: SelectorQueryArgs) => boolean
  staleTime?: number
}
