import type { Principal } from '@sim/auth/principal'
import type {
  BaseResource,
  BlobEntry,
  FlatDiagnostic,
  KindCodec,
  WorkspaceBaseV1,
  WorkspaceKind,
} from '@sim/workspace-code'
import type { PendingResource } from '@/lib/workflows/application/source-evaluate'
import type { HashBudget } from '@/lib/workspace-source/application/hash-budget'
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
}

export interface ApplyContext extends SourceContext {
  provenance?: { client: 'cli' | 'api'; gitSha?: string }
  /** The bytes this round carries by directory path, and whether it carries all the plan needs. */
  blobs?: { content: ReadonlyMap<string, Buffer>; complete: boolean }
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

/** What an apply would do to one resource. */
export interface PlannedChange<D = unknown, P = unknown> {
  kind: WorkspaceKind
  key: string
  action: ChangeAction
  /** What changes, for the plan display (`name`, `columns.email.type`, …). */
  fields?: string[]
  /** What a delete (or a dropped column or option) loses, with counts. */
  destructive?: { what: string; counts: Record<string, number> }
  /**
   * Blob paths the change writes, whose content the request must carry. A round that carries some
   * of them writes those and leaves the rest to the next round.
   */
  needsBlobs?: string[]
  decl?: D
  storedId?: string
  /**
   * How a later kind's dry run (a workflow naming this resource by key) sees the change before it
   * is written: set by the kind on a create (a placeholder id), an adopt (the stored id), or a
   * change whose written state a dry run checks against (a reshaped table's columns).
   */
  pending?: PendingResource
  /**
   * The resource's fingerprint when planned (an update, adopt or delete): the apply re-reads it
   * with the adapter's `fingerprintNow` just before the write and refuses one that moved since.
   */
  serverFingerprint?: string
  /**
   * Resources of other kinds the change's declaration names by key, as the kind's own pipeline
   * read them (a workflow's compiled source): deleting one in the same plan refuses it, and the
   * write waits while one of them waits for a later blob round.
   */
  refs?: Array<{
    kind: WorkspaceKind
    key: string
    /** The part of the resource the reference names: an MCP server's tool. */
    member?: string
  }>
  /** The base entry a no-op records, when the directory's base lacked or misnamed it. */
  base?: BaseResource
  diagnostics: WorkspaceSourceDiagnostic[]
  /** Kind-private plan data the apply carries out (a table's column changes, …). */
  detail?: P
}

/**
 * What applying one change stored: the id, the base entry (absent for a delete, which drops it),
 * and the files reprinted from what was stored.
 */
export interface AppliedResource {
  id: string
  base?: BaseResource
  text: Record<string, string>
  diagnostics?: WorkspaceSourceDiagnostic[]
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
interface ReadResource {
  text: Record<string, string>
  blobs: ReadBlob[]
  base: BaseResource
  diagnostics?: WorkspaceSourceDiagnostic[]
}

/**
 * How workspace source reads and writes one kind. Every protected read and write goes through the
 * use cases that own the kind, so their authorization, audit and notifications apply unchanged.
 * Methods (not function properties), so the registry of adapters with different declaration and
 * state types type-checks.
 */
export interface KindAdapter<D, S, P = unknown> {
  codec: KindCodec<D>
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
    desired: Map<string, D>,
    stored: StoredSet<S>,
    ctx: PlanContext
  ): Promise<PlannedChange<D, P>[]>
  /** Throws when the principal may not make `change`, before anything is written. */
  authorize(change: PlannedChange<D, P>, ctx: SourceContext): Promise<void>
  /**
   * The stored resource's fingerprint now, as `serverFingerprint` records it at plan time. A kind
   * whose writes all carry their own atomic precondition (a file's revision) has none.
   */
  fingerprintNow?(change: PlannedChange<D, P>, ctx: SourceContext): Promise<string>
  apply(change: PlannedChange<D, P>, ctx: ApplyContext): Promise<AppliedResource>
  read(stored: StoredResource<S>, ctx: SourceContext): Promise<ReadResource>
  /**
   * Checks the members other changes name of this kind's resources (`refs` with a `member`, the
   * tools workflows call on an MCP server), adding findings to the changes that name them. Runs
   * once every kind is planned, whether or not the directory manages this kind.
   */
  checkRefs?(changes: readonly PlannedChange[], ctx: PlanContext): Promise<void>
}
