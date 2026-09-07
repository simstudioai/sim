import type { ComponentType } from 'react'

export const selectorContextKeys = [
  'oauthCredential',
  'domain',
  'teamId',
  'projectId',
  'knowledgeBaseId',
  'planId',
  'mimeType',
  'fileId',
  'siteId',
  'collectionId',
  'spreadsheetId',
  'driveId',
  'excludeWorkflowId',
  'baseId',
  'datasetId',
  'serviceDeskId',
  'impersonateUserEmail',
  'boardId',
  'spaceId',
  'listSpaceId',
  'folderId',
  'awsAccessKeyId',
  'awsSecretAccessKey',
  'awsRegion',
  'logGroupName',
  'tableId',
  'jobId',
  'database',
  'schema',
  'orgId',
  'workspaceSlug',
  'objectType',
  'customObjectTypeId',
  'pipelineId',
  'environmentType',
  'language',
  'host',
  'port',
  'secure',
  'username',
  'password',
] as const

export type SelectorContextKey = (typeof selectorContextKeys)[number]
export type SelectorContext = Partial<Record<SelectorContextKey, string>>

export type SelectorClassification = 'local' | 'internal-server' | 'provider-server'
export type SelectorScopeKind = 'workflow' | 'workspace' | 'organization'
export type SelectorListMode = 'flat' | 'paginated'

export interface SelectorReadiness {
  all?: readonly SelectorContextKey[]
  any?: readonly SelectorContextKey[]
}

export interface SelectorManifestEntry {
  classification: SelectorClassification
  context: {
    allowed: readonly SelectorContextKey[]
    readiness?: SelectorReadiness
    sensitive?: readonly SelectorContextKey[]
    /** Active input aliases that project into a canonical wire-context field. */
    sourceFields?: Partial<Record<SelectorContextKey, readonly string[]>>
  }
  scopeKinds: readonly SelectorScopeKind[]
  listMode: SelectorListMode
  supportsSearch: boolean
  supportsDetail: boolean
  resolvesUnknownIds: boolean
  staleTime: number
}

export type SafeOptionMetaValue = string | number | boolean | null
export type SafeOptionMeta = Record<string, SafeOptionMetaValue>

export interface SafeSelectorOption {
  id: string
  label: string
  meta?: SafeOptionMeta
}

export interface SelectorOption extends SafeSelectorOption {
  icon?: ComponentType<{ className?: string }>
}

export interface SelectorPage {
  items: SelectorOption[]
  nextCursor?: string
}

export type SelectorScope =
  | { kind: 'organization'; organizationId: string }
  | {
      kind: 'workflow'
      workflowId: string
      workspaceId?: string
    }
  | {
      kind: 'workspace'
      workspaceId: string
    }

export type SelectorRequest =
  | {
      kind: 'list'
      search?: string
      cursor?: string
    }
  | {
      kind: 'detail'
      id: string
    }

export type SelectorExecutionResult =
  | {
      kind: 'list'
      items: SafeSelectorOption[]
      nextCursor?: string
      truncated?: boolean
    }
  | {
      kind: 'detail'
      item: SafeSelectorOption | null
    }
