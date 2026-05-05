import type { SubBlockType } from '@sim/workflow-types/blocks'
import type { SubBlockConfig } from '@/blocks/types'
import type { SelectorContext } from '@/hooks/selectors/types'
import type { BlockState, SubBlockState } from '@/stores/workflows/workflow/types'

export type WorkflowSearchMode = 'text' | 'resource' | 'all'

export type WorkflowSearchMatchKind =
  | 'text'
  | 'environment'
  | 'workflow-reference'
  | 'oauth-credential'
  | 'knowledge-base'
  | 'knowledge-document'
  | 'workflow'
  | 'mcp-server'
  | 'mcp-tool'
  | 'table'
  | 'file'
  | 'selector-resource'

export type WorkflowSearchValuePath = Array<string | number>

export interface WorkflowSearchRange {
  start: number
  end: number
}

export interface WorkflowSearchResourceMeta {
  kind: Exclude<WorkflowSearchMatchKind, 'text'>
  providerId?: string
  serviceId?: string
  selectorKey?: string
  selectorContext?: SelectorContext
  resourceGroupKey?: string
  requiredScopes?: string[]
  token?: string
  key?: string
}

export interface WorkflowSearchMatch {
  id: string
  blockId: string
  blockName: string
  blockType: string
  subBlockId: string
  canonicalSubBlockId: string
  subBlockType: SubBlockType
  fieldTitle?: string
  valuePath: WorkflowSearchValuePath
  kind: WorkflowSearchMatchKind
  rawValue: string
  searchText: string
  range?: WorkflowSearchRange
  resource?: WorkflowSearchResourceMeta
  editable: boolean
  navigable: boolean
  protected: boolean
  reason?: string
}

export interface WorkflowSearchSubBlockState extends Omit<SubBlockState, 'value'> {
  value: unknown
}

export interface WorkflowSearchBlockState extends Omit<BlockState, 'subBlocks'> {
  subBlocks: Record<string, WorkflowSearchSubBlockState>
}

export interface WorkflowSearchWorkflow {
  blocks: Record<string, WorkflowSearchBlockState>
}

export interface WorkflowSearchIndexerOptions {
  workflow: WorkflowSearchWorkflow
  query?: string
  mode?: WorkflowSearchMode
  caseSensitive?: boolean
  includeResourceMatchesWithoutQuery?: boolean
  isSnapshotView?: boolean
  workspaceId?: string
  workflowId?: string
  blockConfigs?: Record<string, { subBlocks?: SubBlockConfig[] } | undefined>
}

export interface IndexedSubBlockContext {
  block: WorkflowSearchBlockState
  blockConfig?: { subBlocks?: SubBlockConfig[] }
  subBlockConfig?: SubBlockConfig
  subBlockId: string
  canonicalSubBlockId: string
  protected: boolean
  isSnapshotView?: boolean
}

export interface WorkflowSearchReplacementTarget {
  matchId: string
  replacement: string
}

export interface WorkflowSearchReplacementOption {
  kind: WorkflowSearchMatchKind
  value: string
  label: string
  providerId?: string
  serviceId?: string
  selectorKey?: string
  selectorContext?: SelectorContext
  resourceGroupKey?: string
}

export interface WorkflowSearchReplaceUpdate {
  blockId: string
  subBlockId: string
  previousValue: unknown
  nextValue: unknown
  matchIds: string[]
}

export interface WorkflowSearchReplaceSkipped {
  matchId: string
  reason: string
}

export interface WorkflowSearchReplacePlan {
  updates: WorkflowSearchReplaceUpdate[]
  skipped: WorkflowSearchReplaceSkipped[]
  conflicts: WorkflowSearchReplaceSkipped[]
}
