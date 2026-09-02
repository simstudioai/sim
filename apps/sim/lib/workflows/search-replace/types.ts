import type { SubBlockType } from '@sim/workflow-types/blocks'
import type { SelectorContext } from '@/lib/selectors/types'
import type {
  WorkflowSearchSubflowEditableValue,
  WorkflowSearchSubflowFieldId,
} from '@/lib/workflows/search-replace/subflow-fields'
import type { StoredCustomToolRecord } from '@/lib/workflows/subblocks/display'
import type { SubBlockConfig } from '@/blocks/types'
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

/** Raw selector inputs plus the resource scope needed by the client transport. */
export interface WorkflowSearchSelectorContext extends SelectorContext {
  workflowId?: string
  workspaceId?: string
  /** Search metadata for MCP tools; never forwarded to selectors.execute. */
  mcpServerId?: string
}

export interface WorkflowSearchRange {
  start: number
  end: number
}

export interface WorkflowSearchResourceMeta {
  kind: Exclude<WorkflowSearchMatchKind, 'text'>
  providerId?: string
  serviceId?: string
  selectorKey?: string
  selectorContext?: WorkflowSearchSelectorContext
  resourceGroupKey?: string
  requiredScopes?: string[]
  token?: string
  key?: string
}

export type WorkflowSearchTarget =
  | { kind: 'subblock' }
  | { kind: 'subflow'; fieldId: WorkflowSearchSubflowFieldId }
  | { kind: 'block-name' }

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
  target: WorkflowSearchTarget
  kind: WorkflowSearchMatchKind
  rawValue: string
  searchText: string
  range?: WorkflowSearchRange
  structuredOccurrenceIndex?: number
  dependentValuePaths?: WorkflowSearchValuePath[]
  resource?: WorkflowSearchResourceMeta
  editable: boolean
  navigable: boolean
  protected: boolean
  reason?: string
}

interface WorkflowSearchSubBlockState extends Omit<SubBlockState, 'value'> {
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
  isReadOnly?: boolean
  readonlyReason?: string
  workspaceId?: string
  workflowId?: string
  blockConfigs?: Record<
    string,
    | {
        name?: string
        subBlocks?: SubBlockConfig[]
        triggers?: { enabled?: boolean }
        category?: string
      }
    | undefined
  >
  credentialTypeById?: Record<string, string | undefined>
  /** Custom-tool records so indexed tool names match the rendered chips. */
  customTools?: StoredCustomToolRecord[]
  /** Live MCP tool names keyed by composite tool id, same as the chip renderers. */
  mcpToolNamesById?: ReadonlyMap<string, string>
}

export interface WorkflowSearchReplacementOption {
  kind: WorkflowSearchMatchKind
  value: string
  label: string
  providerId?: string
  serviceId?: string
  selectorKey?: string
  selectorContext?: WorkflowSearchSelectorContext
  resourceGroupKey?: string
}

export interface WorkflowSearchReplaceUpdate {
  blockId: string
  subBlockId: string
  previousValue: unknown
  nextValue: unknown
  matchIds: string[]
}

export interface WorkflowSearchReplaceSubflowUpdate {
  blockId: string
  blockType: 'loop' | 'parallel'
  fieldId: WorkflowSearchSubflowFieldId
  previousValue: string
  nextValue: WorkflowSearchSubflowEditableValue
  matchIds: string[]
}

interface WorkflowSearchReplaceSkipped {
  matchId: string
  reason: string
}

export interface WorkflowSearchReplacePlan {
  updates: WorkflowSearchReplaceUpdate[]
  subflowUpdates: WorkflowSearchReplaceSubflowUpdate[]
  skipped: WorkflowSearchReplaceSkipped[]
  conflicts: WorkflowSearchReplaceSkipped[]
}
