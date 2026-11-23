/**
 * The plan and write rules of a kind whose resource is one record under a unique display name
 * (custom tools by title, skills by name): keys bind to stored ids, the three-way rule decides
 * each declared resource, an unbound record of the same name is adopted only when the declaration
 * matches it (see `refuseUnreadAdopt`), and a name another resource holds is `E_NAME_TAKEN` naming
 * that resource's key.
 */
import { isRecordLike } from '@sim/utils/object'
import type { Json } from '@sim/workflow-code'
import {
  type BaseResource,
  fingerprintOf,
  type KindCodec,
  type ResourceFingerprint,
  resourceAddress,
  WORKSPACE_KIND_SPECS,
  type WorkspaceKind,
} from '@sim/workspace-code'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import {
  keyRenamedChange,
  nameHolder,
  nameTakenFinding,
  planUndeclared,
  refuseDeclaredTwice,
} from '@/lib/workspace-source/application/findings'
import { pendingOf } from '@/lib/workspace-source/application/keys'
import {
  holdsIn,
  refuseUnreadAdopt,
  resolveDeclared,
  settle,
} from '@/lib/workspace-source/application/three-way'
import type {
  AppliedResource,
  DeclOf,
  KindChange,
  PlanContext,
  StoredResource,
  StoredSet,
} from '@/lib/workspace-source/application/types'

/** The kinds whose resource is one record under a unique display name. */
type NamedKindName = Extract<WorkspaceKind, 'custom-tool' | 'skill'>

/** How one named kind reads its stored records as declarations. */
export interface NamedKind<K extends NamedKindName, S> {
  kind: K
  codec: KindCodec<DeclOf<K>>
  /** The unique display name a declaration gives its resource. */
  nameOf(decl: DeclOf<K>): string
  /** A stored record as the declaration it prints as. */
  declOf(state: S): DeclOf<K>
  /**
   * A declaration read back with what it keeps of the stored record `state` resolved (a tool's
   * `stored()` code), so it compares with {@link declOf}; a kind without it keeps nothing.
   */
  resolve?(decl: DeclOf<K>, state: S): DeclOf<K>
}

/** What the apply carries out for an existing record, decided at plan time. */
export interface NamedPlan {
  /** The declaration fields that differ from the stored record. */
  changed: string[]
}

/** A stored record's fingerprint: of the declaration it prints as. */
export function storedFingerprint<K extends NamedKindName, S>(
  named: NamedKind<K, S>,
  state: S
): ResourceFingerprint {
  return fingerprintOf(named.codec.canonical(named.declOf(state)))
}

/**
 * The named kind's resources the directory no longer declares (see {@link planUndeclared}): one a
 * declared change targets stays, and a delete of one changed on the server since the base is stale.
 */
export function planNamedUndeclared<K extends NamedKindName, S>(
  named: NamedKind<K, S>,
  desired: ReadonlyMap<string, DeclOf<K>>,
  stored: StoredSet<S>,
  ctx: PlanContext,
  declared: ReadonlyArray<KindChange<K>>
): KindChange<K>[] {
  return planUndeclared(named.kind, desired, stored, ctx, {
    declared,
    fingerprint: (record) => storedFingerprint(named, record.state),
  })
}

/** The top-level declaration fields whose canonical values differ. */
export function changedFields(before: Json, after: Json): string[] {
  if (!isRecordLike(before) || !isRecordLike(after)) return []
  return Object.keys(after).filter(
    (field) => fingerprintOf(after[field] as Json) !== fingerprintOf(before[field] as Json)
  )
}

/**
 * Plans one declared resource. `claimed` maps each name the directory declares so far to its key,
 * so two declarations of one name refuse; `file` is where findings about it point.
 */
export function planNamed<K extends NamedKindName, S>(
  named: NamedKind<K, S>,
  key: string,
  decl: DeclOf<K>,
  stored: StoredSet<S>,
  desired: ReadonlyMap<string, DeclOf<K>>,
  ctx: PlanContext,
  file: string,
  claimed: Map<string, string>
): KindChange<K> {
  const { kind } = named
  const name = named.nameOf(decl)
  const change: KindChange<K> = { kind, key, action: 'noop', decl, diagnostics: [] }
  refuseDeclaredTwice(claimed, change, name, name, file)

  const resolution = resolveDeclared({
    local: fingerprintOf(named.codec.canonical(decl)),
    stored: stored.bound.get(key),
    adoptable: stored.unbound.find((record) => record.name === name),
    base: ctx.base?.resources[resourceAddress(kind, key)],
    fingerprint: (record) => storedFingerprint(named, record.state),
    holds: holdsIn(stored),
  })
  const holderOf = (self?: string) => {
    const holder = nameHolder(stored, name, { self })
    const refused = change.diagnostics.some((finding) => finding.code === 'E_NAME_TAKEN')
    if (holder && !refused) change.diagnostics.push(nameTakenFinding(kind, key, name, holder, file))
  }
  const planned = settle(resolution, change, (record) => baseOf(named, record))
  if ('settled' in planned) return planned.settled
  switch (planned.action) {
    case 'create': {
      const holder = nameHolder(stored, name)
      const renamed = holder && keyRenamedChange(change, holder, desired, ctx, file)
      if (renamed) return renamed
      holderOf()
      return {
        ...change,
        action: 'create',
        pending: pendingOf({ ...change, action: 'create' }, { name }),
      }
    }
    case 'adopt':
    case 'update': {
      const { id, state } = planned.stored
      const changed = changedFields(
        named.codec.canonical(named.declOf(state)),
        named.codec.canonical(decl)
      )
      if (planned.action === 'adopt') {
        const refused = refuseUnreadAdopt(change, planned.stored, changed)
        if (refused) return refused
      }
      if (named.nameOf(named.declOf(state)) !== name) holderOf(id)
      return {
        ...change,
        action: planned.action === 'adopt' ? 'adopt' : 'update',
        storedId: id,
        ...(planned.action === 'adopt'
          ? { pending: pendingOf({ ...change, action: 'adopt', storedId: id }, { name }) }
          : {}),
        ...(changed.length > 0 ? { fields: changed } : {}),
        storedFingerprint: storedFingerprint(named, state),
        detail: { changed },
      }
    }
  }
}

function baseOf<K extends NamedKindName, S>(
  named: NamedKind<K, S>,
  record: StoredResource<S>
): BaseResource {
  return { id: record.id, fingerprint: storedFingerprint(named, record.state) }
}

/**
 * The declaration fields a planned change writes: every field of a create, only the changed ones
 * of an update or adopt. A kind checks its write rules on these alone, so a stored value an older
 * rule admitted stays as it is until a declaration changes it.
 */
export function writtenFields(change: KindChange<NamedKindName>): string[] {
  if (change.action === 'create') return change.decl ? Object.keys(change.decl) : []
  return change.detail?.changed ?? []
}

/** The use case checks of one named kind, by the change they authorize. */
interface NamedChecks<D> {
  create(decl: D): Promise<unknown>
  update(id: string): Promise<unknown>
  remove(id: string): Promise<unknown>
}

/** Authorizes a planned change through the kind's use case checks, before anything is written. */
export async function authorizeNamed<K extends NamedKindName>(
  change: KindChange<K>,
  checks: NamedChecks<DeclOf<K>>
): Promise<void> {
  if (change.action === 'create') {
    if (change.decl) await checks.create(change.decl)
    return
  }
  if (!change.storedId) return
  if (change.action === 'delete') await checks.remove(change.storedId)
  else await checks.update(change.storedId)
}

/** The use case writes of one named kind; `update` receives only the changed fields. */
interface NamedWrites<D, S> {
  create(decl: D): Promise<{ id: string; state: S }>
  get(id: string): Promise<S>
  update(id: string, fields: Partial<D>): Promise<S>
  remove(id: string): Promise<void>
}

/**
 * Carries out a planned change (the apply already refused a record that moved since the plan).
 * An update sends only the changed fields, so the rest stay as the plan saw them.
 */
export async function applyNamed<K extends NamedKindName, S>(
  named: NamedKind<K, S>,
  change: KindChange<K>,
  writes: NamedWrites<DeclOf<K>, S>
): Promise<AppliedResource> {
  if (change.action === 'delete') {
    if (!change.storedId)
      throw new Error(`A ${WORKSPACE_KIND_SPECS[named.kind].noun} delete needs the stored id`)
    await writes.remove(change.storedId)
    return { id: change.storedId, text: {} }
  }
  const decl = change.decl
  if (!decl)
    throw new Error(`A ${WORKSPACE_KIND_SPECS[named.kind].noun} write needs its declaration`)
  if (change.action === 'create') return writtenRecord(named, change.key, await writes.create(decl))
  const id = change.storedId
  if (!id) throw new Error(`A ${WORKSPACE_KIND_SPECS[named.kind].noun} update needs the stored id`)
  const changed = writtenFields(change)
  const fields = Object.fromEntries(
    Object.entries(decl).filter(([field]) => changed.includes(field))
  ) as Partial<DeclOf<K>>
  const state = changed.length === 0 ? await writes.get(id) : await writes.update(id, fields)
  return writtenRecord(named, change.key, { id, state })
}

/** The base entry and reprinted files of a record as stored after a write. */
function writtenRecord<K extends NamedKindName, S>(
  named: NamedKind<K, S>,
  key: string,
  record: { id: string; state: S }
): AppliedResource {
  return {
    id: record.id,
    base: { id: record.id, fingerprint: storedFingerprint(named, record.state) },
    text: named.codec.print(key, named.declOf(record.state)).text,
  }
}

/**
 * A stored record as source. Refuses one whose printed files would not read back as the same
 * record (a stored value the declaration grammar cannot hold), so a get never writes a file an
 * apply would change.
 */
export function readRecord<K extends NamedKindName, S>(
  named: NamedKind<K, S>,
  record: StoredResource<S>
) {
  const decl = named.declOf(record.state)
  const printed = named.codec.print(record.key, decl)
  const parsed = named.codec.parse(record.key, printed.text, [])
  const fingerprint = storedFingerprint(named, record.state)
  const readBack = parsed.decl && (named.resolve?.(parsed.decl, record.state) ?? parsed.decl)
  if (!readBack || fingerprintOf(named.codec.canonical(readBack)) !== fingerprint) {
    throw new OrchestrationError(
      'validation',
      `This ${WORKSPACE_KIND_SPECS[named.kind].noun} holds a value source files cannot express, so it is left out.`
    )
  }
  return { text: printed.text, blobs: [], base: { id: record.id, fingerprint } }
}
