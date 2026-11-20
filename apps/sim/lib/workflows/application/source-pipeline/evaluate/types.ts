import type { Principal } from '@sim/auth/principal'
import type {
  BlockCatalog,
  CanonicalWorkflow,
  CanonicalWorkflowMeta,
  LockIdentity,
  ResourceKeyResolver,
  ResourceKind,
  SourceBase,
  SourceHints,
  SourceSpan,
  WorkflowLockV1,
  WorkflowSourceMetaV1,
} from '@sim/workflow-code'
import type { BlockState, WorkflowState } from '@sim/workflow-types/workflow'
import type { SourceDiffSummary } from '@/lib/workflows/application/source-diff'
import type { WorkflowSourceDiagnostic } from '@/lib/workflows/application/source-error'
import type { normalizeWorkflowVariables } from '@/lib/workflows/application/workflow-variables'
import type { StoredSource } from '@/lib/workflows/code/print-stored'
import type { StoredCanonical } from '@/lib/workflows/code/stored-canonical'
import type { ResourceKeyRef } from '@/lib/workspaces/resource-keys'

/** Who and where a source write acts: what the evaluation gates and the commit re-checks run as. */
export interface SourceScope {
  workflowId: string
  workspaceId: string
  workspaceOrganizationId: string | null
  /** The human the write is performed as, for gates, permission groups and lint. */
  subjectUserId: string
  /** The folder the workflow sits in (`null` at the root), for a rename's name check. */
  folderId: string | null
}

export interface SourceEvaluationInput {
  principal: Principal
  scope: SourceScope
  /** The draft the source applies to; an empty graph for a workflow the apply creates. */
  stored: StoredSource
  /** `stored` canonicalized with its resource keys. */
  storedCanonical: StoredCanonical
  storedSourceMeta: WorkflowSourceMetaV1 | null
  catalog: BlockCatalog
  /** Env names the subject's runs resolve, for `env('…')` checks. */
  envNames: ReadonlySet<string>
  /** Attribution for resource keys a submitted reference allocates. */
  createdBy: string | null
  files: Record<string, string>
  lock: WorkflowLockV1
  /** Where and when the source was read, its fingerprint already matched; absent for a create. */
  base?: SourceBase
  /** Set when the apply creates the workflow: the caller's name and description overrides. */
  create?: { name?: string; description?: string | null }
  /**
   * Whether the apply may remove blocks the source no longer declares (`--allow-delete`). Without
   * it, removing any block refuses the apply with `E_APPLY_BLOCK_DELETE`, as a workspace apply
   * refuses deleting a resource.
   */
  allowDelete?: boolean
  /**
   * Resources a workspace source apply creates or adopts before this workflow, by key, each with
   * a stand-in id: consulted after the stored keys, so a dry run of a workflow that names a table
   * created in the same apply resolves instead of failing `E_MAT_UNKNOWN_RESOURCE`.
   */
  pendingResources?: readonly PendingResource[]
}

/**
 * A resource the source names by key; `member` is the part of it a reference names, when it names
 * one: an MCP server's tool, for `mcp(key).tool(name)`.
 */
export interface SourceReference extends ResourceKeyRef {
  member?: string
  /** Where the entry file writes the reference, for an MCP tool: the agent's `tools`. */
  span?: SourceSpan
}

/** A resource an enclosing apply creates or adopts, by key, with the id that stands in for it. */
export interface PendingResource {
  kind: ResourceKind
  key: string
  id: string
  /** `id` stands in for a resource the apply has yet to create, not one it stores already. */
  placeholder?: boolean
  /** The name the apply writes it under, which a workflow's stored reference repeats (a skill). */
  name?: string
  /**
   * A table's declared column names, which the lint checks a row write against instead of the
   * stored schema the apply has yet to change.
   */
  columns?: readonly string[]
}

/** Everything a commit (or a dry run) writes and reports, once every check passed. */
export interface SourcePlan {
  /**
   * The workflow's name and description after the write: the source's (a stored workflow's
   * differ from what is stored where `metaChanged` says), or a created workflow's.
   */
  meta: CanonicalWorkflowMeta
  /** The name and description fields the write changes on a stored workflow. */
  metaChanged: Array<keyof CanonicalWorkflowMeta>
  /** The graph is unchanged; only source meta may differ. Never true for a create. */
  noop: boolean
  blocks: Record<string, BlockState>
  edges: WorkflowState['edges']
  /** The variables to write, or `undefined` when the source leaves them unchanged. */
  variables: ReturnType<typeof normalizeWorkflowVariables> | undefined
  /** Variables as the next read parses them, for re-printing what is stored. */
  storedVariables: WorkflowState['variables']
  /** Warnings (on a dry run, every finding), pinned to the submitted files. */
  diagnostics: WorkflowSourceDiagnostic[]
  diff: SourceDiffSummary
  /** Source key → id for every new block whose id was minted rather than taken from the lock. */
  mintedIds: Record<string, string>
  /** Every key the write binds, with its id: what the next print is keyed by. */
  identity: LockIdentity
  /** The post-materialize lock the compiled idents and comments are re-keyed onto. */
  lock: WorkflowLockV1
  /** The compiled file's idents, order and comments. */
  compiled: { hints: SourceHints; workflow: Pick<CanonicalWorkflow, 'annotations'> }
  /** source meta after the write, merged onto the stored one. */
  sourceMeta: WorkflowSourceMetaV1
  /** How the response prints function code: as the submission did. */
  functionCode: 'inline' | 'files'
  /** Answers every resource reference of both the stored and the submitted source. */
  resources: ResourceKeyResolver
  /** Every resource the submitted source names by key, as the compiler read it. */
  references: SourceReference[]
  /** Every env name the submitted source reads, as the compiler read it. */
  envReferences: string[]
}

/** What the submitted source references, as the compiler read it. */
export type CompiledReferences = Pick<SourcePlan, 'references' | 'envReferences'>

/**
 * A refusal, with what the source references when it compiled (so an enclosing apply can tell a
 * workflow refused for a reference it holds back), or the plan.
 */
export type SourceEvaluation =
  | {
      refused: WorkflowSourceDiagnostic[]
      compiledReferences?: CompiledReferences
    }
  | { plan: SourcePlan }
