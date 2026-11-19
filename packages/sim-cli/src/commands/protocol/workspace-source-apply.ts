import { lstat } from 'node:fs/promises'
import { join } from 'node:path'
import { isRecordLike } from '@sim/utils/object'
import { SOURCE_LOCK_FILE } from '@sim/workflow-code/limits'
import {
  APPLY_ORDER,
  isFileKind,
  KIND_DIRS,
  parseResourceAddress,
  parseWorkspaceBase,
  type WorkspaceKind,
} from '@sim/workspace-code'
import { isBlobPath, KIND_LAYOUTS } from '@sim/workspace-code/kinds/registry'
import { kindOfPath, WORKSPACE_BASE_FILE } from '@sim/workspace-code/layout'
import { promotionSubmission } from '@sim/workspace-code/promote'
import type { Command } from 'commander'
import { printError } from '#sim-cli/output/io'
import { setSoftExitCode } from '../../embed-context'
import { SOURCE_PARTIAL_EXIT_CODE } from '../../exit-codes'
import type {
  ApplyWorkspaceSourceBody,
  ApplyWorkspaceSourceResponse,
  GetWorkspaceSourceResponse,
} from '../../generated/v2-api'
import { SimApiError } from '../../http/client'
import { apiCommand, type OperationClient } from '../../runtime/called-operations'
import { printProtocolResult } from './result'
import {
  isMissing,
  orphanedCodeFiles,
  readSourceJson,
  readWritten,
  recordedStats,
  SOURCE_WRITTEN_FILE,
  updateSourceDir,
  type Written,
  withSourceDirLock,
  writtenFile,
  writtenRecord,
} from './source-dir'
import {
  confirm,
  printNewDiagnostics,
  printRefusal,
  refusedExitCode,
  requireConsent,
  resultDiagnostics,
} from './source-ui'
import {
  appliedBlobDigests,
  assertBlobsFetched,
  baseBlobDigests,
  blobsToStage,
  stageBlobs,
} from './workspace-source-blobs'
import {
  assertWorkspaceDir,
  assertWorkspacePaths,
  readWorkspaceDir,
  type WorkspaceSubmission,
} from './workspace-source-dir'
import { ONLY_KINDS_HELP, parseKinds } from './workspace-source-get'

type ApplyData = ApplyWorkspaceSourceResponse['data']
type Change = ApplyData['plan'][number]

interface ApplyOptions {
  dir: string
  dryRun?: boolean
  yes?: boolean
  allowDelete?: boolean
  only?: string
  to?: string
}

const EXIT_CODES_HELP = `
Exit codes: 0 applied (or a clean dry run); 1 the source has errors (each printed as
file:line:column with its frame and hint), or changes were held back because they use a declared
secret the workspace has no value for or a declared credential key nothing binds to (the rest was
applied: set the secret or connect the credential, then apply again), the directory was read from
another workspace than the profile's (SOURCE_OTHER_WORKSPACE: pass --workspace to choose, or --to
to promote it), its
base records binary files no get downloaded (SOURCE_BLOBS_NOT_FETCHED: get again first), or the
command failed; 5 a resource changed or was deleted on the server since the directory was read
(SOURCE_STALE: get it again into a fresh directory, reapply the edit, retry); 6 a resource is
locked; 7 the directory is too large; 8 the apply stopped part-way on a server failure: what was
written is saved into the directory, and applying again continues. An apply a resource refused
part-way (stale, locked, forbidden) saves what was written too, and exits as that refusal: 5, 6
or 1; 9 rate limited (HTTP 429) after the CLI's retries, before anything was written: wait a
minute and apply again (binary files already uploaded are not sent again); 10 another apply is
writing the workspace (SOURCE_BUSY), or another command is using the directory
(SOURCE_DIR_BUSY): nothing was written, run the command again once the other finished.`

const SYMBOLS: Record<Change['action'], string> = {
  create: '+',
  update: '~',
  adopt: '=',
  delete: '-',
  noop: ' ',
}

/**
 * The exit status of an apply that stopped part-way: a server failure (`E_APPLY_FAILED`) is 8,
 * since applying again continues; a write refused part-way exits as a commit refused for the
 * same finding would (a resource changed or deleted since the plan 5, locked 6, too large 7,
 * else 1), since applying again would only refuse again.
 */
function failedExitCode(failed: NonNullable<ApplyData['failed']>): number {
  return failed.code === 'E_APPLY_FAILED'
    ? SOURCE_PARTIAL_EXIT_CODE
    : refusedExitCode([{ code: failed.code, severity: 'error' }])
}

/** Whether `finding` is about a change the plan holds back, which refuses nothing else. */
function isHeldFinding(
  plan: readonly Change[],
  finding: ApplyData['diagnostics'][number]
): boolean {
  return plan.some(
    (change) => change.held && change.kind === finding.kind && change.key === finding.key
  )
}

/** Whether a dry run's errors refuse the apply: any error but those of changes held back. */
function refusesApply(data: ApplyData): boolean {
  return data.diagnostics.some(
    (finding) => finding.severity === 'error' && !isHeldFinding(data.plan, finding)
  )
}

/** The plan as a person reads it: per kind, the counts, then each change with what it touches. */
function printPlan(plan: Change[]): void {
  for (const kind of APPLY_ORDER) {
    const changes = plan.filter((change) => change.kind === kind)
    if (changes.length === 0) continue
    const counts = new Map<string, number>()
    for (const change of changes) counts.set(change.action, (counts.get(change.action) ?? 0) + 1)
    printError(
      `${KIND_DIRS[kind]}: ${[...counts].map(([action, count]) => `${count} ${action === 'noop' ? 'unchanged' : action}`).join(', ')}`
    )
    for (const change of changes) {
      if (change.action === 'noop') continue
      const fields =
        change.fields && change.fields.length > 0 ? ` (${change.fields.join(', ')})` : ''
      const lost = Object.entries(change.destructive?.counts ?? {})
      const loses =
        lost.length > 0
          ? ` — deletes ${lost.map(([what, count]) => `${count} ${what}`).join(', ')}`
          : ''
      const held = change.held ? ' — held back (see its error)' : ''
      printError(`  ${SYMBOLS[change.action]} ${change.key}${fields}${loses}${held}`)
    }
  }
  const destructive = destructiveChanges(plan)
  if (destructive > 0) {
    printError(
      `${destructive} change(s) delete data that applying an older directory (a reverted commit) does not bring back: a deleted resource stays deleted, and its rows, documents, run history and webhook URLs are gone.`
    )
  }
}

/** The changes that delete something (a resource, rows, documents, columns, a deployment). */
export function destructiveChanges(changes: readonly Change[]): number {
  return changes.filter((change) => change.action === 'delete' || change.destructive !== undefined)
    .length
}

/**
 * The binary paths an apply refusal names as not staged, when those are its only errors: the CLI
 * stages them and applies once more. `null` for any other refusal.
 */
function missingBlobPaths(error: unknown): string[] | null {
  if (!(error instanceof SimApiError) || !isRecordLike(error.details)) return null
  const { diagnostics } = error.details
  if (!Array.isArray(diagnostics)) return null
  const errors = diagnostics.filter(
    (finding): finding is { code: string; file?: string } =>
      isRecordLike(finding) && finding.severity === 'error' && typeof finding.code === 'string'
  )
  if (errors.length === 0 || errors.some((finding) => finding.code !== 'E_BLOB_MISSING')) {
    return null
  }
  return errors.flatMap((finding) => (typeof finding.file === 'string' ? [finding.file] : []))
}

/** A workflow folder's lock, as an apply answer names it. */
const WORKFLOW_LOCK_PATH = new RegExp(
  `^${KIND_DIRS.workflow}/([^/]+)/${SOURCE_LOCK_FILE.replaceAll('.', '\\.')}$`
)

/**
 * The function files of each workflow the apply wrote that its new lock no longer names, as a
 * single-workflow apply prunes them: named by the lock the folder held (so the CLI wrote them)
 * and not written now. A file the person added and no lock named is kept, and so is every file of
 * a folder whose new lock does not read as one: without it nothing tells a dropped file from a
 * kept one.
 */
async function orphanedWorkflowFiles(dir: string, files: Record<string, string>) {
  const filesByFolder = new Map<string, string[]>()
  for (const path of Object.keys(files)) {
    if (!path.startsWith(`${KIND_DIRS.workflow}/`)) continue
    const folder = path.split('/', 2).join('/')
    const inFolder = filesByFolder.get(folder)
    const file = path.slice(folder.length + 1)
    if (inFolder) inFolder.push(file)
    else filesByFolder.set(folder, [file])
  }
  const orphaned: string[] = []
  for (const [path, text] of Object.entries(files)) {
    const match = WORKFLOW_LOCK_PATH.exec(path)
    if (!match) continue
    const folder = `${KIND_DIRS.workflow}/${match[1]}`
    const written = filesByFolder.get(folder) ?? []
    let next: unknown = null
    try {
      next = JSON.parse(text)
    } catch {}
    if (!isRecordLike(next) || !isRecordLike(next.blocks)) continue
    const previous = await readSourceJson(dir, path)
    orphaned.push(...orphanedCodeFiles(previous, next, written).map((file) => `${folder}/${file}`))
  }
  return orphaned
}

/** Whether `path` under `dir` is gone from disk. */
async function goneFromDisk(dir: string, path: string): Promise<boolean> {
  try {
    await lstat(join(dir, path))
    return false
  } catch (error) {
    return isMissing(error)
  }
}

/**
 * The recorded paths whose resource an apply deleted: of a submitted kind, gone from disk, and no
 * longer in the base the apply returned (a blob the base no longer lists; a text file whose
 * resource it no longer records, or for a root-file kind no resource of that kind). A delete the
 * apply held or that failed leaves the resource in the base, so its record stays and a later
 * apply can still send it.
 */
async function deletedRecordedPaths(
  dir: string,
  recorded: Written['digests'],
  kinds: readonly WorkspaceKind[],
  returned: unknown
): Promise<string[]> {
  const base = parseWorkspaceBase(returned).base
  if (!base) return []
  const addresses = new Set(Object.keys(base.resources))
  const kindsHeld = new Set(
    [...addresses].flatMap((address) => parseResourceAddress(address)?.kind ?? [])
  )
  const blobs = baseBlobDigests(returned, kinds)
  const candidates = Object.keys(recorded).filter((path) => {
    const kind = kindOfPath(path)
    if (kind === null || !kinds.includes(kind)) return false
    if (isBlobPath(path)) return !blobs.has(path)
    if (isFileKind(kind)) return !kindsHeld.has(kind)
    const [key] = KIND_LAYOUTS[kind].group([path]).groups.keys()
    return key !== undefined && !addresses.has(`${kind}:${key}`)
  })
  const gone = await Promise.all(candidates.map((path) => goneFromDisk(dir, path)))
  return candidates.filter((_, index) => gone[index])
}

/**
 * The text files the directory sent for a resource the apply reprinted that the reprint no longer
 * holds: a tool whose code the server keeps as `stored()` (a credential in it) is reprinted
 * without `tools/<key>.js`, which left on disk would refuse the next apply (`E_TOOL_CODE`).
 * Workflow folders keep files no lock named, so their function files are pruned by lock instead
 * ({@link orphanedWorkflowFiles}); blobs are never reprinted.
 */
function droppedResourceFiles(
  sent: Readonly<Record<string, string>>,
  reprinted: Readonly<Record<string, string>>
): string[] {
  const byResource = (paths: readonly string[]) => {
    const resources = new Map<string, string[]>()
    for (const path of paths) {
      const kind = kindOfPath(path)
      if (kind === null || kind === 'workflow' || isBlobPath(path)) continue
      for (const [key, files] of KIND_LAYOUTS[kind].group([path]).groups) {
        const address = `${kind}:${key}`
        resources.set(address, [...(resources.get(address) ?? []), ...files])
      }
    }
    return resources
  }
  const sentByResource = byResource(Object.keys(sent))
  return [...byResource(Object.keys(reprinted)).keys()].flatMap((address) =>
    (sentByResource.get(address) ?? []).filter((path) => !Object.hasOwn(reprinted, path))
  )
}

/**
 * Saves what an apply stored back into the directory: the reprinted files, the next base, and
 * their digests in `.sim/written.json` (`written` is what it held), beside the digests of the
 * blobs the server now holds. The function files a written workflow no longer uses, and the files
 * a reprinted resource no longer has, are removed from disk and the record; the record also drops
 * the files of resources the apply deleted ({@link deletedRecordedPaths}).
 */
async function saveApplied(
  dir: string,
  data: ApplyData,
  submission: WorkspaceSubmission,
  written: Written
): Promise<void> {
  assertWorkspacePaths(Object.keys(data.files))
  const orphaned = [
    ...(await orphanedWorkflowFiles(dir, data.files)),
    ...droppedResourceFiles(submission.files, data.files),
  ]
  const kept = { ...written.digests, ...appliedBlobDigests(submission, data.base) }
  const deleted = await deletedRecordedPaths(dir, written.digests, submission.kinds, data.base)
  for (const path of [...orphaned, ...deleted]) delete kept[path]
  const record = writtenRecord(
    data.files,
    kept,
    new Map([...recordedStats(written), ...submission.hashed])
  )
  await updateSourceDir(dir, {
    write: [
      ...Object.entries(data.files),
      [WORKSPACE_BASE_FILE, `${JSON.stringify(data.base, null, 2)}\n`],
      [SOURCE_WRITTEN_FILE, writtenFile(record)],
    ],
    remove: orphaned,
  })
}

/**
 * Refuses a directory read from another workspace than the one targeted, unless `--workspace`
 * names the target: applying it would create every resource anew there, so the choice is the
 * caller's to make explicitly.
 */
function assertBaseWorkspace(
  dir: string,
  base: unknown,
  workspaceId: string,
  explicit: boolean
): void {
  const readFrom = baseWorkspaceOf(base)
  if (readFrom === null || readFrom === workspaceId || explicit) return
  throw new SimApiError(
    `${dir} was read from workspace ${readFrom}, but this profile targets ${workspaceId}. Pass --workspace ${readFrom} to apply it there, or --to ${workspaceId} to promote it: its resources bind by key to that workspace's own, and the directory stays bound to ${readFrom}.`,
    0,
    'SOURCE_OTHER_WORKSPACE'
  )
}

/** The workflow a directory's base belongs to (a workflow source directory), or `null`. */
function baseWorkflowOf(base: unknown): string | null {
  return isRecordLike(base) && typeof base.workflowId === 'string' ? base.workflowId : null
}

/** The workspace a directory's base was read from, or `null` when it has none. */
function baseWorkspaceOf(base: unknown): string | null {
  return isRecordLike(base) && typeof base.workspaceId === 'string' ? base.workspaceId : null
}

/**
 * The submission that promotes `submission` (read for the target, so every workflow folder is
 * whole) to `target`: the target's get supplies its base and each workflow's lock and base, so
 * its resources are bound by key and updated in place. Refuses a target the directory was read
 * from, which a plain apply serves.
 */
async function promoted(
  client: OperationClient<'getWorkspaceSource'>,
  dir: string,
  submission: WorkspaceSubmission,
  target: string,
  allowDelete: boolean
): Promise<WorkspaceSubmission> {
  if (baseWorkspaceOf(submission.base) === target) {
    throw new SimApiError(
      `${dir} was read from workspace ${target}; apply it without --to.`,
      0,
      'SOURCE_PROMOTE_SAME_WORKSPACE'
    )
  }
  const { data } = await client.request<GetWorkspaceSourceResponse>('getWorkspaceSource', {
    params: { workspaceId: target },
    query: { kinds: submission.kinds.join(',') },
  })
  const targetBase = parseWorkspaceBase(data.base).base
  if (!targetBase) {
    throw new SimApiError(`Workspace ${target} answered with a base this CLI cannot read.`, 0)
  }
  const composed = promotionSubmission({
    files: submission.files,
    blobPaths: submission.blobs.map((blob) => blob.path),
    kinds: submission.kinds,
    target: { files: data.files, base: targetBase },
    allowDelete,
  })
  return { ...submission, files: composed.files, base: composed.base }
}

/**
 * `sim workspaces source apply --dir <dir>`: applies a directory `workspaces source get` wrote.
 * On a terminal it shows the plan and asks; anywhere else it needs `--yes`. Binary files are
 * staged first, by hash (only those the server does not hold staged for this caller, so an
 * interrupted upload resumes), then one apply names them: the server plans once and writes
 * nothing when a blob it needs is missing.
 */
export function attachWorkspaceSourceApply(source: Command): void {
  const [command, connect] = apiCommand(source, 'apply', [
    'applyWorkspaceSource',
    'findMissingWorkspaceSourceBlobs',
    'stageWorkspaceSourceBlobs',
    'getWorkspaceSource',
  ])
  command
    .requiredOption('--dir <dir>', 'Workspace source directory written by `workspaces source get`')
    .option('--dry-run', 'Plan and check without writing anything')
    .option('-y, --yes', 'Apply without asking for confirmation')
    .option('--allow-delete', 'Delete resources, columns and data the directory no longer declares')
    .option('--only <kinds>', `Apply only these kinds (${ONLY_KINDS_HELP})`)
    .option(
      '--to <workspaceId>',
      "Promote the directory to another workspace (dev to prod): its resources bind by key to that workspace's own and are updated in place; the directory is not changed"
    )
    .allowExcessArguments(false)
    .description('Apply a workspace source directory')
    .addHelpText('after', EXIT_CODES_HELP)
    .action(async (options: ApplyOptions) => {
      requireConsent(options, 'writes the workspace', 'apply')
      const only = parseKinds(options.only)
      const { client, profile } = connect()
      const workspaceId = options.to ?? client.requireWorkspace()
      const post = async (submission: WorkspaceSubmission, dryRun: boolean) => {
        const body: ApplyWorkspaceSourceBody = {
          files: submission.files,
          kinds: submission.kinds,
          blobs: submission.blobs,
          ...(submission.base ? { base: submission.base } : {}),
          options: {
            ...(options.allowDelete ? { allowDelete: true } : {}),
            ...(only ? { only } : {}),
          },
          provenance: { client: 'cli' },
        }
        const response = await client.request<ApplyWorkspaceSourceResponse>(
          'applyWorkspaceSource',
          {
            params: { workspaceId },
            ...(dryRun ? { query: { dryRun: true } } : {}),
            body,
            retryRateLimited: true,
          }
        )
        return response.data
      }
      /** Uploads what the server lacks of `paths`; nothing is applied if this fails. */
      const stage = async (submission: WorkspaceSubmission, paths: ReadonlySet<string>) => {
        let staged: { count: number; bytes: number }
        try {
          staged = await stageBlobs(client, workspaceId, options.dir, submission.blobs, paths)
        } catch (error) {
          return printRefusal(error, profile.output)
        }
        if (staged.count > 0) {
          printError(`Uploaded ${staged.count} binary file(s), ${staged.bytes} bytes.`)
        }
      }
      /**
       * Sends the directory. A commit the server refuses only for blobs that are not staged (the
       * CLI's guess from the base missed one) stages those and is sent once more.
       */
      const send = async (submission: WorkspaceSubmission, dryRun: boolean): Promise<ApplyData> => {
        let refusal: unknown
        try {
          return await post(submission, dryRun)
        } catch (error) {
          refusal = error
        }
        const missing = dryRun ? null : missingBlobPaths(refusal)
        if (missing && missing.length > 0) {
          await stage(submission, new Set(missing))
          try {
            return await post(submission, dryRun)
          } catch (error) {
            refusal = error
          }
        }
        return printRefusal(
          refusal,
          profile.output,
          dryRun
            ? undefined
            : `It may have been written. Run \`sim workspaces source apply --dir ${options.dir} --dry-run\`: no changes, or only the workflows you edited refused as stale (exit 5), means it may have been, or someone else changed those resources. Run \`sim workspaces source get --dir <fresh dir>\` and compare it with ${options.dir}: if it holds your edits, \`sim workspaces source get --dir ${options.dir} --force\` brings this directory up to date; if not, reapply your edits in the fresh directory. Any other outcome means it was not written: apply again.`
        )
      }

      await withSourceDirLock(options.dir, async () => {
        const written = await readWritten(options.dir)
        const read = await readWorkspaceDir(options.dir, only, workspaceId, written)
        // The read already walked the kind folders: only a read that found none, or a workflow
        // directory's base, needs the full check (which refuses with the reason).
        if (read.kinds.length === 0 || baseWorkflowOf(read.base) !== null) {
          await assertWorkspaceDir(options.dir)
        }
        if (!options.to) {
          assertBaseWorkspace(
            options.dir,
            read.base,
            workspaceId,
            profile.sources.workspaceId === 'flag'
          )
        }
        assertBlobsFetched(options.dir, read, written.digests)
        const submission = options.to
          ? await promoted(client, options.dir, read, options.to, options.allowDelete === true)
          : read
        if (submission.ignored.length > 0) {
          printError(
            `Not sent (a hidden name, or a character no workspace path holds): ${submission.ignored.join(', ')}`
          )
        }
        // The apply repeats findings the preview already showed.
        const printed = new Set<string>()
        let preview: ApplyData | null = null
        if (options.dryRun || !options.yes) {
          preview = await send(submission, true)
          printPlan(preview.plan)
          printNewDiagnostics(preview.diagnostics, printed)
          const errors = preview.diagnostics.some((finding) => finding.severity === 'error')
          if (errors) setSoftExitCode(refusedExitCode(preview.diagnostics))
          if (options.dryRun || refusesApply(preview)) {
            printProtocolResult(profile.output, {
              ...summarize(preview),
              ...resultDiagnostics(profile.output, preview.diagnostics),
            })
            return
          }
          if (
            !options.yes &&
            !(await confirm(`Apply these changes to workspace ${workspaceId}?`))
          ) {
            throw new SimApiError('Nothing was applied.', 0, 'CANCELLED')
          }
        }

        // Without a preview, stage the blobs the base does not hold as they are.
        await stage(submission, preview ? new Set(preview.needBlobs) : blobsToStage(submission))
        const data = await send(submission, false)
        printNewDiagnostics(data.diagnostics, printed)
        // A promotion leaves the directory bound to the workspace it was read from.
        if (!options.to) await saveApplied(options.dir, data, submission, written)
        const held = data.plan.filter((change) => change.held)
        if (held.length > 0) {
          printError(
            `Held back, not written: ${held.map((change) => `${change.kind} ${change.key}`).join(', ')}. Fix what each one's error names, then apply again.`
          )
          setSoftExitCode(1)
        }
        if (data.failed) {
          printError(`Stopped at ${data.failed.kind} ${data.failed.key}: ${data.failed.message}`)
          setSoftExitCode(failedExitCode(data.failed))
        }
        printProtocolResult(profile.output, {
          ...summarize(data),
          ...resultDiagnostics(profile.output, data.diagnostics),
        })
      })
    })
}

/** The result line: what a dry run would write, or what an apply wrote (not what it planned). */
function summarize(data: ApplyData) {
  const changes = data.dryRun ? data.plan : data.applied
  const count = (action: Change['action']) =>
    changes.filter((change) => change.action === action).length
  return {
    workspaceId: data.workspaceId,
    dryRun: data.dryRun,
    applied: data.applied.length,
    created: count('create'),
    updated: count('update') + count('adopt'),
    deleted: count('delete'),
    destructive: destructiveChanges(changes),
    unchanged: data.plan.filter((change) => change.action === 'noop').length,
    held: data.plan.filter((change) => change.held).length,
    ...(data.failed ? { failed: `${data.failed.kind}:${data.failed.key}` } : {}),
    ...(data.applyId ? { applyId: data.applyId } : {}),
    errors: data.diagnostics.filter((finding) => finding.severity === 'error').length,
    warnings: data.diagnostics.filter((finding) => finding.severity === 'warning').length,
  }
}
