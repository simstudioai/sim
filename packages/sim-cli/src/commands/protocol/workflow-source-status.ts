/**
 * `sim workflows source status` and `sim workflows source diff`: what changed in one workflow's
 * source directory since it was read, on either side, without applying anything. Local changes
 * come from the file digests `.sim/written.json` records (for a `workflows/<key>` folder, the
 * workspace directory's record: `readFolderWritten`); the server's from the plan read
 * (`planWorkflowSource`: a dry run on the source-plan budget, never the source-write one), whose
 * `E_APPLY_STALE` says the workflow changed since the base.
 */
import { compareStrings } from '@sim/utils/string'
import { SOURCE_CODE_DIR, SOURCE_ENTRY_FILE } from '@sim/workflow-code/limits'
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
import type { GetWorkflowSourceResponse, PlanWorkflowSourceResponse } from '../../generated/v2-api'
import { SimApiError } from '../../http/client'
import { apiCommand } from '../../runtime/called-operations'
import {
  absoluteDirOption,
  digest,
  listSourceFiles,
  readFolderWritten,
  readPreviousLock,
  readSourceText,
  type Written,
} from './source-dir'
import {
  baseUnavailable,
  DIFF_HELP,
  type DiffReport,
  type FileDiff,
  loginCommand,
  nextStep,
  pathFilter,
  planFindings,
  printDiffReport,
  printStatusReport,
  readPlan,
  type ServerCheck,
  STATUS_EXIT_CODES_HELP,
  type StatusReport,
  statusExitCode,
  textDiff,
  unreachableReason,
} from './source-status'
import { refreshWorkflowWorkspaceTypes, withSourceExitCode } from './source-tree'
import type { Diagnostic } from './source-ui'
import { codeFilePaths, readBase, readLock, readSourceFiles } from './workflow-dir'

type PlanData = PlanWorkflowSourceResponse['data']

const PREFIX = 'sim workflows source'

/** The workflow directory as a status reads it, once. */
interface LocalWorkflow {
  base: Awaited<ReturnType<typeof readBase>>
  workflowId: string
  written: Written
  /** `workflow.ts` and every file under `functions/` an apply sends, by path. */
  texts: Record<string, string>
  changed: ChangedFile[]
  /** Files under `functions/` that neither `workflow.ts` nor the lock names: an apply never sends them. */
  unnamed: string[]
}

async function readLocalWorkflow(dir: string): Promise<LocalWorkflow> {
  const base = await readBase(dir, undefined)
  const { workflowId } = base
  const written = await readFolderWritten(dir)
  const entry = await readSourceText(dir, SOURCE_ENTRY_FILE)
  const sent = new Set(codeFilePaths(entry, await readPreviousLock(dir)))
  const listed = (await listSourceFiles(dir, SOURCE_CODE_DIR)).filter(
    (path) => !path.split('/').some((segment) => segment.startsWith('.'))
  )
  const texts: Record<string, string> = entry === null ? {} : { [SOURCE_ENTRY_FILE]: entry }
  for (const path of listed.filter((each) => sent.has(each))) {
    const text = await readSourceText(dir, path)
    if (text !== null) texts[path] = text
  }
  const current = Object.fromEntries(
    Object.entries(texts).map(([path, text]) => [path, digest(text)])
  )
  const unnamed = listed.filter((path) => !sent.has(path))
  // A recorded file still on disk that nothing names is left out on both sides, not deleted.
  const ignored = new Set(unnamed)
  return {
    base,
    workflowId,
    written,
    texts,
    changed: changedFiles(current, written.digests, (path) => !ignored.has(path)),
    unnamed,
  }
}

/** The dry run's summary: what applying would change in the graph, and its findings left over. */
interface WorkflowPlanSummary {
  blocksAdded: number
  blocksRemoved: number
  blocksModified: number
  edgesAdded: number
  edgesRemoved: number
  /** Removed variables: like removed blocks, applying them needs `--allow-delete`. */
  variablesRemoved: number
  /** Errors other than `E_APPLY_STALE`, which the status lists as drift or a conflict. */
  errors: number
  warnings: number
}

/** The dry run's findings the plan counts: all but `E_APPLY_STALE`, which the status lists. */
function workflowPlanFindings(data: PlanData): Diagnostic[] {
  return planFindings(data.diagnostics).filter((finding) => finding.code !== 'E_APPLY_STALE')
}

function planSummary(data: PlanData): WorkflowPlanSummary {
  const planned = workflowPlanFindings(data)
  const findings = (severity: string) =>
    planned.filter((finding) => finding.severity === severity).length
  return {
    blocksAdded: data.diff.blocks.added.length,
    blocksRemoved: data.diff.blocks.removed.length,
    blocksModified: data.diff.blocks.modified.length,
    edgesAdded: data.diff.edges.added,
    edgesRemoved: data.diff.edges.removed,
    variablesRemoved: data.diff.variables.removed.length,
    errors: findings('error'),
    warnings: findings('warning'),
  }
}

function planLine(plan: WorkflowPlanSummary): string {
  const variables = plan.variablesRemoved > 0 ? `, variables -${plan.variablesRemoved}` : ''
  return `Applying would: blocks +${plan.blocksAdded} -${plan.blocksRemoved} ~${plan.blocksModified}, connections +${plan.edgesAdded} -${plan.edgesRemoved}${variables}; ${plan.errors} error(s), ${plan.warnings} warning(s).`
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
  const [command, connect] = apiCommand(source, 'status', [
    'planWorkflowSource',
    'applyWorkflowSource',
    'getSourceResources',
  ])
  absoluteDirOption(command)
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
      let data: PlanData | null = null
      let serverChanges: ServerResourceChange[] = []
      let login: string | null = null
      if (!options.offline) {
        const { client, profile } = connect()
        const lock = await readLock(options.dir)
        const files = await readSourceFiles(options.dir, lock)
        try {
          const body = { files, lock, base: local.base }
          const response = await readPlan(
            () =>
              client.request<PlanWorkflowSourceResponse>('planWorkflowSource', {
                params: { workflowId },
                query: { allowDelete: true },
                body,
                retryRateLimited: true,
              }),
            () =>
              client.request<PlanWorkflowSourceResponse>('applyWorkflowSource', {
                params: { workflowId },
                query: { dryRun: true, allowDelete: true },
                body: { ...body, provenance: { client: 'cli' } },
                retryRateLimited: true,
              })
          )
          data = response.data
          await refreshWorkflowWorkspaceTypes(client, options.dir, local.base.workspaceId)
          if (data.diagnostics.some((finding) => finding.code === 'E_APPLY_STALE')) {
            serverChanges = [{ kind: 'workflow', key: workflowId, server: 'changed' }]
          }
        } catch (error) {
          if (error instanceof SimApiError && error.status === 404) {
            serverChanges = [{ kind: 'workflow', key: workflowId, server: 'deleted' }]
            note = 'The server has no workflow by this id that this profile can read.'
          } else {
            const reason = unreachableReason(error)
            if (reason === null) throw withSourceExitCode(error)
            login = loginCommand(error, profile.authProfile)
            server = 'unreachable'
            note = `${reason} Showing local changes only.`
          }
        }
      }
      const status = sourceStatus(locals, serverChanges)
      // A plan against a base the server moved past says nothing: applying it is refused as stale.
      const plan = data && serverChanges.length === 0 ? planSummary(data) : null
      const report: StatusReport<WorkflowPlanSummary> & { workflowId: string } = {
        workflowId,
        dir: options.dir,
        server,
        ...(note ? { note } : {}),
        ...status,
        ...(local.unnamed.length > 0 ? { unnamed: local.unnamed } : {}),
        plan,
        next: nextStep(status, {
          prefix: PREFIX,
          dir: options.dir,
          getArgs: `${workflowId} `,
          server,
          errors: plan?.errors ?? 0,
          deletes: (plan?.blocksRemoved ?? 0) + (plan?.variablesRemoved ?? 0) > 0,
          scope: '',
          login,
        }),
      }
      printStatusReport(
        output,
        `Workflow ${workflowId} in ${options.dir}`,
        report,
        planLine,
        data ? workflowPlanFindings(data) : []
      )
      setSoftExitCode(statusExitCode(status.state, login))
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
  absoluteDirOption(command)
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
      const filter = pathFilter(filters, options.dir)
      const selects = filter.selects
      const read = async () => {
        const { client } = connect()
        try {
          const response = await client.request<GetWorkflowSourceResponse>('getWorkflowSource', {
            params: { workflowId: local.workflowId },
          })
          return response.data.files
        } catch (error) {
          throw withSourceExitCode(error)
        }
      }
      if (options.server) {
        const serverFiles = await read()
        const every = [...new Set([...Object.keys(local.texts), ...Object.keys(serverFiles)])]
        filter.assertEachMatches(every)
        const paths = every.filter(selects).sort(compareStrings)
        printDiffReport(output, {
          dir: options.dir,
          against: 'server',
          files: paths.flatMap((path) =>
            textDiff(path, serverFiles[path] ?? null, local.texts[path] ?? null, 'server')
          ),
        })
        return
      }
      filter.assertEachMatches([...Object.keys(local.texts), ...Object.keys(local.written.digests)])
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
