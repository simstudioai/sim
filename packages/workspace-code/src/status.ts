/**
 * What `status` reports about a source directory, from the two sides it compares: the files on
 * disk against the digests the CLI recorded when it last wrote them (local changes), and the
 * findings a dry run of the directory returns (what changed on the server since the base). The
 * server's three-way rule decides drift; this module only reads its findings, so the CLI never
 * restates the plan.
 *
 * Client-safe: no Node built-ins, so the CLI and the server's tests share one reading.
 */
import { compareStrings } from '@sim/utils/string'
import type { WorkspaceDiagnosticCode } from './diagnostics'
import { isFileKind, isWorkspaceKind, type WorkspaceKind } from './kind'
import { KIND_LAYOUTS } from './kinds/registry'
import { kindOfPath } from './layout'

/** How a file differs from what the CLI last wrote there. */
export type FileChange = 'created' | 'edited' | 'deleted'

/** One file that differs from what the CLI last wrote there. */
export interface ChangedFile {
  path: string
  change: FileChange
}

/** How a resource changed on the server since the directory's base. */
type ServerChange = 'changed' | 'deleted' | 'moved' | 'added'

/** A resource with local changes: its files, and the change they add up to. */
export interface LocalResourceChange {
  kind: WorkspaceKind
  key: string
  change: FileChange
  files: ChangedFile[]
}

/** A resource the server changed since the directory's base. */
export interface ServerResourceChange {
  kind: WorkspaceKind
  key: string
  server: ServerChange
}

/** A resource changed on both sides: applying it is refused as stale. */
interface ConflictingChange extends ServerResourceChange {
  change: FileChange
}

/**
 * The directory's state, most pressing first: `conflict` (a resource changed on both sides),
 * `drift` (the server changed resources the directory leaves alone), `local` (only local
 * changes), `clean`.
 */
type SourceState = 'clean' | 'local' | 'drift' | 'conflict'

/** What `status` reports: the state, and the resources behind it. */
export interface SourceStatus {
  state: SourceState
  local: LocalResourceChange[]
  /** Server changes to resources without local changes. */
  drift: ServerResourceChange[]
  conflicts: ConflictingChange[]
}

/**
 * The files of `current` (path → digest of the file on disk) that differ from `recorded` (path →
 * digest the CLI last wrote), plus the recorded files no longer on disk that `tracked` accepts (a
 * file of a kind the directory stopped managing is not a delete). Sorted by path.
 */
export function changedFiles(
  current: Readonly<Record<string, string>>,
  recorded: Readonly<Record<string, string>>,
  tracked: (path: string) => boolean
): ChangedFile[] {
  const changed: ChangedFile[] = []
  for (const [path, digest] of Object.entries(current)) {
    if (!Object.hasOwn(recorded, path)) changed.push({ path, change: 'created' })
    else if (recorded[path] !== digest) changed.push({ path, change: 'edited' })
  }
  for (const path of Object.keys(recorded)) {
    if (!Object.hasOwn(current, path) && tracked(path)) changed.push({ path, change: 'deleted' })
  }
  return changed.sort((a, b) => compareStrings(a.path, b.path))
}

/** The change a resource's files add up to: created or deleted when every file was, else edited. */
export function resourceChange(files: readonly ChangedFile[]): FileChange {
  const [first] = files
  return files.every((file) => file.change === first.change) && first.change !== 'edited'
    ? first.change
    : 'edited'
}

/**
 * Workspace directory changes grouped by the resource each file belongs to (its kind, and the key
 * its kind's layout groups it under; a file the layout places under none is keyed by its path). A
 * file outside every kind's folder belongs to no kind and is left out.
 */
export function localResourceChanges(files: readonly ChangedFile[]): LocalResourceChange[] {
  const byKind = new Map<WorkspaceKind, ChangedFile[]>()
  for (const file of files) {
    const kind = kindOfPath(file.path)
    if (kind === null) continue
    const kindFiles = byKind.get(kind)
    if (kindFiles) kindFiles.push(file)
    else byKind.set(kind, [file])
  }
  const changes: LocalResourceChange[] = []
  for (const [kind, kindFiles] of byKind) {
    const byPath = new Map(kindFiles.map((file) => [file.path, file]))
    const { groups } = KIND_LAYOUTS[kind].group(kindFiles.map((file) => file.path))
    for (const [key, paths] of groups) {
      const grouped = paths.flatMap((path) => byPath.get(path) ?? [])
      for (const path of paths) byPath.delete(path)
      if (grouped.length > 0) {
        changes.push({ kind, key, change: resourceChange(grouped), files: grouped })
      }
    }
    // A file the layout groups under no resource (a misplaced name) is still a change: its path
    // stands in for the key, so the apply's finding about it can be found.
    for (const file of byPath.values()) {
      changes.push({ kind, key: file.path, change: file.change, files: [file] })
    }
  }
  return changes.sort((a, b) => compareStrings(a.kind, b.kind) || compareStrings(a.key, b.key))
}

/**
 * The plan findings that say a resource changed on the server since the base, and what each
 * means. `E_APPLY_STALE` is a change on both sides when the resource has local changes; a
 * workflow folder sent whole with none reports a server edit the same way. `W_UNDECLARED` is a
 * resource the server holds that the base never recorded (added since the get), and
 * `E_APPLY_NO_BASE` one the server added under a key the directory also declares.
 */
const SERVER_FINDINGS: ReadonlyMap<string, ServerChange> = new Map(
  Object.entries({
    W_SERVER_CHANGED: 'changed',
    W_SERVER_DELETED: 'deleted',
    W_SERVER_MOVED: 'moved',
    W_PROMOTE_TARGET_DELETED: 'deleted',
    E_APPLY_STALE: 'changed',
    W_UNDECLARED: 'added',
    E_APPLY_NO_BASE: 'added',
  } satisfies Partial<Record<WorkspaceDiagnosticCode, ServerChange>>)
)

/** The codes {@link serverResourceChanges} reads: a status counts none of them as an error. */
export function isServerChangeFinding(code: string): boolean {
  return SERVER_FINDINGS.has(code)
}

/**
 * The resources a dry run's findings say changed on the server since the base, one entry per
 * resource. A finding without a resource kind and key is about the whole apply and names none.
 */
export function serverResourceChanges(
  diagnostics: ReadonlyArray<{ code: string; kind?: string; key?: string }>
): ServerResourceChange[] {
  const changes = new Map<string, ServerResourceChange>()
  for (const finding of diagnostics) {
    const server = SERVER_FINDINGS.get(finding.code)
    const { kind, key } = finding
    if (!server || kind === undefined || key === undefined || !isWorkspaceKind(kind)) continue
    const address = `${kind}:${key}`
    if (!changes.has(address)) changes.set(address, { kind, key, server })
  }
  return [...changes.values()].sort(
    (a, b) => compareStrings(a.kind, b.kind) || compareStrings(a.key, b.key)
  )
}

/**
 * The status of a directory from its local changes and, when the server answered, the server's
 * changes: a server change to a resource with local changes is a conflict, any other is drift. A
 * kind one root file declares (`secrets.ts`) groups its file under the file's name, not the
 * entries the server names, so any change to that file meets every server change of its kind.
 */
export function sourceStatus(
  local: readonly LocalResourceChange[],
  server: readonly ServerResourceChange[]
): SourceStatus {
  const firstOfResource = new Map<string, LocalResourceChange>()
  const firstOfKind = new Map<string, LocalResourceChange>()
  for (const entry of local) {
    const address = `${entry.kind}:${entry.key}`
    if (!firstOfResource.has(address)) firstOfResource.set(address, entry)
    if (!firstOfKind.has(entry.kind)) firstOfKind.set(entry.kind, entry)
  }
  const conflicts: ConflictingChange[] = []
  const drift: ServerResourceChange[] = []
  for (const change of server) {
    const mine = isFileKind(change.kind)
      ? firstOfKind.get(change.kind)
      : firstOfResource.get(`${change.kind}:${change.key}`)
    if (mine) conflicts.push({ ...change, change: mine.change })
    else drift.push(change)
  }
  const state: SourceState =
    conflicts.length > 0
      ? 'conflict'
      : drift.length > 0
        ? 'drift'
        : local.length > 0
          ? 'local'
          : 'clean'
  return { state, local: [...local], drift, conflicts }
}
