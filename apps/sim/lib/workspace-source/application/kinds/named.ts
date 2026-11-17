/**
 * The plan and write rules of a kind whose resource is one record under a unique display name
 * (custom tools by title, skills by name): keys bind to stored ids, the three-way rule decides
 * each declared resource, an unbound record of the same name is adopted, and a name another
 * resource holds is `E_NAME_TAKEN` naming that resource's key.
 */
import { db } from '@sim/db'
import { generateId } from '@sim/utils/id'
import { isRecordLike } from '@sim/utils/object'
import type { Json } from '@sim/workflow-code'
import {
  type BaseResource,
  fingerprintOf,
  KIND_DIRS,
  type KindCodec,
  type ResourceFingerprint,
  resourceAddress,
  type WorkspaceDiagnosticCode,
  type WorkspaceKind,
} from '@sim/workspace-code'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { ResourceChangedError } from '@/lib/workspace-source/application/errors'
import {
  finding,
  noBaseFinding,
  planUndeclared,
  serverChangedFinding,
  serverGoneFinding,
  staleFinding,
} from '@/lib/workspace-source/application/findings'
import { holdsIn, resolveDeclared } from '@/lib/workspace-source/application/three-way'
import type {
  AppliedResource,
  PlanContext,
  PlannedChange,
  SourceContext,
  StoredResource,
  StoredSet,
  WorkspaceSourceDiagnostic,
} from '@/lib/workspace-source/application/types'
import { claimResourceKey, readKeysByResource, resolveKeys } from '@/lib/workspaces/resource-keys'

/** How one named kind reads its stored records as declarations. */
export interface NamedKind<D, S> {
  kind: Extract<WorkspaceKind, 'custom-tool' | 'skill'>
  codec: KindCodec<D>
  /** How findings name the kind: `custom tool`, `skill`. */
  noun: string
  /** The unique display name a declaration gives its resource. */
  nameOf(decl: D): string
  /** A stored record as the declaration it prints as. */
  declOf(state: S): D
}

/** What the apply carries out for an existing record, decided at plan time. */
export interface NamedPlan {
  /** The record's fingerprint when planned; the apply refuses if it moved. */
  serverFingerprint: string
  /** The declaration fields that differ from the stored record. */
  changed: string[]
}

function storedFingerprint<D, S>(named: NamedKind<D, S>, state: S): ResourceFingerprint {
  return fingerprintOf(named.codec.canonical(named.declOf(state)))
}

/** Binds each stored record to its key: allocating missing keys for a get, never for an apply. */
export async function bindStored<S>(
  ctx: SourceContext,
  kind: NamedKind<unknown, S>['kind'],
  records: ReadonlyArray<{ id: string; name: string; state: S }>,
  allocate: boolean
): Promise<StoredSet<S>> {
  const { workspaceId } = ctx.workspace
  const ids = records.map((record) => record.id)
  const keys = allocate
    ? ((
        await resolveKeys(
          workspaceId,
          ids.map((id) => ({ kind, id })),
          { createdBy: ctx.createdBy }
        )
      ).get(kind) ?? new Map<string, string>())
    : await readKeysByResource(db, workspaceId, kind, ids)
  const set: StoredSet<S> = { bound: new Map(), unbound: [] }
  for (const record of records) {
    const key = keys.get(record.id)
    if (key === undefined) set.unbound.push({ ...record, key: '' })
    else set.bound.set(key, { ...record, key })
  }
  return set
}

/** A finding about a declared resource, pinned to the file that declares it. */
export function declaredFinding(
  kind: WorkspaceKind,
  key: string,
  file: string,
  code: WorkspaceDiagnosticCode,
  message: string,
  hint?: string
): WorkspaceSourceDiagnostic {
  return finding(code, message, { ...(hint ? { hint } : {}), file, kind, key })
}

/**
 * The named kind's resources the directory no longer declares (see {@link planUndeclared}): one a
 * declared change targets stays, and a delete of one changed on the server since the base is stale.
 */
export function planNamedUndeclared<D, S>(
  named: NamedKind<D, S>,
  desired: ReadonlyMap<string, D>,
  stored: StoredSet<S>,
  ctx: PlanContext,
  declared: ReadonlyArray<PlannedChange<D, NamedPlan>>,
  destructive: (record: StoredResource<S>) => { what: string; counts: Record<string, number> }
): PlannedChange<D, NamedPlan>[] {
  return planUndeclared<S, D, NamedPlan>(named.kind, desired, stored, ctx, destructive, {
    declared,
    fingerprint: (record) => storedFingerprint(named, record.state),
  })
}

/** The top-level declaration fields whose canonical values differ. */
function changedFields(before: Json, after: Json): string[] {
  if (!isRecordLike(before) || !isRecordLike(after)) return []
  return Object.keys(after).filter(
    (field) => fingerprintOf(after[field] as Json) !== fingerprintOf(before[field] as Json)
  )
}

/**
 * Plans one declared resource. `claimed` maps each name the directory declares so far to its key,
 * so two declarations of one name refuse; `file` is where findings about it point.
 */
export function planNamed<D, S>(
  named: NamedKind<D, S>,
  key: string,
  decl: D,
  stored: StoredSet<S>,
  ctx: PlanContext,
  file: string,
  claimed: Map<string, string>
): PlannedChange<D, NamedPlan> {
  const { kind, noun } = named
  const name = named.nameOf(decl)
  const change: PlannedChange<D, NamedPlan> = { kind, key, action: 'noop', decl, diagnostics: [] }
  const taken = (holder: string) =>
    change.diagnostics.push(
      declaredFinding(
        kind,
        key,
        file,
        'E_NAME_TAKEN',
        `The ${noun} name "${name}" belongs to ${holder}.`,
        'Rename one of them, or declare that resource under its own key.'
      )
    )
  const twin = claimed.get(name)
  if (twin !== undefined) taken(`${KIND_DIRS[kind]}/${twin}, declared in this directory too`)
  else claimed.set(name, key)

  const resolution = resolveDeclared({
    local: fingerprintOf(named.codec.canonical(decl)),
    stored: stored.bound.get(key),
    adoptable: stored.unbound.find((record) => record.name === name),
    base: ctx.base?.resources[resourceAddress(kind, key)],
    fingerprint: (record) => storedFingerprint(named, record.state),
    holds: holdsIn(stored),
  })
  const holderOf = (self?: string) => {
    const holder = [...stored.bound.values(), ...stored.unbound].find(
      (record) => record.name === name && record.id !== self
    )
    if (holder)
      taken(holder.key ? `the ${noun} under key "${holder.key}"` : `another ${noun} ("${name}")`)
  }
  switch (resolution.action) {
    case 'deleted':
      change.diagnostics.push(serverGoneFinding(kind, key, resolution.stale))
      return change
    case 'stale':
      change.diagnostics.push(staleFinding(kind, key))
      return { ...change, storedId: resolution.stored.id }
    case 'no-base':
      change.diagnostics.push(noBaseFinding(kind, key))
      return { ...change, storedId: resolution.stored.id }
    case 'noop':
      if (resolution.serverChanged) change.diagnostics.push(serverChangedFinding(kind, key))
      return {
        ...change,
        storedId: resolution.stored.id,
        ...(resolution.refreshed ? { base: baseOf(named, resolution.stored) } : {}),
      }
    case 'create':
      holderOf()
      ctx.pending.push({ kind, key, id: generateId(), name })
      return { ...change, action: 'create' }
    case 'adopt':
    case 'update': {
      const { id, state } = resolution.stored
      if (resolution.action === 'adopt') ctx.pending.push({ kind, key, id, name })
      const changed = changedFields(
        named.codec.canonical(named.declOf(state)),
        named.codec.canonical(decl)
      )
      if (named.nameOf(named.declOf(state)) !== name) holderOf(id)
      return {
        ...change,
        action: resolution.action === 'adopt' ? 'adopt' : 'update',
        storedId: id,
        ...(changed.length > 0 ? { fields: changed } : {}),
        detail: { serverFingerprint: storedFingerprint(named, state), changed },
      }
    }
  }
}

function baseOf<D, S>(named: NamedKind<D, S>, record: StoredResource<S>): BaseResource {
  return { id: record.id, fingerprint: storedFingerprint(named, record.state) }
}

/**
 * The declaration fields a planned change writes: every field of a create, only the changed ones
 * of an update or adopt. A kind checks its write rules on these alone, so a stored value an older
 * rule admitted stays as it is until a declaration changes it.
 */
export function writtenFields<D extends object>(change: PlannedChange<D, NamedPlan>): string[] {
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
export async function authorizeNamed<D>(
  change: PlannedChange<D, NamedPlan>,
  checks: NamedChecks<D>
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
 * Carries out a planned change. An update re-reads the record and refuses one that moved since
 * the plan, then sends only the changed fields so the rest stay as that check saw them. A key is
 * claimed only after its write succeeds, so a failed write leaves the key free for the next apply.
 */
export async function applyNamed<D extends object, S>(
  named: NamedKind<D, S>,
  change: PlannedChange<D, NamedPlan>,
  ctx: SourceContext,
  writes: NamedWrites<D, S>
): Promise<AppliedResource> {
  const claim = (resourceId: string, origin: 'created' | 'adopted') =>
    claimResourceKey({
      workspaceId: ctx.workspace.workspaceId,
      kind: named.kind,
      key: change.key,
      resourceId,
      origin,
      createdBy: ctx.createdBy,
    })
  if (change.action === 'delete') {
    if (!change.storedId) throw new Error(`A ${named.noun} delete needs the stored id`)
    await writes.remove(change.storedId)
    return { id: change.storedId, text: {} }
  }
  const decl = change.decl
  if (!decl) throw new Error(`A ${named.noun} write needs its declaration`)
  if (change.action === 'create') {
    const created = await writes.create(decl)
    await claim(created.id, 'created')
    return writtenRecord(named, change.key, created)
  }
  const id = change.storedId
  if (!id) throw new Error(`A ${named.noun} update needs the stored id`)
  const current = await writes.get(id)
  assertUnchanged(named, change, current)
  const changed = writtenFields(change)
  const fields: Partial<D> = {}
  for (const field of Object.keys(decl) as Array<keyof D & string>) {
    if (changed.includes(field)) fields[field] = decl[field]
  }
  const state = changed.length === 0 ? current : await writes.update(id, fields)
  if (change.action === 'adopt') await claim(id, 'adopted')
  return writtenRecord(named, change.key, { id, state })
}

/** Refuses a write to a record that changed since the plan read it. */
function assertUnchanged<D, S>(
  named: NamedKind<D, S>,
  change: PlannedChange<D, NamedPlan>,
  current: S
): void {
  if (storedFingerprint(named, current) !== change.detail?.serverFingerprint) {
    throw new ResourceChangedError(change)
  }
}

/** The base entry and reprinted files of a record as stored after a write. */
function writtenRecord<D, S>(
  named: NamedKind<D, S>,
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
export function readRecord<D, S>(named: NamedKind<D, S>, record: StoredResource<S>) {
  const decl = named.declOf(record.state)
  const printed = named.codec.print(record.key, decl)
  const parsed = named.codec.parse(record.key, printed.text, [])
  const fingerprint = storedFingerprint(named, record.state)
  if (!parsed.decl || fingerprintOf(named.codec.canonical(parsed.decl)) !== fingerprint) {
    throw new OrchestrationError(
      'validation',
      `This ${named.noun} holds a value source files cannot express, so it is left out.`
    )
  }
  return { text: printed.text, blobs: [], base: { id: record.id, fingerprint } }
}
