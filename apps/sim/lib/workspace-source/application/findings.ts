/**
 * The findings every kind reports the same way, so the plan reads alike across kinds.
 */
import {
  type BaseResource,
  type FlatDiagnostic,
  KIND_DIRS,
  resourceAddress,
  severityOf,
  type WorkspaceDiagnosticCode,
  type WorkspaceKind,
} from '@sim/workspace-code'
import type {
  PlanContext,
  PlannedChange,
  StoredResource,
  StoredSet,
  WorkspaceSourceDiagnostic,
} from '@/lib/workspace-source/application/types'

/**
 * One workspace source finding, its severity fixed by the code's prefix. Every finding the app
 * reports with a workspace code goes through here, so a misspelled code fails the type-check;
 * the workflow pipeline's own findings pass through as they are.
 */
export function finding(
  code: WorkspaceDiagnosticCode,
  message: string,
  extras: Omit<FlatDiagnostic, 'code' | 'severity' | 'message'> = {}
): WorkspaceSourceDiagnostic {
  return { code, severity: severityOf(code), message, ...extras }
}

/** How to recover from a refusal that needs a fresh read. */
export const GET_HINT =
  'Run `sim workspaces source get` into a fresh directory, reapply your edit there, and apply again.'

/** `tables/leads`: how a finding names a resource. */
function where(kind: WorkspaceKind, key: string): string {
  return `${KIND_DIRS[kind]}/${key}`
}

/** A finding about one resource, its severity fixed by the code's prefix. */
export function kindFinding(
  kind: WorkspaceKind,
  key: string,
  code: WorkspaceDiagnosticCode,
  message: string,
  hint?: string
): WorkspaceSourceDiagnostic {
  return finding(code, message, { ...(hint ? { hint } : {}), kind, key })
}

export function staleFinding(kind: WorkspaceKind, key: string): WorkspaceSourceDiagnostic {
  return finding(
    'E_APPLY_STALE',
    `${where(kind, key)} changed on the server since this directory was read.`,
    { hint: GET_HINT, kind, key }
  )
}

export function noBaseFinding(kind: WorkspaceKind, key: string): WorkspaceSourceDiagnostic {
  return finding(
    'E_APPLY_NO_BASE',
    `${where(kind, key)} exists on the server, but this directory has no base for it, so the apply cannot tell your edit from a server change.`,
    { hint: GET_HINT, kind, key }
  )
}

export function serverChangedFinding(kind: WorkspaceKind, key: string): WorkspaceSourceDiagnostic {
  return finding(
    'I_SERVER_CHANGED',
    `${where(kind, key)} changed on the server; this directory leaves it as it is, and the next get shows the change.`,
    { kind, key }
  )
}

/**
 * A resource the base records that the server deleted (or, with `movedTo`, moved to another key).
 * An unchanged one is left as the server has it, never created again; an edited one is stale.
 */
export function serverGoneFinding(
  kind: WorkspaceKind,
  key: string,
  stale: boolean,
  movedTo?: string
): WorkspaceSourceDiagnostic {
  const gone = movedTo === undefined ? 'deleted on the server' : `moved on the server to ${movedTo}`
  if (stale) {
    return finding(
      'E_APPLY_STALE',
      `${where(kind, key)} was ${gone} since this directory was read.`,
      {
        hint: GET_HINT,
        kind,
        key,
      }
    )
  }
  return finding(
    movedTo === undefined ? 'I_SERVER_DELETED' : 'I_SERVER_MOVED',
    `${where(kind, key)} was ${gone}; this directory does not create it again, and the next get shows that.`,
    { kind, key }
  )
}

/** A key that named a deleted resource now names the one this apply wrote. */
export function reboundFinding(kind: WorkspaceKind, key: string): WorkspaceSourceDiagnostic {
  return finding(
    'I_KEY_REBOUND',
    `${where(kind, key)} named a deleted ${kind}; the key now names the one this apply wrote.`,
    { kind, key }
  )
}

/** How findings name one resource of a kind. */
const NOUNS: Record<WorkspaceKind, string> = {
  table: 'table',
  'custom-tool': 'custom tool',
  skill: 'skill',
  'knowledge-base': 'knowledge base',
  file: 'file',
  workflow: 'workflow',
}

/** Who holds a name a declared resource wants: a stored resource, or another declaration. */
export type NameHolder = Pick<StoredResource<unknown>, 'key'> | { declaredBy: string }

/**
 * `E_NAME_TAKEN` for a declared resource whose name `holder` holds: a stored resource (under its
 * key, or one no source has named yet) or another declaration in the same directory.
 */
export function nameTakenFinding(
  kind: WorkspaceKind,
  key: string,
  name: string,
  holder: NameHolder,
  file?: string
): WorkspaceSourceDiagnostic {
  const noun = NOUNS[kind]
  const held =
    'declaredBy' in holder
      ? `${where(kind, holder.declaredBy)}, declared in this directory too`
      : holder.key
        ? `the ${noun} under key "${holder.key}"`
        : `another ${noun} this directory does not manage`
  return finding('E_NAME_TAKEN', `The ${noun} name "${name}" belongs to ${held}.`, {
    hint: 'Rename one of them, or declare that resource under its own key.',
    ...(file ? { file } : {}),
    kind,
    key,
  })
}

/**
 * The stored resource other than `self` that holds `name`; `fold` compares names
 * case-insensitively, as table names are.
 */
export function nameHolder<S>(
  stored: StoredSet<S>,
  name: string,
  options: { self?: string; fold?: boolean } = {}
): StoredResource<S> | undefined {
  const norm = (value: string) => (options.fold ? value.toLowerCase() : value)
  const wanted = norm(name)
  return [...stored.bound.values(), ...stored.unbound].find(
    (resource) => resource.id !== options.self && norm(resource.name) === wanted
  )
}

/**
 * Refuses `change` when an earlier declaration in `claimed` already gave its resource `name`
 * (already folded when the kind compares names case-insensitively), else records it. A change
 * already refused for its name keeps that one finding and claims nothing.
 */
export function refuseDeclaredTwice(
  claimed: Map<string, string>,
  change: Pick<PlannedChange, 'kind' | 'key' | 'diagnostics'>,
  name: string,
  displayName: string = name,
  file?: string
): void {
  if (change.diagnostics.some((finding) => finding.code === 'E_NAME_TAKEN')) return
  const first = claimed.get(name)
  if (first === undefined) {
    claimed.set(name, change.key)
    return
  }
  change.diagnostics.push(
    nameTakenFinding(change.kind, change.key, displayName, { declaredBy: first }, file)
  )
}

/** How {@link planUndeclared} tells a resource another change claims, or one that moved. */
interface UndeclaredOptions<S> {
  /** The kind's planned changes for declared resources: a resource one of them targets stays. */
  declared?: ReadonlyArray<Pick<PlannedChange, 'storedId'>>
  /** The resource's fingerprint under its base entry; a delete of one that moved is stale. */
  fingerprint?: (resource: StoredResource<S>, base: BaseResource) => string
}

/**
 * Resources the server holds that the directory does not declare. Only one the base records (so
 * this directory managed it) is deleted, and only with `--allow-delete`; anything else is kept and
 * named in a warning. A resource a declared change targets under another key (a renamed workflow
 * folder) is not undeclared, and a delete of a resource that changed on the server since the base
 * is `E_APPLY_STALE`, as an edit of it would be.
 */
export function planUndeclared<S, D, P>(
  kind: WorkspaceKind,
  desired: ReadonlyMap<string, D>,
  stored: StoredSet<S>,
  ctx: PlanContext,
  destructive: (resource: StoredResource<S>) => { what: string; counts: Record<string, number> },
  options: UndeclaredOptions<S> = {}
): PlannedChange<D, P>[] {
  const claimed = new Set((options.declared ?? []).map((change) => change.storedId))
  const changes: PlannedChange<D, P>[] = []
  for (const [key, resource] of stored.bound) {
    if (desired.has(key) || claimed.has(resource.id)) continue
    const entry = ctx.base?.resources[resourceAddress(kind, key)]
    const managed = entry?.id === resource.id
    if (managed && ctx.allowDelete) {
      const serverFingerprint =
        entry.fingerprint !== undefined && options.fingerprint !== undefined
          ? options.fingerprint(resource, entry)
          : undefined
      const moved = serverFingerprint !== undefined && serverFingerprint !== entry.fingerprint
      changes.push({
        kind,
        key,
        action: moved ? 'noop' : 'delete',
        storedId: resource.id,
        ...(moved ? {} : { destructive: destructive(resource) }),
        ...(serverFingerprint !== undefined && !moved ? { serverFingerprint } : {}),
        diagnostics: moved ? [staleFinding(kind, key)] : [],
      })
      continue
    }
    changes.push({
      kind,
      key,
      action: 'noop',
      storedId: resource.id,
      diagnostics: [
        managed
          ? finding(
              'E_APPLY_DELETE_NOT_ALLOWED',
              `${where(kind, key)} is no longer declared; deleting "${resource.name}" needs --allow-delete.`,
              {
                hint: 'Pass --allow-delete to delete it, or restore its file to keep it.',
                kind,
                key,
              }
            )
          : finding(
              'W_UNDECLARED',
              `"${resource.name}" (${kind} ${key}) is on the server but not in this directory; it is kept.`,
              { kind, key }
            ),
      ],
    })
  }
  return changes
}
