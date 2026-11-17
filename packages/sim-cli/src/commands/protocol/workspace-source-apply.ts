import { APPLY_ORDER, KIND_DIRS } from '@sim/workspace-code'
import { WORKSPACE_BASE_FILE } from '@sim/workspace-code/layout'
import { WORKSPACE_SOURCE_LIMITS } from '@sim/workspace-code/limits'
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
import { confirm, printDiagnostics, printRefusal, requireConsent } from './workflow-source-apply'
import {
  readWrittenDigests,
  SOURCE_WRITTEN_FILE,
  updateSourceDir,
  writtenRecord,
} from './workflow-source-layout'
import { appliedBlobDigests, assertBlobsFetched } from './workspace-source-blobs'
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
file:line:column with its frame and hint), the directory was read from another workspace than
the profile's (SOURCE_OTHER_WORKSPACE: pass --workspace to choose), its base records binary
files no get downloaded (SOURCE_BLOBS_NOT_FETCHED: get again first), or the command failed; 5 a resource changed on the
server since the directory was read (SOURCE_STALE: get it again into a fresh directory, reapply
the edit, retry); 6 a resource is locked; 7 the directory is too large; 8 the apply stopped
part-way: what was written is saved into the directory, and applying again continues.`

const SYMBOLS: Record<Change['action'], string> = {
  create: '+',
  update: '~',
  adopt: '=',
  delete: '-',
  noop: ' ',
}

/**
 * The exit status of a dry run that found errors, matching the status a commit's refusal maps to
 * (`WorkspaceSourceRejectedError`): 5 stale, then 6 locked, then 7 too large, else 1.
 */
function refusedExitCode(diagnostics: ApplyData['diagnostics']): number {
  const codes = new Set(
    diagnostics.filter((finding) => finding.severity === 'error').map((finding) => finding.code)
  )
  if (codes.has('E_APPLY_STALE')) return SOURCE_STALE_EXIT_CODE
  if (codes.has('E_APPLY_LOCKED')) return SOURCE_LOCKED_EXIT_CODE
  if (codes.has('E_LIMIT_EXCEEDED') || codes.has('E_PLAN_TOO_LARGE')) {
    return SOURCE_TOO_LARGE_EXIT_CODE
  }
  return 1
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
      const loses = change.destructive
        ? ` — deletes ${Object.entries(change.destructive.counts)
            .map(([what, count]) => `${count} ${what}`)
            .join(', ')}`
        : ''
      printError(`  ${SYMBOLS[change.action]} ${change.key}${fields}${loses}`)
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
  let bytes = 0
  const blobs: NonNullable<ApplyWorkspaceSourceBody['blobs']> = []
  for (const blob of submission.blobs) {
    const fits = bytes === 0 || bytes + blob.size <= WORKSPACE_SOURCE_LIMITS.maxBlobBytesPerRequest
    if (!wanted.has(blob.path) || !fits) {
      blobs.push(blob)
      continue
    }
    bytes += blob.size
    blobs.push(await blobContent(dir, blob.path))
  }
  return blobs
}

/**
 * Saves what an apply stored back into the directory: the reprinted files, the next base, and
 * their digests in `.sim/written.json`, beside the digests of the blobs the server now holds.
 */
async function saveApplied(
  dir: string,
  data: ApplyData,
  submission: WorkspaceSubmission
): Promise<void> {
  assertWorkspacePaths(Object.keys(data.files))
  const kept = { ...(await readWrittenDigests(dir)), ...appliedBlobDigests(submission, data.base) }
  await updateSourceDir(dir, {
    write: [
      ...Object.entries(data.files),
      [WORKSPACE_BASE_FILE, `${JSON.stringify(data.base, null, 2)}\n`],
      [SOURCE_WRITTEN_FILE, writtenRecord(data.files, kept)],
    ],
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
            }
          )
          return response.data
        } catch (error) {
          return printRefusal(error)
        }
      }

      let submission = await readWorkspaceDir(options.dir, only)
      assertBaseWorkspace(
        options.dir,
        submission.base,
        workspaceId,
        profile.sources.workspaceId === 'flag'
      )
      await assertBlobsFetched(options.dir, submission)
      if (submission.ignored.length > 0) {
        printError(
          `Not sent (a hidden name, or a character no workspace path holds): ${submission.ignored.join(', ')}`
        )
      }
      let preview: ApplyData | null = null
      if (options.dryRun || !options.yes || submission.blobs.length > 0) {
        preview = await send(submission, true)
        printPlan(preview.plan)
        printDiagnostics(preview.diagnostics)
        const refused = preview.diagnostics.some((finding) => finding.severity === 'error')
        if (refused) setSoftExitCode(refusedExitCode(preview.diagnostics))
        if (options.dryRun || refused) {
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
      let wanted = new Set(preview?.needBlobs ?? [])
      let data = await writeRound(wanted)
      for (;;) {
        printDiagnostics(data.diagnostics)
        await saveApplied(options.dir, data, submission)
        if (data.failed || data.remainingBlobs.length === 0) break
        const next = new Set(data.remainingBlobs)
        if (next.size >= wanted.size && [...next].every((path) => wanted.has(path))) {
          throw new SimApiError(
            `The server did not accept the binary files ${[...next].join(', ')}; nothing more was applied.`,
            0
          )
        }
        wanted = next
        /** The blobs hashed for the first round stand; a round re-reads only what it sends. */
        submission = await readWorkspaceDir(options.dir, only, submission.blobs)
        data = await writeRound(wanted)
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
    ...(data.failed ? { failed: `${data.failed.kind}:${data.failed.key}` } : {}),
    errors: data.diagnostics.filter((finding) => finding.severity === 'error').length,
    warnings: data.diagnostics.filter((finding) => finding.severity === 'warning').length,
  }
}
