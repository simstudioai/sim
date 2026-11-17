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
  type WorkspaceKind,
} from '@sim/workspace-code'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { ResourceChangedError } from '@/lib/workspace-source/application/errors'
import {
  noBaseFinding,
  serverChangedFinding,
  staleFinding,
} from '@/lib/workspace-source/application/findings'
import { resolveDeclared } from '@/lib/workspace-source/application/three-way'
import type {
  AppliedResource,
  PlanContext,
  PlannedChange,
  SourceContext,
  StoredResource,
  StoredSet,
  WorkspaceSourceDiagnostic,
} from '@/lib/workspace-source/application/types'
import { readKeysByResource, resolveKeys } from '@/lib/workspaces/resource-keys'

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
  code: string,
  message: string,
  hint?: string
): WorkspaceSourceDiagnostic {
  return {
    code,
    severity: code.startsWith('E_') ? 'error' : code.startsWith('W_') ? 'warning' : 'info',
    message,
    ...(hint ? { hint } : {}),
    file,
    kind,
    key,
  }
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
  })
  const holderOf = (self?: string) => {
    const holder = [...stored.bound.values(), ...stored.unbound].find(
      (record) => record.name === name && record.id !== self
    )
    if (holder)
      taken(holder.key ? `the ${noun} under key "${holder.key}"` : `another ${noun} ("${name}")`)
  }
  switch (resolution.action) {
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
      ctx.pending.push({ kind, key, id: generateId() })
      return { ...change, action: 'create' }
    case 'adopt':
    case 'update': {
      const { id, state } = resolution.stored
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

/** Refuses a write to a record that changed since the plan read it. */
export function assertUnchanged<D, S>(
  named: NamedKind<D, S>,
  change: PlannedChange<D, NamedPlan>,
  current: S
): void {
  if (storedFingerprint(named, current) !== change.detail?.serverFingerprint) {
    throw new ResourceChangedError(change)
  }
}

/** The base entry and reprinted files of a record as stored after a write. */
export function writtenRecord<D, S>(
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
