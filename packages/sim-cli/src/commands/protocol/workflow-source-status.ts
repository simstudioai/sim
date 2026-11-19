/**
 * `sim workflows source status` and `sim workflows source diff`: what changed in one workflow's
 * source directory since it was read, on either side, without applying anything. Local changes
 * come from the file digests `.sim/written.json` records (the workspace directory's record for a
 * `workflows/<key>` folder that has none of its own); the server's from a dry run of the
 * directory, whose `E_APPLY_STALE` says the workflow changed since the base.
 */
import { basename, resolve } from 'node:path'
import { compareStrings } from '@sim/utils/string'
import { SOURCE_CODE_DIR, SOURCE_ENTRY_FILE } from '@sim/workflow-code/limits'
import { KIND_DIRS } from '@sim/workspace-code'
import {
  type ChangedFile,
  changedFiles,
  type LocalResourceChange,
  resourceChange,
  type ServerResourceChange,
  sourceStatus,
} from '@sim/workspace-code/status'
import type { Command } from 'commander'
import { profileFrom } from '../../context'
import { setSoftExitCode } from '../../embed-context'
import type { ApplyWorkflowSourceResponse, GetWorkflowSourceResponse } from '../../generated/v2-api'
import { SimApiError } from '../../http/client'
import { apiCommand } from '../../runtime/called-operations'
import { digest, listSourceFiles, readSourceText, readWritten, type Written } from './source-dir'
import {
  baseUnavailable,
  DIFF_HELP,
  type DiffReport,
  type FileDiff,
  nextStep,
  pathSelector,
  printDiffReport,
  printStatusReport,
  type ServerCheck,
  STATUS_EXIT_CODES_HELP,
  type StatusReport,
  statusExitCode,
  textDiff,
  unreachableReason,
} from './source-status'
import { readBase, readLock, readSourceFiles } from './workflow-source-apply'
import { workspaceRootOf } from './workflow-source-check'

type ApplyData = ApplyWorkflowSourceResponse['data']

const PREFIX = 'sim workflows source'

/**
 * What the CLI last wrote into the directory: its own `.sim/written.json`, or for a
 * `workflows/<key>` folder of a workspace directory without one, the workspace record's entries
 * for the folder (its `.sim/` records left out).
 */
async function readWorkflowWritten(dir: string): Promise<Written> {
  const own = await readWritten(dir)
  if (Object.keys(own.digests).length > 0) return own
  const workspace = await workspaceRootOf(dir)
  if (!workspace) return own
  const prefix = `${KIND_DIRS.workflow}/${basename(resolve(dir))}/`
  const record = await readWritten(workspace.root)
  const inFolder = <T>(entries: Record<string, T>) =>
    Object.fromEntries(
      Object.entries(entries).flatMap(([path, value]) => {
        const relative = path.startsWith(prefix) ? path.slice(prefix.length) : null
        return relative !== null && !relative.startsWith('.sim/') ? [[relative, value]] : []
      })
    )
  return { digests: inFolder(record.digests), stats: inFolder(record.stats) }
}

/** The workflow directory as a status reads it, once. */
interface LocalWorkflow {
  base: Awaited<ReturnType<typeof readBase>>
  workflowId: string
  written: Written
  /** `workflow.ts` and every file under `functions/`, by path. */
  texts: Record<string, string>
  changed: ChangedFile[]
}

async function readLocalWorkflow(dir: string): Promise<LocalWorkflow> {
  const base = await readBase(dir, undefined)
  const { workflowId } = base
  const written = await readWorkflowWritten(dir)
  const paths = [
    SOURCE_ENTRY_FILE,
    ...(await listSourceFiles(dir, SOURCE_CODE_DIR)).filter(
      (path) => !path.split('/').some((segment) => segment.startsWith('.'))
    ),
  ]
  const texts: Record<string, string> = {}
  for (const path of paths) {
    const text = await readSourceText(dir, path)
    if (text !== null) texts[path] = text
  }
  const current = Object.fromEntries(
    Object.entries(texts).map(([path, text]) => [path, digest(text)])
  )
  return {
    base,
    workflowId,
    written,
    texts,
    changed: changedFiles(current, written.digests, () => true),
  }
}

/** The dry run's summary: what applying would change in the graph, and its findings left over. */
interface WorkflowPlanSummary {
  blocksAdded: number
  blocksRemoved: number
  blocksModified: number
  edgesAdded: number
  edgesRemoved: number
  /** Errors other than `E_APPLY_STALE`, which the status lists as drift or a conflict. */
  errors: number
  warnings: number
}

function planSummary(data: ApplyData): WorkflowPlanSummary {
  const findings = (severity: string) =>
    data.diagnostics.filter(
      (finding) => finding.severity === severity && finding.code !== 'E_APPLY_STALE'
    ).length
  return {
    blocksAdded: data.diff.blocks.added.length,
    blocksRemoved: data.diff.blocks.removed.length,
    blocksModified: data.diff.blocks.modified.length,
    edgesAdded: data.diff.edges.added,
    edgesRemoved: data.diff.edges.removed,
    errors: findings('error'),
    warnings: findings('warning'),
  }
}

function planLine(plan: WorkflowPlanSummary): string {
  return `Applying would: blocks +${plan.blocksAdded} -${plan.blocksRemoved} ~${plan.blocksModified}, connections +${plan.edgesAdded} -${plan.edgesRemoved}; ${plan.errors} error(s), ${plan.warnings} warning(s).`
}

interface StatusOptions {
  dir: string
  offline?: boolean
  json?: boolean
}

/**
 * `sim workflows source status [--dir <dir>]`: the local changes since the directory was read,
 * and (unless `--offline`, or when the server cannot be reached) whether the workflow changed on
 * the server since, from a dry run. Ends with the next command.
 */
export function attachWorkflowSourceStatus(source: Command): void {
  const [command, connect] = apiCommand(source, 'status', ['applyWorkflowSource'])
  command
    .option('--dir <dir>', 'Source directory: workflow.ts, functions/* and .sim/', '.')
    .option('--offline', 'Report local changes only, without asking the server')
    .option('--json', 'Print the machine-readable status (same as --output json)')
    .allowExcessArguments(false)
    .description('Show what changed locally and on the server since the directory was read')
    .addHelpText('after', STATUS_EXIT_CODES_HELP)
    .action(async (options: StatusOptions, invoked: Command) => {
      const output = options.json ? 'json' : profileFrom(invoked).output
      const local = await readLocalWorkflow(options.dir)
      const { workflowId } = local
      const locals: LocalResourceChange[] =
        local.changed.length > 0
          ? [
              {
                kind: 'workflow',
                key: workflowId,
                change: resourceChange(local.changed),
                files: local.changed,
              },
            ]
          : []
      let server: ServerCheck = options.offline ? 'offline' : 'checked'
      let note: string | undefined = options.offline ? 'Skipped with --offline.' : undefined
      let data: ApplyData | null = null
      let serverChanges: ServerResourceChange[] = []
      if (!options.offline) {
        const { client } = connect()
        const lock = await readLock(options.dir)
        const files = await readSourceFiles(options.dir, lock)
        try {
          const response = await client.request<ApplyWorkflowSourceResponse>(
            'applyWorkflowSource',
            {
              params: { workflowId },
              query: { dryRun: true, allowDelete: true },
              body: { files, lock, base: local.base, provenance: { client: 'cli' } },
              retryRateLimited: true,
            }
          )
          data = response.data
          if (data.diagnostics.some((finding) => finding.code === 'E_APPLY_STALE')) {
            serverChanges = [{ kind: 'workflow', key: workflowId, server: 'changed' }]
          }
        } catch (error) {
          if (error instanceof SimApiError && error.status === 404) {
            serverChanges = [{ kind: 'workflow', key: workflowId, server: 'deleted' }]
            note = 'The server has no workflow by this id that this profile can read.'
          } else {
            const reason = unreachableReason(error)
            if (reason === null) throw error
            server = 'unreachable'
            note = `${reason} Showing local changes only.`
          }
        }
      }
      const status = sourceStatus(locals, serverChanges)
      const plan = data ? planSummary(data) : null
      const report: StatusReport<WorkflowPlanSummary> & { workflowId: string } = {
        workflowId,
        dir: options.dir,
        server,
        ...(note ? { note } : {}),
        ...status,
        plan,
        next: nextStep(status, {
          prefix: PREFIX,
          dir: options.dir,
          getArgs: `${workflowId} `,
          server,
          errors: plan?.errors ?? 0,
          deletes: (plan?.blocksRemoved ?? 0) > 0,
        }),
      }
      printStatusReport(output, `Workflow ${workflowId} in ${options.dir}`, report, planLine)
      setSoftExitCode(statusExitCode(status.state))
    })
}

interface DiffOptions {
  dir: string
  server?: boolean
  json?: boolean
}

/**
 * `sim workflows source diff [paths...] [--dir <dir>] [--server]`: the content of each change.
 * Without `--server`, each locally changed file against what the directory was read at (the
 * server's current text of a file whose digest still matches the record, since the CLI keeps
 * only digests); with it, every file against the server's current source.
 */
export function attachWorkflowSourceDiff(source: Command): void {
  const [command, connect] = apiCommand(source, 'diff', ['getWorkflowSource'])
  command
    .argument('[paths...]', 'Files or folders to compare (default: every file)')
    .option('--dir <dir>', 'Source directory: workflow.ts, functions/* and .sim/', '.')
    .option('--server', "Compare with the server's current source instead of the base")
    .option('--json', 'Print the machine-readable diff (same as --output json)')
    .allowExcessArguments(false)
    .addHelpText('after', DIFF_HELP)
    .description('Show the content of the changes in a workflow source directory')
    .action(async (filters: string[], options: DiffOptions, invoked: Command) => {
      const output = options.json ? 'json' : profileFrom(invoked).output
      const local = await readLocalWorkflow(options.dir)
      const selects = pathSelector(filters)
      const read = async () => {
        const { client } = connect()
        const response = await client.request<GetWorkflowSourceResponse>('getWorkflowSource', {
          params: { workflowId: local.workflowId },
        })
        return response.data.files
      }
      if (options.server) {
        const serverFiles = await read()
        const paths = [...new Set([...Object.keys(local.texts), ...Object.keys(serverFiles)])]
          .filter(selects)
          .sort(compareStrings)
        printDiffReport(output, {
          dir: options.dir,
          against: 'server',
          files: paths.flatMap((path) =>
            textDiff(path, serverFiles[path] ?? null, local.texts[path] ?? null, 'server')
          ),
        })
        return
      }
      const selected = local.changed.filter((file) => selects(file.path))
      let serverFiles: Record<string, string> | null = null
      let unreachable: string | null = null
      if (selected.some((file) => file.change !== 'created')) {
        try {
          serverFiles = await read()
        } catch (error) {
          unreachable = unreachableReason(error)
          if (unreachable === null) throw error
        }
      }
      const files = selected.flatMap((file): FileDiff[] => {
        const after = local.texts[file.path] ?? null
        if (file.change === 'created') return textDiff(file.path, null, after, 'base')
        const before = serverFiles?.[file.path]
        if (before !== undefined && digest(before) === local.written.digests[file.path]) {
          return textDiff(file.path, before, after, 'base')
        }
        return [baseUnavailable(file, unreachable)]
      })
      const report: DiffReport = {
        dir: options.dir,
        against: 'base',
        ...(unreachable !== null ? { unreachable } : {}),
        files,
      }
      printDiffReport(output, report)
    })
}
