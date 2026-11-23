import type { Principal } from '@sim/auth/principal'
import type { SourceSpan } from '@sim/workflow-code'
import type {
  BaseResource,
  BlobEntry,
  FlatDiagnostic,
  KindCodec,
  WorkspaceBaseV1,
  WorkspaceDiagnosticCode,
  WorkspaceKind,
} from '@sim/workspace-code'
import type { CredentialsDecl } from '@sim/workspace-code/kinds/credentials'
import type { DeploymentDecl } from '@sim/workspace-code/kinds/deployment'
import type { FileDecl } from '@sim/workspace-code/kinds/files'
import type { KnowledgeBaseDecl } from '@sim/workspace-code/kinds/knowledge'
import type { McpServerDecl } from '@sim/workspace-code/kinds/mcp'
import type { SecretDecl, SecretsDecl } from '@sim/workspace-code/kinds/secrets'
import type { SkillDecl } from '@sim/workspace-code/kinds/skills'
import type { TableDecl } from '@sim/workspace-code/kinds/table'
import type { ToolDecl } from '@sim/workspace-code/kinds/tools'
import type { WorkflowDecl } from '@sim/workspace-code/kinds/workflow'
import type { PendingResource, SourceLoads } from '@/lib/workflows/application/source-pipeline'
import type { HashBudget } from '@/lib/workspace-source/application/hash-budget'
import type { CredentialPlan } from '@/lib/workspace-source/application/kinds/credentials/adapter'
import type { DeploymentPlan } from '@/lib/workspace-source/application/kinds/deployment/adapter'
import type { FilePlan } from '@/lib/workspace-source/application/kinds/files/adapter'
import type { KnowledgePlan } from '@/lib/workspace-source/application/kinds/knowledge/adapter'
import type { McpPlan } from '@/lib/workspace-source/application/kinds/mcp/adapter'
import type { NamedPlan } from '@/lib/workspace-source/application/kinds/named'
import type { TablePlan } from '@/lib/workspace-source/application/kinds/table/adapter'
import type { WorkflowPlan } from '@/lib/workspace-source/application/kinds/workflow/adapter'
import type { ActiveWorkspaceApplicationContext } from '@/lib/workspaces/application/context'

/** One finding of a workspace source read or apply, as the wire carries it. */
export type WorkspaceSourceDiagnostic = FlatDiagnostic

/** Who reads or applies, and in which workspace. */
export interface SourceContext {
  principal: Principal
  workspace: ActiveWorkspaceApplicationContext
  /** The human a created resource or allocated key is attributed to; `null` for a workspace key. */
  createdBy: string | null
  /** What the request may still download to hash; spread copies of the context share it. */
  hashBudget: HashBudget
  /** Workspace-wide admissions this request already ran, by key (see `admitOnce`). */
  admitted: Map<string, Promise<unknown>>
  /** What every workflow this request evaluates loads the same (its catalog gate, env names). */
  loads: SourceLoads
  /**
   * Workspace-wide listings this request already started, reused by every kind and check that
   * needs one; spread copies of the context share it.
   */
  listings: SourceListings
}

/** Listings one request makes once (see `SourceContext.listings`). */
interface SourceListings {
  /** The workspace's deployed workflows. */
  deployedWorkflows?: Promise<ReadonlyArray<{ id: string; name: string }>>
}

export interface PlanContext extends SourceContext {
  /** The directory's base for this workspace; `null` when it has none or names another one. */
  base: WorkspaceBaseV1 | null
  allowDelete: boolean
  /**
   * Resources this apply creates or adopts in earlier kinds, by key, with the ids a later kind's
   * dry run resolves them to (a placeholder for a create, the stored id for an adopt).
   */
  pending: PendingResource[]
  /** The changes the kinds before this one planned, in apply order. */
  planned: readonly PlannedChange[]
}

export interface ApplyContext extends SourceContext {
  provenance?: { client: 'cli' | 'api'; gitSha?: string; repo?: string }
  /**
   * The `sf1:` fingerprint of each draft this apply's workflow writes stored, by workflow id: a
   * later deploy of that workflow publishes exactly that draft.
   */
  writtenDrafts: Map<string, string>
  /**
   * Reads the staged bytes of a blob a write needs, by directory path, checked against its
   * SHA-256. Loaded one blob at a time, so a write never holds more than it is writing. A write
   * calls `stored` once the workspace holds a blob's bytes, which consumes its staged copy (it
   * stops counting toward the payer's quota), so a write that fails partway still consumes those
   * it stored.
   */
  blobs?: { read(path: string): Promise<Buffer>; stored(path: string): void }
}

/** A stored resource of one kind: its key (when bound), id, display name and kind state. */
export interface StoredResource<S> {
  key: string
  id: string
  name: string
  state: S
}

/** A kind's stored resources: those bound to a key, and those no source has named yet. */
export interface StoredSet<S> {
  bound: Map<string, StoredResource<S>>
  unbound: StoredResource<S>[]
}

export type ChangeAction = 'create' | 'update' | 'adopt' | 'delete' | 'noop'

/**
 * A declared reference this workspace cannot satisfy (a secret it holds no value for, a credential
 * key nothing binds to): the plan holds back every change that uses it, with this finding, and
 * applies the rest.
 */
export interface UnavailableReference {
  code: Extract<WorkspaceDiagnosticCode, `E_${string}`>
  /** Why, naming the reference; the finding on each change that uses it says which change. */
  message: string
  hint: string
}

/** What a change records whatever its kind (see {@link KindChange}). */
interface ChangeFields {
  key: string
  action: ChangeAction
  /** What changes, for the plan display (`name`, `columns.email.type`, …). */
  fields?: string[]
  /** What a delete (or a dropped column or option) loses, with counts. */
  destructive?: { what: string; counts: Record<string, number> }
  /**
   * Blob paths the change writes: their bytes must be staged before an apply, which is refused
   * (nothing written) while any is missing.
   */
  needsBlobs?: string[]
  storedId?: string
  /**
   * How a later kind's dry run (a workflow naming this resource by key) sees the change before it
   * is written: set by the kind on a create (a placeholder id), an adopt (the stored id), or a
   * change whose written state a dry run checks against (a reshaped table's columns).
   */
  pending?: PendingResource
  /**
   * The resource's fingerprint when planned (an update, adopt or delete): the apply re-reads it
   * with the adapter's `storedFingerprintNow` just before the write and refuses one that moved since.
   */
  storedFingerprint?: string
  /**
   * Resources of other kinds the change's declaration names by key, as the kind's own pipeline
   * read them (a workflow's compiled source): deleting one in the same plan refuses it.
   */
  refs?: Array<{
    kind: WorkspaceKind
    key: string
    /** The part of the resource the reference names: an MCP server's tool. */
    member?: string
    /** Where the declaration's entry file writes the reference, when the pipeline located it. */
    span?: SourceSpan
    /**
     * The resource's id, for a kind keyed otherwise than a workflow names it (a workspace file,
     * keyed by its path): the plan finds that kind's change by id and names it by its key.
     */
    id?: string
  }>
  /** The base entry a no-op records, when the directory's base lacked or misnamed it. */
  base?: BaseResource
  /**
   * A workflow change's blocks as its write leaves the graph, block id to normalized name, from
   * the plan's evaluation: a later kind checks the blocks it names (a chat's outputs) against the
   * edited graph, not the stored one. Absent when the workflow did not evaluate (its own errors
   * refuse).
   */
  blocks?: ReadonlyMap<string, string>
  /**
   * Set by a reference kind on its own change when the declared reference cannot be satisfied:
   * every change whose `refs` name it is held back.
   */
  unavailable?: UnavailableReference
  /**
   * The change uses an unavailable reference (or a change held for one), so it is not written;
   * its errors hold it alone back rather than refuse the apply.
   */
  held?: true
  diagnostics: WorkspaceSourceDiagnostic[]
}

/**
 * Each kind's declaration and the kind-private plan data its apply carries out (a table's column
 * changes, …). Indexed by every `WorkspaceKind`, so a new kind fails to type-check until it has an
 * entry here.
 */
interface KindChangeTypes {
  secret: { decl: SecretsDecl; detail: SecretDecl }
  credential: { decl: CredentialsDecl; detail: CredentialPlan }
  'custom-tool': { decl: ToolDecl; detail: NamedPlan }
  skill: { decl: SkillDecl; detail: NamedPlan }
  'mcp-server': { decl: McpServerDecl; detail: McpPlan }
  table: { decl: TableDecl; detail: TablePlan }
  'knowledge-base': { decl: KnowledgeBaseDecl; detail: KnowledgePlan }
  file: { decl: FileDecl; detail: FilePlan }
  workflow: { decl: WorkflowDecl; detail: WorkflowPlan }
  deployment: { decl: DeploymentDecl; detail: DeploymentPlan }
}

/** The declaration type of kind `K`. */
export type DeclOf<K extends WorkspaceKind> = KindChangeTypes[K]['decl']

/**
 * What an apply would do to one resource of kind `K`. Helpers generic over the kind build this;
 * for a concrete kind it is the {@link PlannedChange} member of that kind.
 */
export interface KindChange<K extends WorkspaceKind> extends ChangeFields {
  kind: K
  decl?: DeclOf<K>
  detail?: KindChangeTypes[K]['detail']
}

/**
 * What an apply would do to one resource, discriminated by `kind`: checking the kind narrows
 * `decl` and `detail`. `PlannedChange<K>` is the member of kind `K`.
 */
export type PlannedChange<K extends WorkspaceKind = WorkspaceKind> = Extract<
  { [Kind in WorkspaceKind]: KindChange<Kind> }[WorkspaceKind],
  { kind: K }
>

/**
 * What applying one change stored: the id, the base entry (absent for a delete, which drops it),
 * and the files reprinted from what was stored.
 */
export interface AppliedResource {
  id: string
  base?: BaseResource
  text: Record<string, string>
  diagnostics?: WorkspaceSourceDiagnostic[]
  /** The write bound its source key itself, in its own transaction: the apply claims nothing. */
  keyClaimed?: true
}

/**
 * A blob a get lists: where to download it beside its hash. A blob listed without `sha256` is one
 * the server did not hash within the request's budget; the client hashes the bytes it downloads
 * and records them in the base with `id` and `rev`.
 */
export interface ReadBlob extends Omit<BlobEntry, 'sha256'> {
  sha256?: string
  id: string
  href: string
  /** The content revision, present when `sha256` is absent. */
  rev?: string
}

/** One stored resource as source. */
export interface ReadResource {
  text: Record<string, string>
  blobs: ReadBlob[]
  base: BaseResource
  diagnostics?: WorkspaceSourceDiagnostic[]
}

/**
 * How workspace source reads and writes one kind. Every protected read and write goes through the
 * use cases that own the kind, so their authorization, audit and notifications apply unchanged.
 * Methods (not function properties), so the registry of adapters with different state types
 * type-checks.
 */
export interface KindAdapter<K extends WorkspaceKind, S> {
  codec: KindCodec<DeclOf<K>>
  /**
   * When a write claims its source key: by default a create or adopt claims it once written;
   * `every-write` claims on an update too (a renamed workflow folder moves its key). A kind whose
   * codec keys resources by path (a file) never claims one.
   */
  keys?: 'every-write'
  /**
   * The kind's stored resources. `allocate` binds a key to every unbound one (a get does; an
   * apply never does, so an unbound resource can still be adopted by name).
   */
  load(ctx: SourceContext, options: { allocate: boolean }): Promise<StoredSet<S>>
  /** Plans every declared and stored resource of the kind; `desired` is keyed by source key. */
  plan(
    desired: Map<string, DeclOf<K>>,
    stored: StoredSet<S>,
    ctx: PlanContext
  ): Promise<PlannedChange<K>[]>
  /** Throws when the principal may not make `change`, before anything is written. */
  authorize(change: PlannedChange<K>, ctx: SourceContext): Promise<void>
  /**
   * The stored resource's fingerprint now, as `storedFingerprint` records it at plan time. A kind
   * whose writes all carry their own atomic precondition (a file's revision) has none.
   */
  storedFingerprintNow?(change: PlannedChange<K>, ctx: SourceContext): Promise<string>
  apply(change: PlannedChange<K>, ctx: ApplyContext): Promise<AppliedResource>
  read(stored: StoredResource<S>, ctx: SourceContext): Promise<ReadResource>
  /**
   * Reads many stored resources together, for a kind whose reads share work (one authorization,
   * catalog gate and graph load for every workflow): each resource's read, or the error that kept
   * it from being read, by key. A kind without it is read one resource at a time with `read`.
   */
  readMany?(stored: StoredResource<S>[], ctx: SourceContext): Promise<Map<string, ReadOutcome>>
  /**
   * Checks the members other changes name of this kind's resources (`refs` with a `member`, the
   * tools workflows call on an MCP server), adding findings to the changes that name them. Runs
   * once every kind is planned, whether or not the directory manages this kind.
   */
  checkRefs?(changes: readonly PlannedChange[], ctx: PlanContext): Promise<void>
  /**
   * The files of a kind one root file declares whole (`secrets.ts`), printed from the stored
   * resources a get read: each `read` records its base entry and no text, and this prints the one
   * file they share. A folder kind prints each resource in `read` and has none.
   */
  printAll?(read: readonly StoredResource<S>[]): Record<string, string>
}

/** One resource of a batched read: what was read, or the error that kept it from being read. */
export type ReadOutcome = { read: ReadResource } | { error: unknown }
