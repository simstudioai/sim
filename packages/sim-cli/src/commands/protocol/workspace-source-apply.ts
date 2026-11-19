import { isRecordLike } from '@sim/utils/object'
import { SOURCE_LOCK_FILE } from '@sim/workflow-code/limits'
import { APPLY_ORDER, KIND_DIRS } from '@sim/workspace-code'
import { WORKSPACE_BASE_FILE } from '@sim/workspace-code/layout'
import type { Command } from 'commander'
import { printError } from '#sim-cli/output/io'
import { setSoftExitCode } from '../../embed-context'
import { SOURCE_PARTIAL_EXIT_CODE } from '../../exit-codes'
import type { ApplyWorkspaceSourceBody, ApplyWorkspaceSourceResponse } from '../../generated/v2-api'
import { SimApiError } from '../../http/client'
import { apiCommand } from '../../runtime/called-operations'
import { printProtocolResult } from './result'
import {
  orphanedCodeFiles,
  readSourceJson,
  readWritten,
  recordedStats,
  SOURCE_WRITTEN_FILE,
  updateSourceDir,
  type Written,
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
  blobsToCarry,
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
}

const EXIT_CODES_HELP = `
Exit codes: 0 applied (or a clean dry run); 1 the source has errors (each printed as
file:line:column with its frame and hint), or changes were held back because they use a declared
secret the workspace has no value for or a declared credential key nothing binds to (the rest was
applied: set the secret or connect the credential, then apply again), the directory was read from
another workspace than the profile's (SOURCE_OTHER_WORKSPACE: pass --workspace to choose), its
base records binary files no get downloaded (SOURCE_BLOBS_NOT_FETCHED: get again first), or the
command failed; 5 a resource changed or was deleted on the server since the directory was read
(SOURCE_STALE: get it again into a fresh directory, reapply the edit, retry); 6 a resource is
locked; 7 the directory is too large; 8 the apply stopped part-way on a server failure: what was
written is saved into the directory, and applying again continues. An apply a resource refused
part-way (stale, locked, forbidden) saves what was written too, and exits as that refusal: 5, 6
or 1; 9 rate limited (HTTP 429) after the CLI's retries, before anything was written: wait a
minute and apply again (binary files already uploaded are not sent again); 10 another apply is
writing the workspace (SOURCE_BUSY): nothing was written, apply again once it finished.`

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
      const counts = Object.entries(change.destructive?.counts ?? {})
      const loses =
        counts.length > 0
          ? ` — deletes ${counts.map(([what, count]) => `${count} ${what}`).join(', ')}`
          : ''
      const held = change.held ? ' — held back (see its error)' : ''
      printError(`  ${SYMBOLS[change.action]} ${change.key}${fields}${loses}${held}`)
    }
  }
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
  const orphaned: string[] = []
  for (const [path, text] of Object.entries(files)) {
    const match = WORKFLOW_LOCK_PATH.exec(path)
    if (!match) continue
    const folder = `${KIND_DIRS.workflow}/${match[1]}`
    const written = Object.keys(files)
      .filter((file) => file.startsWith(`${folder}/`))
      .map((file) => file.slice(folder.length + 1))
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

/**
 * Saves what an apply stored back into the directory: the reprinted files, the next base, and
 * their digests in `.sim/written.json` (`written` is what it held), beside the digests of the
 * blobs the server now holds. The function files a written workflow no longer uses are removed,
 * from disk and the record. Returns the record it wrote, for the next round to read.
 */
async function saveApplied(
  dir: string,
  data: ApplyData,
  submission: WorkspaceSubmission,
  written: Written
): Promise<Written> {
  assertWorkspacePaths(Object.keys(data.files))
  const orphaned = await orphanedWorkflowFiles(dir, data.files)
  const kept = { ...written.digests, ...appliedBlobDigests(submission, data.base) }
  for (const path of orphaned) delete kept[path]
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
  return record
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
  const readFrom =
    typeof base === 'object' && base !== null && 'workspaceId' in base ? base.workspaceId : null
  if (typeof readFrom !== 'string' || readFrom === workspaceId || explicit) return
  throw new SimApiError(
    `${dir} was read from workspace ${readFrom}, but this profile targets ${workspaceId}. Pass --workspace ${readFrom} to apply it there, or --workspace ${workspaceId} to create its resources anew in this one.`,
    0,
    'SOURCE_OTHER_WORKSPACE'
  )
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
  ])
  command
    .requiredOption('--dir <dir>', 'Workspace source directory written by `workspaces source get`')
    .option('--dry-run', 'Plan and check without writing anything')
    .option('-y, --yes', 'Apply without asking for confirmation')
    .option('--allow-delete', 'Delete resources, columns and data the directory no longer declares')
    .option('--only <kinds>', `Apply only these kinds (${ONLY_KINDS_HELP})`)
    .allowExcessArguments(false)
    .description('Apply a workspace source directory')
    .addHelpText('after', EXIT_CODES_HELP)
    .action(async (options: ApplyOptions) => {
      requireConsent(options, 'writes the workspace', 'apply')
      const only = parseKinds(options.only)
      await assertWorkspaceDir(options.dir)
      const { client, profile } = connect()
      const workspaceId = client.requireWorkspace()
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

      let written = await readWritten(options.dir)
      const submission = await readWorkspaceDir(options.dir, only, workspaceId, written)
      assertBaseWorkspace(
        options.dir,
        submission.base,
        workspaceId,
        profile.sources.workspaceId === 'flag'
      )
      assertBlobsFetched(options.dir, submission, written.digests)
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
        if (!options.yes && !(await confirm(`Apply these changes to workspace ${workspaceId}?`))) {
          throw new SimApiError('Nothing was applied.', 0, 'CANCELLED')
        }
      }

      // Without a preview, stage the blobs the base does not hold as they are.
      await stage(submission, preview ? new Set(preview.needBlobs) : blobsToCarry(submission))
      const data = await send(submission, false)
      printNewDiagnostics(data.diagnostics, printed)
      written = await saveApplied(options.dir, data, submission, written)
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
    unchanged: data.plan.filter((change) => change.action === 'noop').length,
    held: data.plan.filter((change) => change.held).length,
    ...(data.failed ? { failed: `${data.failed.kind}:${data.failed.key}` } : {}),
    errors: data.diagnostics.filter((finding) => finding.severity === 'error').length,
    warnings: data.diagnostics.filter((finding) => finding.severity === 'warning').length,
  }
}
