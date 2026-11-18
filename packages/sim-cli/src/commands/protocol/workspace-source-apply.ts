import { isRecordLike } from '@sim/utils/object'
import { SOURCE_LOCK_FILE } from '@sim/workflow-code/limits'
import { APPLY_ORDER, KIND_DIRS, type RefusalClass, refusalClass } from '@sim/workspace-code'
import { WORKSPACE_BASE_FILE } from '@sim/workspace-code/layout'
import { roundPaths } from '@sim/workspace-code/limits'
import type { Command } from 'commander'
import { printError } from '#sim-cli/output/io'
import { setSoftExitCode } from '../../embed-context'
import {
  SOURCE_LOCKED_EXIT_CODE,
  SOURCE_PARTIAL_EXIT_CODE,
  SOURCE_STALE_EXIT_CODE,
  SOURCE_TOO_LARGE_EXIT_CODE,
} from '../../exit-codes'
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
import { confirm, printNewDiagnostics, printRefusal, requireConsent } from './source-ui'
import { appliedBlobDigests, assertBlobsFetched, blobsToCarry } from './workspace-source-blobs'
import {
  assertWorkspacePaths,
  blobContent,
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
secret the workspace has no value for or a declared credential key nothing binds to (the rest
was applied: set the secret or connect the credential, then apply again), the directory was read from another workspace than
the profile's (SOURCE_OTHER_WORKSPACE: pass --workspace to choose), its base records binary
files no get downloaded (SOURCE_BLOBS_NOT_FETCHED: get again first), or the command failed;
5 a resource changed on the server since the directory was read (SOURCE_STALE: get it again
into a fresh directory, reapply the edit, retry); 6 a resource is locked; 7 the directory is
too large; 8 the apply stopped part-way (a resource failed, or a later round stayed rate limited):
what was written is saved into the directory, and applying again continues; 9 rate limited (HTTP
429) after the CLI's retries, before anything was written: wait a minute and apply again.`

const SYMBOLS: Record<Change['action'], string> = {
  create: '+',
  update: '~',
  adopt: '=',
  delete: '-',
  noop: ' ',
}

/** The exit code of each refusal class, as a commit's refusal maps to it: 5, 6, 7, else 1. */
const REFUSAL_EXIT_CODES: Record<RefusalClass, number> = {
  conflict: SOURCE_STALE_EXIT_CODE,
  locked: SOURCE_LOCKED_EXIT_CODE,
  payload_too_large: SOURCE_TOO_LARGE_EXIT_CODE,
  validation: 1,
}

/** The exit status of a dry run that found errors: the status a commit's refusal maps to. */
function refusedExitCode(diagnostics: ApplyData['diagnostics']): number {
  return REFUSAL_EXIT_CODES[
    refusalClass(
      diagnostics.filter((finding) => finding.severity === 'error').map((finding) => finding.code)
    )
  ]
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
 * The blob contents one round carries: the paths the server asked for, in order, until the next
 * would pass the per-request byte cap (always at least one, so every round makes progress).
 */
async function blobRound(
  dir: string,
  submission: WorkspaceSubmission,
  wanted: ReadonlySet<string>
): Promise<NonNullable<ApplyWorkspaceSourceBody['blobs']>> {
  const carried = roundPaths(submission.blobs, wanted)
  const blobs: NonNullable<ApplyWorkspaceSourceBody['blobs']> = []
  for (const blob of submission.blobs) {
    blobs.push(carried.has(blob.path) ? await blobContent(dir, blob.path) : blob)
  }
  return blobs
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
 * On a terminal it shows the plan and asks; anywhere else it needs `--yes`. Binary files travel
 * in rounds: each round sends what the server asked for, up to the per-request cap, and the
 * directory is saved after each, so an interrupted apply resumes where it stopped.
 */
export function attachWorkspaceSourceApply(source: Command): void {
  const [command, connect] = apiCommand(source, 'apply', ['applyWorkspaceSource'])
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
      const { client, profile } = connect()
      const workspaceId = client.requireWorkspace()
      const send = async (
        submission: WorkspaceSubmission,
        dryRun: boolean,
        blobs: NonNullable<ApplyWorkspaceSourceBody['blobs']> = submission.blobs
      ): Promise<ApplyData> => {
        const body: ApplyWorkspaceSourceBody = {
          files: submission.files,
          kinds: submission.kinds,
          blobs,
          ...(submission.base ? { base: submission.base } : {}),
          options: {
            ...(options.allowDelete ? { allowDelete: true } : {}),
            ...(only ? { only } : {}),
          },
          provenance: { client: 'cli' },
        }
        try {
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
        } catch (error) {
          if (!dryRun && roundsSaved > 0 && error instanceof SimApiError && error.status === 429) {
            throw new SimApiError(
              `${error.message} The ${roundsSaved === 1 ? 'round' : `${roundsSaved} rounds`} before it ${roundsSaved === 1 ? 'is' : 'are'} applied and saved into ${options.dir}: apply again to continue.`,
              error.status,
              error.code,
              error.details,
              SOURCE_PARTIAL_EXIT_CODE,
              error.requestId
            )
          }
          return printRefusal(
            error,
            dryRun
              ? undefined
              : `It may have been written. Run \`sim workspaces source apply --dir ${options.dir} --dry-run\`: no changes, or only the workflows you edited refused as stale (exit 5), means it may have been, or someone else changed those resources. Run \`sim workspaces source get --dir <fresh dir>\` and compare it with ${options.dir}: if it holds your edits, \`sim workspaces source get --dir ${options.dir} --force\` brings this directory up to date; if not, reapply your edits in the fresh directory. Any other outcome means it was not written: apply again.`
          )
        }
      }

      /** Write rounds this run saved into the directory; a later refusal leaves them standing. */
      let roundsSaved = 0
      let written = await readWritten(options.dir)
      let submission = await readWorkspaceDir(options.dir, only, workspaceId, written)
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
      // A later round repeats findings the preview and earlier rounds already showed.
      const printed = new Set<string>()
      let preview: ApplyData | null = null
      if (options.dryRun || !options.yes) {
        preview = await send(submission, true)
        printPlan(preview.plan)
        printNewDiagnostics(preview.diagnostics, printed)
        const errors = preview.diagnostics.some((finding) => finding.severity === 'error')
        if (errors) setSoftExitCode(refusedExitCode(preview.diagnostics))
        if (options.dryRun || refusesApply(preview)) {
          printProtocolResult(profile.output, summarize(preview))
          return
        }
        if (!options.yes && !(await confirm(`Apply these changes to workspace ${workspaceId}?`))) {
          throw new SimApiError('Nothing was applied.', 0, 'CANCELLED')
        }
      }

      /**
       * One write round: the blobs the server asked for carry their content, and the submission
       * keeps the hash of the bytes each one sent, which is what the saved digests compare.
       */
      const writeRound = async (wanted: ReadonlySet<string>): Promise<ApplyData> => {
        const blobs = await blobRound(options.dir, submission, wanted)
        submission = {
          ...submission,
          blobs: blobs.map(({ path, sha256, size }) => ({ path, sha256, size })),
        }
        return send(submission, false, blobs)
      }
      // Without a preview, the first round carries the blobs the base does not hold as they are.
      let wanted = preview ? new Set(preview.needBlobs) : blobsToCarry(submission)
      let data = await writeRound(wanted)
      for (;;) {
        printNewDiagnostics(data.diagnostics, printed)
        written = await saveApplied(options.dir, data, submission, written)
        roundsSaved++
        if (data.failed || data.remainingBlobs.length === 0) break
        const next = new Set(data.remainingBlobs)
        if (next.size >= wanted.size && [...next].every((path) => wanted.has(path))) {
          throw new SimApiError(
            `The server did not accept the binary files ${[...next].join(', ')}; nothing more was applied.`,
            0
          )
        }
        wanted = next
        // Blobs hashed for the first round stand; a round re-reads only what it sends.
        const reread = await readWorkspaceDir(
          options.dir,
          only,
          workspaceId,
          written,
          submission.blobs
        )
        submission = { ...reread, hashed: new Map([...submission.hashed, ...reread.hashed]) }
        data = await writeRound(wanted)
      }
      const held = data.plan.filter((change) => change.held)
      if (held.length > 0) {
        printError(
          `Held back, not written: ${held.map((change) => `${change.kind} ${change.key}`).join(', ')}. Fix what each one's error names, then apply again.`
        )
        setSoftExitCode(1)
      }
      if (data.failed) {
        printError(`Stopped at ${data.failed.kind} ${data.failed.key}: ${data.failed.message}`)
        setSoftExitCode(SOURCE_PARTIAL_EXIT_CODE)
      }
      printProtocolResult(profile.output, summarize(data))
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
