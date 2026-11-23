/**
 * The findings every kind reports the same way, so the plan reads alike across kinds.
 */

import { stableStringify } from '@sim/workflow-code'
import { diagnostic } from '@sim/workflow-code/diagnostics'
import {
  type BaseResource,
  type FlatDiagnostic,
  isFileKind,
  KIND_DIRS,
  resourceAddress,
  WORKSPACE_KIND_SPECS,
  type WorkspaceDiagnosticCode,
  type WorkspaceKind,
} from '@sim/workspace-code'
import { WORKSPACE_SOURCE_LIMITS } from '@sim/workspace-code/limits'
import type {
  KindChange,
  PlanContext,
  PlannedChange,
  StoredResource,
  StoredSet,
  UnavailableReference,
  WorkspaceSourceDiagnostic,
} from '@/lib/workspace-source/application/types'

/**
 * What makes two findings the same one, for a write that re-reports what its plan found (a
 * workflow's commit runs its pipeline again) with the block ids the write gave it (a workflow
 * folder's findings carry the pipeline's `blockKey` and `blockId` beside the flat fields): a finding
 * naming its block by key matches on the key, whatever id it carries, and one naming its block
 * only by id keeps the id, so two such findings on different blocks never merge.
 */
export function findingIdentity(
  diagnostic: WorkspaceSourceDiagnostic & { blockKey?: string; blockId?: string }
): string {
  return stableStringify({
    ...diagnostic,
    blockId: diagnostic.blockKey === undefined ? diagnostic.blockId : undefined,
  })
}

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
  return diagnostic(code, message, extras)
}

/** How to recover from a refusal that needs a fresh read. */
export const GET_HINT =
  'Run `sim workspaces source get` into a fresh directory, reapply your edit there, and apply again.'

/** `tables/leads`, or `secrets.ts OPENAI_API_KEY` for a root file's entry: how a finding names a resource. */
export function where(kind: WorkspaceKind, key: string): string {
  return isFileKind(kind) ? `${KIND_DIRS[kind]} ${key}` : `${KIND_DIRS[kind]}/${key}`
}

/**
 * A finding about one resource, its severity fixed by the code's prefix; `file` pins it to the
 * file that declares the resource.
 */
export function kindFinding(
  kind: WorkspaceKind,
  key: string,
  code: WorkspaceDiagnosticCode,
  message: string,
  extras: { hint?: string; file?: string } = {}
): WorkspaceSourceDiagnostic {
  return finding(code, message, {
    ...(extras.hint !== undefined ? { hint: extras.hint } : {}),
    ...(extras.file !== undefined ? { file: extras.file } : {}),
    kind,
    key,
  })
}

/** `E_APPLY_STALE`: the resource changed on the server since the directory was read. */
export function staleFinding(kind: WorkspaceKind, key: string): WorkspaceSourceDiagnostic {
  return kindFinding(
    kind,
    key,
    'E_APPLY_STALE',
    `${where(kind, key)} changed on the server since this directory was read.`,
    { hint: GET_HINT }
  )
}

/** `E_APPLY_NO_BASE`: the server holds the resource, but the directory has no base for it. */
export function noBaseFinding(kind: WorkspaceKind, key: string): WorkspaceSourceDiagnostic {
  return kindFinding(
    kind,
    key,
    'E_APPLY_NO_BASE',
    `${where(kind, key)} exists on the server, but this directory has no base for it, so the apply cannot tell your edit from a server change.`,
    { hint: GET_HINT }
  )
}

/**
 * `E_APPLY_NO_BASE` for an adopt: the server holds a resource of the declared name that no source
 * has named and this directory never read, and adopting it would change or remove `changes` of
 * what it holds.
 */
export function unreadAdoptFinding(
  kind: WorkspaceKind,
  key: string,
  name: string,
  changes: readonly string[]
): WorkspaceSourceDiagnostic {
  const noun = WORKSPACE_KIND_SPECS[kind].noun
  return kindFinding(
    kind,
    key,
    'E_APPLY_NO_BASE',
    `${where(kind, key)} declares the ${noun} "${name}", which already exists and this directory never read; adopting it would change ${changes.join(', ')}. An apply never changes or removes what the directory has not read.`,
    {
      hint: `Run \`sim workspaces source get\` into a fresh directory to read the ${noun}, then make your edit there; or give the declaration another name to create a new ${noun}.`,
    }
  )
}

/** How to bring a change made on the server into the directory. */
export const DRIFT_HINT =
  'Run `sim workspaces source get` into a fresh directory to see what changed.'

/**
 * `W_SERVER_CHANGED`: the server drifted from the directory, which leaves the resource as the
 * server has it: the apply keeps the server's version and never reverts it.
 */
export function serverChangedFinding(kind: WorkspaceKind, key: string): WorkspaceSourceDiagnostic {
  return kindFinding(
    kind,
    key,
    'W_SERVER_CHANGED',
    `${where(kind, key)} changed on the server since this directory was read; the apply keeps the server's version (not reverted).`,
    { hint: DRIFT_HINT }
  )
}

/**
 * The finding for a declared `folder` the workspace does not hold (`folders` lists the paths it
 * does), or `undefined` when the folder exists or is the root.
 */
export function missingFolderFinding(
  kind: 'table' | 'knowledge-base',
  key: string,
  folder: string | undefined,
  folders: ReadonlySet<string>
): WorkspaceSourceDiagnostic | undefined {
  if (!folder || folder === '/' || folders.has(folder)) return undefined
  return kindFinding(
    kind,
    key,
    kind === 'table' ? 'E_TABLE_FOLDER' : 'E_KB_FOLDER',
    `The folder ${folder} does not exist in this workspace.`,
    {
      hint: `Create it first (\`sim ${kind === 'table' ? 'tables' : 'knowledge'} folders create "${folder.replace(/^\//, '')}"\`), or drop \`folder\` to keep the ${WORKSPACE_KIND_SPECS[kind].noun} at the root.`,
    }
  )
}

/**
 * `E_PLAN_REF_DELETED` on `user` (a declared workflow, say) for using `ref`, which the apply
 * deletes.
 */
export function refDeletedFinding(
  user: { kind: WorkspaceKind; key: string },
  ref: { kind: WorkspaceKind; key: string }
): WorkspaceSourceDiagnostic {
  return kindFinding(
    user.kind,
    user.key,
    'E_PLAN_REF_DELETED',
    `${where(user.kind, user.key)} uses ${ref.kind} "${ref.key}", which this apply deletes.`,
    { hint: `Keep ${where(ref.kind, ref.key)}, or stop using it first.` }
  )
}

/**
 * The finding that holds back `user` (a declared workflow, say) for using `reference`, which this
 * workspace cannot satisfy.
 */
export function refUnavailableFinding(
  user: { kind: WorkspaceKind; key: string },
  reference: UnavailableReference
): WorkspaceSourceDiagnostic {
  return kindFinding(
    user.kind,
    user.key,
    reference.code,
    `${where(user.kind, user.key)} is held back: ${reference.message}`,
    { hint: reference.hint }
  )
}

/** `E_PLAN_REF_HELD` on `user` for using `ref`, which this apply holds back. */
export function refHeldFinding(
  user: { kind: WorkspaceKind; key: string },
  ref: { kind: WorkspaceKind; key: string }
): WorkspaceSourceDiagnostic {
  return kindFinding(
    user.kind,
    user.key,
    'E_PLAN_REF_HELD',
    `${where(user.kind, user.key)} is held back: it uses ${where(ref.kind, ref.key)}, which this apply holds back.`,
    { hint: `Fix what holds back ${where(ref.kind, ref.key)}, then apply again.` }
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
    return kindFinding(
      kind,
      key,
      'E_APPLY_STALE',
      `${where(kind, key)} was ${gone} since this directory was read.`,
      { hint: GET_HINT }
    )
  }
  return kindFinding(
    kind,
    key,
    movedTo === undefined ? 'W_SERVER_DELETED' : 'W_SERVER_MOVED',
    `${where(kind, key)} was ${gone}; the apply keeps it that way (not created again).`,
    { hint: DRIFT_HINT }
  )
}

/** A key that named a deleted resource now names the one this apply wrote. */
export function reboundFinding(kind: WorkspaceKind, key: string): WorkspaceSourceDiagnostic {
  return kindFinding(
    kind,
    key,
    'I_KEY_REBOUND',
    `${where(kind, key)} named a deleted ${kind}; the key now names the one this apply wrote.`
  )
}

/**
 * Whether a kind's stored set holds more resources than one directory may. A kind's load lists at
 * most a page past the limit, so a workspace over it costs one bounded read, never a full listing.
 */
export function overKindLimit(stored: StoredSet<unknown>): boolean {
  return stored.bound.size + stored.unbound.length > WORKSPACE_SOURCE_LIMITS.maxResourcesPerKind
}

/** `E_LIMIT_EXCEEDED` for a kind the workspace holds more of than one directory may. */
export function kindLimitFinding(kind: WorkspaceKind): WorkspaceSourceDiagnostic {
  const dir = KIND_DIRS[kind]
  return finding(
    'E_LIMIT_EXCEEDED',
    `This workspace has more than ${WORKSPACE_SOURCE_LIMITS.maxResourcesPerKind} ${dir}/ resources, more than one directory holds.`,
    { hint: `Leave ${dir}/ out with --only.`, kind }
  )
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
  const noun = WORKSPACE_KIND_SPECS[kind].noun
  const held =
    'declaredBy' in holder
      ? `${where(kind, holder.declaredBy)}, declared in this directory too`
      : holder.key
        ? `the ${noun} under key "${holder.key}"`
        : `another ${noun} this directory does not manage`
  return kindFinding(kind, key, 'E_NAME_TAKEN', `The ${noun} name "${name}" belongs to ${held}.`, {
    hint: 'Rename one of them, or declare that resource under its own key.',
    ...(file ? { file } : {}),
  })
}

/**
 * A declaration under a new key whose name `holder` holds, when `holder` is the resource the
 * base read under another key the directory no longer declares: the declaration's file was
 * renamed, and a key never changes (workflows name the resource by it). Returns the change that
 * refuses it as `E_KEY_RENAMED`, targeting the resource so the plan never deletes it as
 * undeclared; `undefined` when `holder` is no such resource.
 */
export function keyRenamedChange<K extends WorkspaceKind>(
  change: KindChange<K>,
  holder: StoredResource<unknown>,
  desired: ReadonlyMap<string, unknown>,
  ctx: PlanContext,
  file?: string
): KindChange<K> | undefined {
  const { kind, key } = change
  if (!holder.key || desired.has(holder.key)) return undefined
  if (ctx.base?.resources[resourceAddress(kind, holder.key)]?.id !== holder.id) return undefined
  const noun = WORKSPACE_KIND_SPECS[kind].noun
  return {
    ...change,
    action: 'noop',
    storedId: holder.id,
    diagnostics: [
      ...change.diagnostics,
      kindFinding(
        kind,
        key,
        'E_KEY_RENAMED',
        `${where(kind, key)} declares the ${noun} "${holder.name}", which this directory read as ${where(kind, holder.key)}; a ${noun}'s key never changes, since workflows name it by its key.`,
        {
          hint: `Rename it back to ${where(kind, holder.key)}; to rename the ${noun}, change its name there. A new key with a new name creates a new ${noun}.`,
          ...(file ? { file } : {}),
        }
      ),
    ],
  }
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

/** A kind's hooks for {@link planUndeclared}. */
interface UndeclaredOptions<K extends WorkspaceKind, S> {
  /** The kind's planned changes for declared resources: a resource one of them targets stays. */
  declared?: ReadonlyArray<Pick<PlannedChange, 'storedId'>>
  /**
   * The resource's fingerprint under its base entry; a delete of one that moved since, or whose
   * entry records no fingerprint to compare, is stale. Required, so no kind deletes a resource
   * edited on the server since the directory read it.
   */
  fingerprint: (resource: StoredResource<S>, base: BaseResource) => string
  /** What deleting the resource loses, beyond the resource itself (`{ rows: 12 }`). */
  counts?: (resource: StoredResource<S>) => Record<string, number>
  /** The plan data the kind's delete carries out. */
  detail?: (resource: StoredResource<S>, base: BaseResource) => KindChange<K>['detail']
  /**
   * Why the resource is locked against deletion (`Table "x" is delete-locked.`), if it is: the
   * delete is refused at plan time, as the delete use case would refuse it mid-apply.
   */
  locked?: (resource: StoredResource<S>) => string | undefined
}

/**
 * Resources the server holds that the directory does not declare. Only one the base records (so
 * this directory managed it) is deleted, and only with `--allow-delete`; anything else is kept and
 * named in a warning. A resource a declared change targets under another key (a renamed workflow
 * folder) is not undeclared, and a delete of a resource that changed on the server since the base
 * is `E_APPLY_STALE`, as an edit of it would be.
 */
export function planUndeclared<K extends WorkspaceKind, S>(
  kind: K,
  desired: ReadonlyMap<string, unknown>,
  stored: StoredSet<S>,
  ctx: PlanContext,
  options: UndeclaredOptions<K, S>
): KindChange<K>[] {
  const claimed = new Set((options.declared ?? []).map((change) => change.storedId))
  const changes: KindChange<K>[] = []
  for (const [key, resource] of stored.bound) {
    if (desired.has(key) || claimed.has(resource.id)) continue
    const entry = ctx.base?.resources[resourceAddress(kind, key)]
    const managed = entry?.id === resource.id
    if (managed && ctx.allowDelete) {
      const storedFingerprint = options.fingerprint(resource, entry)
      if (storedFingerprint !== entry.fingerprint) {
        changes.push({
          kind,
          key,
          action: 'noop',
          storedId: resource.id,
          diagnostics: [staleFinding(kind, key)],
        })
        continue
      }
      const detail = options.detail?.(resource, entry)
      const locked = options.locked?.(resource)
      changes.push({
        kind,
        key,
        action: 'delete',
        storedId: resource.id,
        destructive: {
          what: WORKSPACE_KIND_SPECS[kind].noun,
          counts: options.counts?.(resource) ?? {},
        },
        storedFingerprint,
        ...(detail !== undefined ? { detail } : {}),
        diagnostics: locked
          ? [
              kindFinding(kind, key, 'E_APPLY_LOCKED', locked, {
                hint: 'Unlock it, or restore its declaration to keep it.',
              }),
            ]
          : [],
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
          ? kindFinding(
              kind,
              key,
              'E_APPLY_DELETE_NOT_ALLOWED',
              `${where(kind, key)} is no longer declared; deleting "${resource.name}" needs --allow-delete.`,
              {
                hint:
                  kind === 'deployment'
                    ? 'Pass --allow-delete to delete it, or restore its file to keep it.'
                    : 'Pass --allow-delete to delete it, or restore its file to keep it. Run with --allow-delete --dry-run to see which workflows use it.',
              }
            )
          : kindFinding(
              kind,
              key,
              'W_UNDECLARED',
              `"${resource.name}" (${kind} ${key}) is on the server but not in this directory; it is kept.`
            ),
      ],
    })
  }
  return changes
}
