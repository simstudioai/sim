/**
 * `sim workspaces source status` and `sim workspaces source diff`: what changed in a workspace
 * source directory since it was read, on either side, without applying anything. Local changes
 * come from the file digests `.sim/written.json` records; the server's come from a dry run of
 * the directory (its findings name every resource changed since the base), and the base text a
 * diff shows from the server's current source where it still prints what the directory was read
 * at.
 */
import { isRecordLike, toRecord } from '@sim/utils/object'
import { compareStrings } from '@sim/utils/string'
import { utf8Bytes } from '@sim/workflow-code/limits'
import { isWorkspaceKind, KIND_DIRS, type WorkspaceKind } from '@sim/workspace-code'
import { isBlobPath, KIND_LAYOUTS } from '@sim/workspace-code/kinds/registry'
import { kindOfPath, WORKSPACE_BASE_FILE, WORKSPACE_SKIPPED_FILE } from '@sim/workspace-code/layout'
import { WORKSPACE_SOURCE_LIMITS } from '@sim/workspace-code/limits'
import {
  type ChangedFile,
  changedFiles,
  isServerChangeFinding,
  localResourceChanges,
  type SourceStatus,
  serverResourceChanges,
  sourceStatus,
} from '@sim/workspace-code/status'
import type { Command } from 'commander'
import { profileFrom } from '../../context'
import { setSoftExitCode } from '../../embed-context'
import type {
  ApplyWorkspaceSourceBody,
  ApplyWorkspaceSourceResponse,
  GetWorkspaceSourceResponse,
} from '../../generated/v2-api'
import { SimApiError } from '../../http/client'
import { apiCommand, type Connection } from '../../runtime/called-operations'
import {
  digest,
  readSourceJson,
  readSourceText,
  readWritten,
  SOURCE_DIR_BUSY_HELP,
  SOURCE_WRITTEN_FILE,
  type Written,
  withSourceDirLock,
} from './source-dir'
import {
  baseUnavailable,
  DIFF_HELP,
  type DiffReport,
  type FileDiff,
  loginCommand,
  type NextStep,
  nextStep,
  pathFilter,
  printDiffReport,
  printStatusReport,
  type ServerCheck,
  STATUS_EXIT_CODES_HELP,
  type StatusReport,
  statusExitCode,
  textDiff,
  unreachableReason,
} from './source-status'
import { withSourceExitCode } from './source-tree'
import { destructiveChanges } from './workspace-source-apply'
import {
  assertWorkspaceDir,
  readWorkspaceDir,
  type WorkspaceSubmission,
  withUnchangedWorkflowsPruned,
} from './workspace-source-dir'
import { ONLY_KINDS_HELP, parseKinds } from './workspace-source-get'

type ApplyData = ApplyWorkspaceSourceResponse['data']
type ServerSource = GetWorkspaceSourceResponse['data']

const PREFIX = 'sim workspaces source'

/** A status or diff only reads: in a directory no one may write, it runs without the lock. */
const READ_ONLY = { readOnly: true }

/** The workspace directory as a status reads it, once. */
interface LocalWorkspace {
  submission: WorkspaceSubmission
  written: Written
  changed: ChangedFile[]
  /** The workspace `.sim/base.json` names, or `null` without one. */
  readFrom: string | null
}

/**
 * Reads the directory with every workflow folder whole, and the files that differ from what the
 * CLI last wrote. A recorded file that is missing is deleted, as a get counts it (a get refuses to
 * write it again), whether or not its kind's folder is still there; `--only` limits both sides to
 * its kinds. A directory holding no workspace source (a mistyped `--dir`, a workflow folder) is
 * refused as an apply refuses it, rather than reported clean.
 */
async function readLocalWorkspace(
  dir: string,
  only: readonly WorkspaceKind[] | undefined
): Promise<LocalWorkspace> {
  await assertWrittenReadable(dir)
  const written = await readWritten(dir)
  const base = toRecord(await readSourceJson(dir, WORKSPACE_BASE_FILE))
  const readFrom = typeof base.workspaceId === 'string' ? base.workspaceId : null
  const submission = await readWorkspaceDir(dir, only, readFrom ?? '', written, { whole: true })
  if (submission.kinds.length === 0 || typeof base.workflowId === 'string') {
    await assertWorkspaceDir(dir)
  }
  const current: Record<string, string> = {}
  for (const [path, text] of Object.entries(submission.files)) current[path] = digest(text)
  for (const blob of submission.blobs) current[blob.path] = blob.sha256
  const changed = changedFiles(current, written.digests, (path) => {
    const kind = kindOfPath(path)
    return kind !== null && (!only || only.includes(kind))
  })
  return { submission, written, changed, readFrom }
}

/**
 * Refuses a `.sim/written.json` that is there but does not read as a record (a merge conflict left
 * markers in it): without it every file would read as created, and the status would recommend an
 * apply. A get rewrites it, and refuses, naming them, to replace files that differ from the server.
 */
async function assertWrittenReadable(dir: string): Promise<void> {
  const text = await readSourceText(dir, SOURCE_WRITTEN_FILE)
  if (text === null) return
  let record: unknown
  try {
    record = JSON.parse(text)
  } catch {}
  if (isRecordLike(record) && isRecordLike(record.files)) return
  throw new SimApiError(
    `${SOURCE_WRITTEN_FILE} in ${dir} is not a record the CLI wrote (a merge conflict?), so local changes cannot be told from what the last get or apply wrote. Restore it from version control, or run \`${PREFIX} get --dir ${dir}\`: it rewrites it, and refuses to replace a file that differs from the server.`,
    0,
    'SOURCE_WRITTEN_INVALID'
  )
}

/** Every path the directory holds or its record names: what a diff's filters must select from. */
function localPaths(local: LocalWorkspace): string[] {
  return [
    ...Object.keys(local.submission.files),
    ...local.submission.blobs.map((blob) => blob.path),
    ...Object.keys(local.written.digests),
  ]
}

/**
 * The workspace a status or diff asks about: the one `--workspace` names, else the one the
 * directory was read from, else the profile's.
 */
function targetWorkspace(
  connection: Connection<'applyWorkspaceSource' | 'getWorkspaceSource'>,
  readFrom: string | null
): string {
  const { client, profile } = connection
  return profile.sources.workspaceId === 'flag' || readFrom === null
    ? client.requireWorkspace()
    : readFrom
}

/** The resources `.sim/skipped.json` lists: never written by a get, so never drift. */
async function skippedResources(dir: string): Promise<Set<string>> {
  const skipped = await readSourceJson(dir, WORKSPACE_SKIPPED_FILE)
  if (!Array.isArray(skipped)) return new Set()
  return new Set(
    skipped.flatMap((entry) =>
      isRecordLike(entry) && typeof entry.kind === 'string' && typeof entry.key === 'string'
        ? [`${entry.kind}:${entry.key}`]
        : []
    )
  )
}

/** The dry run's summary: what applying would write, and its findings left over. */
interface WorkspacePlanSummary {
  create: number
  update: number
  delete: number
  unchanged: number
  held: number
  /** Errors other than the server changes the status lists. */
  errors: number
  warnings: number
}

function planSummary(data: ApplyData): WorkspacePlanSummary {
  const count = (...actions: string[]) =>
    data.plan.filter((change) => actions.includes(change.action)).length
  const findings = (severity: string) =>
    data.diagnostics.filter(
      (finding) => finding.severity === severity && !isServerChangeFinding(finding.code)
    ).length
  return {
    create: count('create'),
    update: count('update', 'adopt'),
    delete: count('delete'),
    unchanged: count('noop'),
    held: data.plan.filter((change) => change.held).length,
    errors: findings('error'),
    warnings: findings('warning'),
  }
}

function planLine(plan: WorkspacePlanSummary): string {
  return `Applying would: ${plan.create} create, ${plan.update} update, ${plan.delete} delete (${plan.unchanged} unchanged); ${plan.errors} error(s), ${plan.warnings} warning(s).`
}

/**
 * Whether one dry run can compare every workflow folder whole: within the workflows and bytes
 * one apply evaluates. Past either, the status sends unchanged folders by their base, as an apply
 * does, and says their server edits went unchecked.
 */
function fitsWhole(files: Readonly<Record<string, string>>): boolean {
  const paths = Object.keys(files).filter((path) => kindOfPath(path) === 'workflow')
  const folders = KIND_LAYOUTS.workflow.group(paths).groups.size
  const bytes = paths.reduce((sum, path) => sum + utf8Bytes(files[path]), 0)
  return (
    folders <= WORKSPACE_SOURCE_LIMITS.maxWorkflows &&
    bytes <= WORKSPACE_SOURCE_LIMITS.maxWorkflowBytes
  )
}

/**
 * The next command when every local change is a file of a kind whose folder (or root file) the
 * directory no longer holds, so it stopped managing that kind: an apply leaves those resources
 * alone and the files stay deleted here, while a get refuses to write them again. The get that
 * restores the kind, with `--force` limited to it; `null` otherwise (a conflict, or a change an
 * apply would write, comes first).
 */
function unmanagedNext(
  status: SourceStatus,
  managed: readonly WorkspaceKind[],
  dir: string,
  workspaceScope: string
): NextStep | null {
  if (status.conflicts.length > 0 || status.local.length === 0) return null
  if (status.local.some((entry) => managed.includes(entry.kind))) return null
  const folders = [...new Set(status.local.map((entry) => KIND_DIRS[entry.kind]))]
  const named = folders.join(', ')
  return {
    command: `${PREFIX} get --dir ${dir} --only ${folders.join(',')} --force${workspaceScope}`,
    reason: `${named} ${folders.length === 1 ? 'is' : 'are'} gone, so this directory no longer manages ${folders.length === 1 ? 'that kind' : 'those kinds'} and an apply leaves their resources alone: this get writes ${folders.length === 1 ? 'it' : 'them'} back. To delete the resources instead, recreate ${folders.length === 1 ? 'it' : 'them'} without them (an emptied folder keeps a .gitkeep) and apply with --allow-delete.`,
  }
}

interface StatusOptions {
  dir: string
  only?: string
  offline?: boolean
  json?: boolean
}

/**
 * `sim workspaces source status [--dir <dir>]`: the local changes since the directory was read,
 * and (unless `--offline`, or when the server cannot be reached) what a dry run says changed on
 * the server since: drift, and conflicts where both sides changed. Ends with the next command.
 */
export function attachWorkspaceSourceStatus(source: Command): void {
  const [command, connect] = apiCommand(source, 'status', ['applyWorkspaceSource'])
  command
    .option('--dir <dir>', 'Workspace source directory written by `workspaces source get`', '.')
    .option('--only <kinds>', `Report only these kinds (${ONLY_KINDS_HELP})`)
    .option('--offline', 'Report local changes only, without asking the server')
    .option('--json', 'Print the machine-readable status (same as --output json)')
    .allowExcessArguments(false)
    .description('Show what changed locally and on the server since the directory was read')
    .addHelpText('after', `${STATUS_EXIT_CODES_HELP}\n${SOURCE_DIR_BUSY_HELP}`)
    .action(async (options: StatusOptions, invoked: Command) => {
      const only = parseKinds(options.only)
      const output = options.json ? 'json' : profileFrom(invoked).output
      // A status or diff only reads, but holds the directory's lock so it never reports a
      // directory an apply or get is halfway through rewriting (exit 10 while one runs).
      await withSourceDirLock(
        options.dir,
        async () => {
          const local = await readLocalWorkspace(options.dir, only)
          const locals = localResourceChanges(local.changed)
          let server: ServerCheck = options.offline ? 'offline' : 'checked'
          let note: string | undefined = options.offline ? 'Skipped with --offline.' : undefined
          let data: ApplyData | null = null
          let workspaceId = local.readFrom
          // The scope every recommended command carries, so it acts on what this status showed.
          const onlyScope = only ? ` --only ${only.map((kind) => KIND_DIRS[kind]).join(',')}` : ''
          let workspaceScope = ''
          let login: string | null = null
          if (!options.offline) {
            const connection = connect()
            const target = targetWorkspace(connection, local.readFrom)
            workspaceId = target
            const { profile } = connection
            if (profile.sources.workspaceId === 'flag' || profile.workspaceId !== target) {
              workspaceScope = ` --workspace ${target}`
            }
            let submission = local.submission
            if (!fitsWhole(submission.files)) {
              submission = withUnchangedWorkflowsPruned(submission, local.written, target)
              note = `More workflow folders than one dry run compares: an unchanged folder's server edits are not checked (\`${PREFIX} get\` shows them).`
            }
            const body: ApplyWorkspaceSourceBody = {
              files: submission.files,
              kinds: submission.kinds,
              blobs: submission.blobs,
              ...(submission.base ? { base: submission.base } : {}),
              options: { allowDelete: true, ...(only ? { only } : {}) },
              provenance: { client: 'cli' },
            }
            try {
              const response = await connection.client.request<ApplyWorkspaceSourceResponse>(
                'applyWorkspaceSource',
                {
                  params: { workspaceId: target },
                  query: { dryRun: true },
                  body,
                  retryRateLimited: true,
                }
              )
              data = response.data
            } catch (error) {
              const reason = unreachableReason(error)
              if (reason === null) throw withSourceExitCode(error)
              login = loginCommand(error, profile.authProfile)
              server = 'unreachable'
              note = `${reason} Showing local changes only.`
            }
          }
          const skipped = data ? await skippedResources(options.dir) : new Set<string>()
          const status = sourceStatus(
            locals,
            data
              ? serverResourceChanges(data.diagnostics).filter(
                  (change) =>
                    !(change.server === 'added' && skipped.has(`${change.kind}:${change.key}`))
                )
              : []
          )
          const plan = data ? planSummary(data) : null
          const report: StatusReport<WorkspacePlanSummary> & { workspaceId: string | null } = {
            workspaceId,
            dir: options.dir,
            server,
            ...(note ? { note } : {}),
            ...status,
            plan,
            next:
              (login
                ? null
                : unmanagedNext(status, local.submission.kinds, options.dir, workspaceScope)) ??
              nextStep(status, {
                prefix: PREFIX,
                dir: options.dir,
                getArgs: '',
                server,
                errors: plan?.errors ?? 0,
                deletes: data !== null && destructiveChanges(data.plan) > 0,
                scope: `${onlyScope}${workspaceScope}`,
                login,
              }),
          }
          printStatusReport(
            output,
            `Workspace ${workspaceId ?? '(no base)'} in ${options.dir}`,
            report,
            planLine
          )
          setSoftExitCode(statusExitCode(status.state))
        },
        READ_ONLY
      )
    })
}

/** `kind:key` of the resource a workspace path belongs to, for a diff filter. */
function resourceOf(path: string): string | null {
  const kind = kindOfPath(path)
  if (kind === null) return null
  const [key] = KIND_LAYOUTS[kind].group([path]).groups.keys()
  return key === undefined ? null : `${kind}:${key}`
}

/**
 * The kinds a diff's filters reach (a folder, a file, or `kind:key`), or `undefined` for every
 * kind the directory manages: the server is asked for these alone.
 */
function filteredKinds(filters: readonly string[]): WorkspaceKind[] | undefined {
  if (filters.length === 0) return undefined
  const kinds = new Set<WorkspaceKind>()
  for (const filter of filters) {
    const named = filter.split(':', 1)[0]
    const kind = isWorkspaceKind(named)
      ? named
      : kindOfPath(filter.replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/+$/, ''))
    if (kind === null) return undefined
    kinds.add(kind)
  }
  return [...kinds]
}

/** A workflow folder's own `.sim/` records: bookkeeping a diff leaves out. */
function isSidecar(path: string): boolean {
  return path.includes('/.sim/')
}

interface DiffOptions {
  dir: string
  server?: boolean
  json?: boolean
}

/**
 * Local against base: each changed file against the text the directory was read at. The CLI
 * records only digests, so the base text is the server's current text of a file whose digest
 * still matches the record; a file the server changed since has no base text left to show.
 */
function baseDiffs(
  local: LocalWorkspace,
  selected: readonly ChangedFile[],
  source: ServerSource | null,
  unreachable: string | null
): FileDiff[] {
  const serverBlobs = new Map((source?.blobs ?? []).map((blob) => [blob.path, blob]))
  const localBlobs = new Map(local.submission.blobs.map((blob) => [blob.path, blob]))
  return selected.flatMap((file): FileDiff[] => {
    const recorded = local.written.digests[file.path]
    if (isBlobPath(file.path)) {
      const listed = serverBlobs.get(file.path)
      const before =
        file.change === 'created'
          ? null
          : (local.written.stats[file.path]?.size ??
            (listed && listed.sha256 === recorded ? listed.size : null))
      const after = file.change === 'deleted' ? null : (localBlobs.get(file.path)?.size ?? null)
      return [{ path: file.path, change: file.change, binary: { before, after } }]
    }
    const after = file.change === 'deleted' ? null : (local.submission.files[file.path] ?? null)
    if (file.change === 'created') return textDiff(file.path, null, after, 'base')
    const serverText = source?.files[file.path]
    if (serverText !== undefined && digest(serverText) === recorded) {
      return textDiff(file.path, serverText, after, 'base')
    }
    return [baseUnavailable(file, unreachable)]
  })
}

/** Local against the server now: every selected file either side holds, sidecars left out. */
function serverDiffs(
  local: LocalWorkspace,
  source: ServerSource,
  selects: (path: string) => boolean
): FileDiff[] {
  const serverBlobs = new Map(source.blobs.map((blob) => [blob.path, blob]))
  const localBlobs = new Map(local.submission.blobs.map((blob) => [blob.path, blob]))
  const paths = new Set(
    [
      ...Object.keys(local.submission.files),
      ...localBlobs.keys(),
      ...Object.keys(source.files),
      ...serverBlobs.keys(),
    ].filter(
      (path) =>
        selects(path) && !isSidecar(path) && source.kinds.some((kind) => kind === kindOfPath(path))
    )
  )
  return [...paths].sort(compareStrings).flatMap((path): FileDiff[] => {
    if (isBlobPath(path)) {
      const mine = localBlobs.get(path)
      const theirs = serverBlobs.get(path)
      const same =
        mine &&
        theirs &&
        (theirs.sha256 === undefined ? mine.size === theirs.size : mine.sha256 === theirs.sha256)
      if (same || (!mine && !theirs)) return []
      return [
        {
          path,
          change: !theirs ? 'created' : !mine ? 'deleted' : 'edited',
          binary: { before: theirs?.size ?? null, after: mine?.size ?? null },
        },
      ]
    }
    return textDiff(
      path,
      source.files[path] ?? null,
      local.submission.files[path] ?? null,
      'server'
    )
  })
}

/**
 * `sim workspaces source diff [paths...] [--dir <dir>] [--server]`: the content of each change.
 * Without `--server`, each locally changed file against what the directory was read at; with it,
 * every selected file against the server's current source.
 */
export function attachWorkspaceSourceDiff(source: Command): void {
  const [command, connect] = apiCommand(source, 'diff', ['getWorkspaceSource'])
  command
    .argument('[paths...]', 'Files, folders or kind:key resources to compare (default: every file)')
    .option('--dir <dir>', 'Workspace source directory written by `workspaces source get`', '.')
    .option('--server', "Compare with the server's current source instead of the base")
    .option('--json', 'Print the machine-readable diff (same as --output json)')
    .allowExcessArguments(false)
    .addHelpText('after', `${DIFF_HELP}\n${SOURCE_DIR_BUSY_HELP}`)
    .description('Show the content of the changes in a workspace source directory')
    .action(async (filters: string[], options: DiffOptions, invoked: Command) => {
      const output = options.json ? 'json' : profileFrom(invoked).output
      // A status or diff only reads, but holds the directory's lock so it never reports a
      // directory an apply or get is halfway through rewriting (exit 10 while one runs).
      await withSourceDirLock(
        options.dir,
        async () => {
          const local = await readLocalWorkspace(options.dir, undefined)
          const filter = pathFilter(filters, options.dir, resourceOf)
          const selects = filter.selects
          const read = async (kinds: readonly WorkspaceKind[]) => {
            const connection = connect()
            const workspaceId = targetWorkspace(connection, local.readFrom)
            try {
              const response = await connection.client.request<GetWorkspaceSourceResponse>(
                'getWorkspaceSource',
                { params: { workspaceId }, query: { kinds: kinds.join(',') } }
              )
              return response.data
            } catch (error) {
              throw withSourceExitCode(error)
            }
          }
          if (options.server) {
            const kinds = filteredKinds(filters) ?? local.submission.kinds
            const source = kinds.length > 0 ? await read(kinds) : null
            filter.assertEachMatches([
              ...localPaths(local),
              ...(source
                ? [...Object.keys(source.files), ...source.blobs.map((blob) => blob.path)]
                : []),
            ])
            const report: DiffReport = {
              dir: options.dir,
              against: 'server',
              files: source ? serverDiffs(local, source, selects) : [],
            }
            printDiffReport(output, report)
            return
          }
          filter.assertEachMatches(localPaths(local))
          const selected = local.changed.filter((file) => selects(file.path))
          const needed = [
            ...new Set(
              selected
                .filter(
                  (file) =>
                    file.change !== 'created' &&
                    (!isBlobPath(file.path) || local.written.stats[file.path] === undefined)
                )
                .flatMap((file) => kindOfPath(file.path) ?? [])
            ),
          ]
          let source: ServerSource | null = null
          let unreachable: string | null = null
          if (needed.length > 0) {
            try {
              source = await read(needed)
            } catch (error) {
              unreachable = unreachableReason(error)
              if (unreachable === null) throw error
            }
          }
          const report: DiffReport = {
            dir: options.dir,
            against: 'base',
            ...(unreachable !== null ? { unreachable } : {}),
            files: baseDiffs(local, selected, source, unreachable),
          }
          printDiffReport(output, report)
        },
        READ_ONLY
      )
    })
}
