import type React from 'react'
import type { QueryKey } from '@tanstack/react-query'

export type SelectorKey =
  | 'slack.channels'
  | 'gmail.labels'
  | 'outlook.folders'
  | 'google.calendar'
  | 'jira.issues'
  | 'jira.projects'
  | 'linear.projects'
  | 'linear.teams'
  | 'confluence.pages'
  | 'microsoft.teams'
  | 'wealthbox.contacts'
  | 'onedrive.files'
  | 'onedrive.folders'
  | 'sharepoint.sites'
  | 'microsoft.excel'
  | 'microsoft.word'
  | 'microsoft.planner'
  | 'google.drive'
  | 'knowledge.documents'

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
  provider?: string
  serviceId?: string
  domain?: string
  teamId?: string
  projectId?: string
  knowledgeBaseId?: string
  planId?: string
  mimeType?: string
  fileId?: string
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
