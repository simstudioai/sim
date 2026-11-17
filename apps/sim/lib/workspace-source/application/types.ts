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
import type { ActiveWorkspaceApplicationContext } from '@/lib/workspaces/application/context'

/** One finding of a workspace source read or apply, as the wire carries it. */
export type WorkspaceSourceDiagnostic = FlatDiagnostic

/** Who reads or applies, and in which workspace. */
export interface SourceContext {
  principal: Principal
  workspace: ActiveWorkspaceApplicationContext
  /** The human a created resource or allocated key is attributed to; `null` for a workspace key. */
  createdBy: string | null
}

export interface PlanContext extends SourceContext {
  /** The directory's base for this workspace; `null` when it has none or names another one. */
  base: WorkspaceBaseV1 | null
  allowDelete: boolean
  /**
   * Resources this apply creates in earlier kinds, by key, with the placeholder ids a later
   * kind's dry run resolves them to (a workflow naming a table created in the same apply).
   */
  pending: PendingResource[]
}

export interface ApplyContext extends SourceContext {
  provenance?: { client: 'cli' | 'api'; gitSha?: string }
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
  /** Blob paths the change writes, whose content the request must carry. */
  needsBlobs?: string[]
  decl?: D
  storedId?: string
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

/** A blob a get lists: where to download it beside its hash. */
export interface ReadBlob extends BlobEntry {
  id: string
  href: string
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
  /** `false` for a kind this release cannot apply: a managed folder of it is refused. */
  supported?: false
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
  apply(change: PlannedChange<D, P>, ctx: ApplyContext): Promise<AppliedResource>
  read(stored: StoredResource<S>, ctx: SourceContext): Promise<ReadResource>
}
