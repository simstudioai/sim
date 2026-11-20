import { toRecord } from '@sim/utils/object'
import { SOURCE_ENTRY_FILE as ENTRY_FILE } from '@sim/workflow-code/limits'
import type { Command } from 'commander'
import { printError } from '#sim-cli/output/io'
import { DEFERRED_INTERRUPT_BOUND_MS, deferInterrupts } from '#sim-cli/terminal/interrupts'
import { setSoftExitCode } from '../../embed-context'
import type {
  ApplyWorkflowSourceBody,
  ApplyWorkflowSourceResponse,
  CreateWorkflowFromSourceBody,
  DeployWorkflowResponse,
} from '../../generated/v2-api'
import { SimApiError } from '../../http/client'
import { apiCommand, type OperationClient } from '../../runtime/called-operations'
import { searchTasks } from '../search'
import { gitProvenance } from './git-provenance'
import { CliUsageError, SourceDirError } from './local-errors'
import { printProtocolResult } from './result'
import {
  absoluteDirOption,
  assertSendableCodeFiles,
  assertSourceDirKind,
  readSourceText,
  readStarterWorkspace,
  SOURCE_AGENTS_FILE,
  SOURCE_STARTER_FILE,
  updateSourceDir,
  WORKSPACE_FOLDER_BUSY_HELP,
  withWorkspaceFolderLock,
  writeBack,
} from './source-dir'
import { SOURCE_WRITE_EXIT_CODES_HELP } from './source-exit-codes'
import { cachedCatalogByHash, printTreeResult, refreshWorkflowWorkspaceTypes } from './source-tree'
import {
  type CreatedResource,
  confirm,
  createdText,
  type FindingsOutput,
  findingsOutput,
  fresh,
  planNext,
  printRefusal,
  refusedExitCode,
  shellWord,
  stopAtPlan,
  verboseFlag,
  writeMode,
} from './source-ui'
import { storedEdgesWrite } from './stored-edges'
import {
  createCommand,
  readBase,
  readLock,
  readSourceFiles,
  refreshWorkflowTsconfigs,
  writeSourceDirectory,
  writeSourceScaffold,
} from './workflow-dir'

const APPLY_EXIT_CODES_HELP = `
Exit codes: 0 applied (or a clean dry run); 1 the source has errors (each printed as
file:line:column with its frame and hint) or the command failed; 5 the workflow changed since the
directory was read (SOURCE_STALE, on a dry run too: get it again, reapply the edit, retry);
6 the workflow or its folder is locked (E_APPLY_LOCKED; a locked block exits 1,
E_APPLY_LOCKED_BLOCK); 7 the source is too large; 9 rate limited (HTTP 429) after the CLI's
retries, so nothing was written: wait a minute and run it again; 14 without --yes and with no
terminal to ask: the plan was printed with no errors and nothing was written (run the same
command with --yes to apply it).`

const CREATE_EXIT_CODES_HELP = `
Exit codes: 0 created (or a clean dry run, or a starter written); 1 the source has errors (each
printed as file:line:column with its frame and hint), the workflow name is taken
(SOURCE_NAME_TAKEN: pass --name), or the command failed (a starter is created in the
workspace its types were written for unless --workspace names another); 6 the folder is locked; 7 the
source is too large; 9 rate limited (HTTP 429) after the CLI's retries, so nothing was created:
wait a minute and run it again; 14 without --yes and with no terminal to ask: the plan was
printed with no errors and nothing was created (run the same command with --yes).`

type SourceApplyData = ApplyWorkflowSourceResponse['data']

type SourceBase = ApplyWorkflowSourceBody['base']

interface SourceWriteOptions {
  dir: string
  dryRun?: boolean
  yes?: boolean
  allowDelete?: boolean
  verbose?: boolean
  deploy?: boolean
}

/**
 * Prints a write's diagnostics and, in a display format, its notes (such as a custom tool the
 * save could not store; a machine result lists them), each once: after a terminal preview, the
 * write it confirmed prints only what the preview did not.
 */
function printFindings(data: SourceApplyData, findings: FindingsOutput, notes: Set<string>): void {
  findings.print(data.diagnostics)
  if (findings.machine) return
  for (const note of data.notes) {
    if (fresh(notes, note)) printError(`note: ${note}`)
  }
}

/** One line naming what the apply changes, shown before asking to confirm it. */
function diffSummary(data: SourceApplyData): string {
  const { blocks, edges, variables } = data.diff
  if (data.diff.noop) return 'No graph changes (names, order or comments may still be saved).'
  const parts = [
    `${blocks.added.length} added`,
    `${blocks.removed.length} removed`,
    `${blocks.renamed.length} renamed`,
    `${blocks.modified.length} modified`,
  ]
  const variableChanges = [
    ...(['added', 'removed', 'modified'] as const).flatMap((change) =>
      variables[change].length > 0 ? [`${change} ${variables[change].join(', ')}`] : []
    ),
    ...renamedVariables(variables).map(({ from, to }) => `renamed ${from} → ${to}`),
  ]
  const modified = blocks.modified.map(({ key, fields }) => `${key} (${fields.join(', ')})`)
  const typed = (list: ReadonlyArray<{ key: string; type: string }>) =>
    list.map(({ key, type }) => `${key} (${type})`).join('; ')
  return `Blocks: ${parts.join(', ')}. Connections: +${edges.added} -${edges.removed}.${
    blocks.added.length > 0 ? `\nAdded: ${typed(blocks.added)}` : ''
  }${blocks.removed.length > 0 ? `\nRemoved: ${typed(blocks.removed)}` : ''}${
    modified.length > 0 ? `\nModified: ${modified.join('; ')}` : ''
  }${variableChanges.length > 0 ? `\nVariables: ${variableChanges.join('; ')}` : ''}`
}

type SourceWriteOperation = 'applyWorkflowSource' | 'createWorkflowFromSource'

/**
 * The shared write flow of `apply` and `create`: refuse a write without consent when no terminal
 * can ask, preview and ask on a terminal, send, print the diagnostics, and after a successful
 * write save it into the directory with the caller's `save`. From the send through the save an
 * interrupt waits for them ({@link deferInterrupts}), so Ctrl-C never strands a stored write the
 * directory did not record.
 */
async function runSourceWrite<Operation extends SourceWriteOperation>(args: {
  options: SourceWriteOptions
  creating: boolean
  question: string
  client: OperationClient<Operation | 'deployWorkflow'>
  operation: Operation
  params: Record<string, string>
  body: ApplyWorkflowSourceBody | CreateWorkflowFromSourceBody
  output: Parameters<typeof printProtocolResult>[0]
  /** Saves a successful write into the directory. */
  save: (data: SourceApplyData) => Promise<void>
  /** The next step when the write's answer never came back, so it may have been stored. */
  ifAnswerLost: string
  /** This write as a command, without `--yes`: what a `plan` run names next with it. */
  command: string
}): Promise<void> {
  const { options, creating } = args
  assertSendableCodeFiles(args.body.files)
  /** Sends the write (or its dry run); a refusal prints its diagnostics and rethrows. */
  const send = async (dryRun: boolean): Promise<SourceApplyData> => {
    try {
      const query = {
        ...(dryRun ? { dryRun: true } : {}),
        ...(options.allowDelete ? { allowDelete: true } : {}),
      }
      const response = await args.client.request<ApplyWorkflowSourceResponse>(args.operation, {
        params: args.params,
        ...(Object.keys(query).length > 0 ? { query } : {}),
        body: args.body,
        retryRateLimited: true,
      })
      return response.data
    } catch (error) {
      return printRefusal(error, args.output, {
        ...(dryRun ? {} : { ifAnswerLost: args.ifAnswerLost }),
        verbose: options.verbose === true,
      })
    }
  }
  const findings = findingsOutput(args.output, options.verbose)
  const notes = new Set<string>()
  const report = (data: SourceApplyData, deployment: DeployOutcome = {}) => {
    const result = { ...summarize(data, creating, findings.machine), ...deployment }
    printProtocolResult(
      args.output,
      { ...result, ...findings.result(data.diagnostics) },
      {
        ...(result.created ? { created: createdText(result.created) } : {}),
        ...(deployment.next ? { next: deployment.next.command } : {}),
        ...(deployment.deployed
          ? { deployed: `version ${deployment.deployed.version ?? '?'}` }
          : {}),
      }
    )
  }
  const mode = writeMode(options)
  if (mode === 'ask' || mode === 'plan') {
    const preview = await send(true)
    printFindings(preview, findings, notes)
    if (preview.diagnostics.some((diagnostic) => diagnostic.severity === 'error')) {
      setSoftExitCode(refusedExitCode(preview.diagnostics))
      report(preview)
      return
    }
    printError(diffSummary(preview))
    if (mode === 'plan') {
      stopAtPlan()
      report(preview, { next: planNext(args.command) })
      return
    }
    if (!(await confirm(args.question))) {
      throw new SourceDirError('Nothing was applied.', { code: 'CANCELLED' })
    }
  }

  const verb = creating ? 'create' : 'apply'
  let refused = false
  const sendAndSave = async (): Promise<SourceApplyData> => {
    const data = await send(options.dryRun === true)
    printFindings(data, findings, notes)
    refused = data.diagnostics.some((diagnostic) => diagnostic.severity === 'error')
    if (refused) setSoftExitCode(refusedExitCode(data.diagnostics))
    if (!data.dryRun && !refused && (data.applied || !creating)) await args.save(data)
    return data
  }
  const data = options.dryRun
    ? await sendAndSave()
    : await deferInterrupts(sendAndSave, {
        waiting: `Interrupted: the ${verb} was already sent. Waiting up to ${DEFERRED_INTERRUPT_BOUND_MS / 1000}s for its answer and saving it into ${options.dir}, so the directory matches the workflow; press Ctrl-C again to stop now.`,
        abandoned: `Stopped before the ${verb} answered. ${args.ifAnswerLost}`,
      })

  const stored = !data.dryRun && !refused && (data.applied || !creating)
  if (mode === 'write' && stored) printError(diffSummary(data))
  let deployment: DeployOutcome = {}
  if (stored) {
    try {
      deployment = await deployStep(args.client, data, {
        ...options,
        verb,
        machine: findings.machine,
      })
    } catch (error) {
      // The write stands: its result prints before the deploy's failure.
      report(data)
      throw error
    }
  }
  report(data, deployment)
}

/** What a write adds to its result about deploying: the deploy it ran, or the one to run. */
interface DeployOutcome {
  deployed?: { version?: number; isDeployed: boolean; warnings?: string[] }
  needsRedeployment?: boolean
  next?: { command: string; reason: string }
}

/**
 * After a stored write: with `--deploy`, deploys the workflow through the same operation as
 * `sim workflows deploy` (so the same permission check, on the server); without it, names that
 * command as the next step when the workflow is deployed and its draft now differs. A failed
 * deploy says the write itself was saved.
 */
async function deployStep(
  client: OperationClient<'deployWorkflow'>,
  data: SourceApplyData,
  options: { deploy?: boolean; dir: string; verb: string; machine: boolean }
): Promise<DeployOutcome> {
  const deployCommand = `sim workflows deploy ${data.workflowId}`
  if (!options.deploy) {
    if (!data.needsRedeployment) return {}
    return {
      next: {
        command: deployCommand,
        reason: `The workflow is deployed and its draft now differs from the live version: deploy to make the change live (or ${options.verb} with --deploy).`,
      },
    }
  }
  const deployed = await client
    .request<DeployWorkflowResponse>('deployWorkflow', {
      params: { workflowId: data.workflowId },
      // The draft this write stored: an edit made since is refused, never deployed in its name.
      body: { expectedDraftFingerprint: data.base.fingerprint },
    })
    .then(
      (response) => response.data,
      (error: unknown) => {
        throw deployFailure(error, options, deployCommand)
      }
    )
  if (!options.machine) {
    for (const warning of deployed.warnings) printError(`deploy warning: ${warning}`)
  }
  return {
    deployed: {
      ...(deployed.version !== undefined ? { version: deployed.version } : {}),
      isDeployed: deployed.isDeployed,
      ...(options.machine && deployed.warnings.length > 0 ? { warnings: deployed.warnings } : {}),
    },
    needsRedeployment: false,
  }
}

/** A failed deploy after a saved write, saying the write itself stands and how to deploy it. */
function deployFailure(
  error: unknown,
  options: { dir: string; verb: string },
  deployCommand: string
): unknown {
  if (!(error instanceof SimApiError)) return error
  return new SimApiError(
    `The ${options.verb} was saved into ${options.dir}, but the deploy failed: ${error.message} Fix that, then run \`${deployCommand}\`.`,
    error.status,
    error.code,
    error.details,
    error.exitCode,
    error.requestId
  )
}

/** Refuses `--deploy` beside `--dry-run`: a dry run stores nothing to deploy. */
function assertDeployable(options: SourceWriteOptions): void {
  if (options.deploy && options.dryRun) {
    throw new CliUsageError(
      '--deploy deploys what the write saves, and --dry-run saves nothing: drop one of them.'
    )
  }
}

const DIR_DESCRIPTION =
  'Source directory: workflow.ts, functions/*, .sim/lock.json and .sim/base.json'

/**
 * `sim workflows source apply [workflowId] --dir <dir>`: sends a source directory written by
 * `workflows source get` (`workflow.ts`, its function-code files, `.sim/lock.json` and
 * `.sim/base.json`) and, after a successful write, saves the re-printed files, the new lock and
 * the new base back into it, so the next apply starts from what was stored. The workflow id
 * defaults to the one `.sim/base.json` names; given, it must match it.
 *
 * Writing needs consent: on a terminal it shows the dry-run outcome and asks; anywhere else it
 * needs `--yes`. `--dry-run` writes nothing, so it never asks.
 */
export function attachWorkflowSourceApply(source: Command): void {
  const [command, connectApply] = apiCommand(source, 'apply', [
    'applyWorkflowSource',
    'deployWorkflow',
    'getSourceResources',
  ])
  absoluteDirOption(command)
  verboseFlag(command)
  command
    .argument(
      '[workflowId]',
      'Workflow whose draft the source replaces (default: the workflowId in .sim/base.json)'
    )
    .option('--dir <dir>', DIR_DESCRIPTION, '.')
    .option('--dry-run', 'Check the source and show the outcome without saving or writing files')
    .option('-y, --yes', 'Apply without asking for confirmation')
    .option(
      '--deploy',
      'After the write is saved, deploy the workflow (as `sim workflows deploy <workflowId>` does)'
    )
    .option(
      '--allow-delete',
      'Delete blocks and variables the source no longer declares; without it, an apply that deletes one is refused'
    )
    .allowExcessArguments(false)
    .description('Apply a workflow source directory to a workflow draft')
    .addHelpText(
      'after',
      `${APPLY_EXIT_CODES_HELP}${WORKSPACE_FOLDER_BUSY_HELP}${SOURCE_WRITE_EXIT_CODES_HELP}`
    )
    .action(async (named: string | undefined, options: SourceWriteOptions) =>
      withWorkspaceFolderLock(options.dir, async () => {
        assertDeployable(options)
        await assertSourceDirKind(options.dir, 'workflow')
        const { client, profile } = connectApply()
        const lock = await readLock(options.dir)
        const base = await readBase(options.dir, named)
        const workflowId = base.workflowId
        const files = await readSourceFiles(options.dir, lock)
        if (!options.dryRun) {
          await refreshWorkflowWorkspaceTypes(client, options.dir, base.workspaceId)
        }
        await runSourceWrite<'applyWorkflowSource'>({
          options,
          creating: false,
          question: `Apply these changes to workflow ${workflowId}?`,
          command: `sim workflows source apply --dir ${shellWord(options.dir)}${options.allowDelete ? ' --allow-delete' : ''}${options.deploy ? ' --deploy' : ''}`,
          output: profile.output,
          client,
          operation: 'applyWorkflowSource',
          params: { workflowId },
          body: {
            files,
            lock,
            base,
            provenance: { client: 'cli', ...(await gitProvenance(options.dir)) },
          },
          save: async (data) => {
            const edges = storedEdgesWrite(
              data,
              cachedCatalogByHash(toRecord(data.base).catalogHash)
            )
            await writeBack(options.dir, data, lock, { write: edges ? [edges] : [] })
            await refreshWorkflowTsconfigs(options.dir, data)
          },
          ifAnswerLost: `It may have been saved. Run \`sim workflows source apply ${workflowId} --dir ${options.dir} --dry-run\`: exit 5 (stale) means the draft changed since this directory was read, by this apply or by someone else. Run \`sim workflows source get ${workflowId} --dir <fresh dir>\` and compare it with ${options.dir}: if it holds your edit, \`sim workflows source get ${workflowId} --dir ${options.dir} --force\` brings this directory up to date; if not, reapply your edit in the fresh directory. Any other outcome means it was not saved: apply again.`,
        })
      })
    )
}

/**
 * `sim workflows source create --dir <dir>`: creates a workflow from the directory's
 * `workflow.ts`, then writes what `get --dir` would have: the new workflow's re-printed files, its
 * lock files, the SDK declarations, `tsconfig.json` and the agent guide, so the directory is ready
 * for the edit loop. Same consent rule as `apply`.
 */
export function attachWorkflowSourceCreate(source: Command): void {
  const [command, connectCreate] = apiCommand(source, 'create', [
    'createWorkflowFromSource',
    'getSourceCatalog',
    'getSourceResources',
    'deployWorkflow',
  ])
  absoluteDirOption(command)
  verboseFlag(command)
  searchTasks(command, [
    'build a new workflow',
    'create a new workflow as code',
    'author or write a workflow in TypeScript',
    'build a workflow that answers questions with an agent over a knowledge base, table or integration',
  ])
  command
    .requiredOption(
      '--dir <dir>',
      'Source directory: workflow.ts and functions/*. Without workflow.ts, writes a starter and the types instead (an error with --dry-run or --yes)'
    )
    .option('--dry-run', 'Check the source and show the outcome without creating anything')
    .option('--name <name>', "The workflow name (default: the source's)")
    .option('--folder <path>', 'The folder to create it in (default: the root)')
    .option('-y, --yes', 'Create without asking for confirmation')
    .option(
      '--deploy',
      'After the write is saved, deploy the workflow (as `sim workflows deploy <workflowId>` does)'
    )
    .allowExcessArguments(false)
    .description('Create a workflow from a workflow source directory')
    .addHelpText(
      'after',
      `${CREATE_EXIT_CODES_HELP}${WORKSPACE_FOLDER_BUSY_HELP}${SOURCE_WRITE_EXIT_CODES_HELP}`
    )
    .action(async (options: SourceWriteOptions & { name?: string; folder?: string }) =>
      withWorkspaceFolderLock(options.dir, async () => {
        await assertSourceDirKind(options.dir, 'workflow')
        if ((await readSourceText(options.dir, ENTRY_FILE)) === null) {
          if (options.dryRun || options.yes) {
            throw new SourceDirError(
              `${options.dir} has no ${ENTRY_FILE}, so there is nothing to ${options.dryRun ? 'check' : 'create'}. Write ${ENTRY_FILE} there, or run \`sim workflows source create --dir ${options.dir}\` without --dry-run and --yes to write a starter.`
            )
          }
          const { client, profile } = connectCreate()
          const workspaceId = client.requireWorkspace()
          const tree = await writeSourceScaffold(client, options.dir, workspaceId)
          printError(
            `${options.dir} had no ${ENTRY_FILE}, so a starter, the SDK types for workspace ${workspaceId}, tsconfig.json, .sim/AGENTS.md and the examples in .sim/examples/ were written and nothing was created. Edit ${ENTRY_FILE}, then run \`${createCommand(options.dir, workspaceId)} --yes\`.`
          )
          printTreeResult(profile.output, { created: false, scaffolded: true, ...tree })
          return
        }
        assertDeployable(options)
        const { client, profile } = connectCreate()
        // A starter is bound to the workspace its types were written for, as a get directory
        // is to the one it was read from; --workspace still chooses another.
        const starterWorkspace =
          profile.sources.workspaceId === 'flag' ? null : await readStarterWorkspace(options.dir)
        const workspaceId = client.requireWorkspace(starterWorkspace ?? undefined)
        const files = await readSourceFiles(options.dir, null)
        if (!options.dryRun) await refreshWorkflowWorkspaceTypes(client, options.dir, workspaceId)
        await runSourceWrite<'createWorkflowFromSource'>({
          options,
          creating: true,
          question: 'Create this workflow?',
          command: `${createCommand(shellWord(options.dir), workspaceId)}${options.name !== undefined ? ` --name ${shellWord(options.name)}` : ''}${options.folder !== undefined ? ` --folder ${shellWord(options.folder)}` : ''}${options.deploy ? ' --deploy' : ''}`,
          output: profile.output,
          client,
          operation: 'createWorkflowFromSource',
          params: { workspaceId },
          ifAnswerLost: `It may have been created. Run this command again: a SOURCE_NAME_TAKEN refusal means it was, so find its id with \`sim workflows list\` and run \`sim workflows source get <workflowId> --dir ${options.dir} --force\`.`,
          save: async (data) => {
            await writeSourceDirectory(client, options.dir, data, [])
            await updateSourceDir(options.dir, { write: [], remove: [SOURCE_STARTER_FILE] })
          },
          body: {
            files,
            ...(options.name !== undefined ? { name: options.name } : {}),
            ...(options.folder !== undefined ? { folderPath: options.folder } : {}),
            provenance: { client: 'cli', ...(await gitProvenance(options.dir)) },
          },
        })
      })
    )
}

/** The variables a diff renames, none when the answer lists none. */
function renamedVariables(
  variables: SourceApplyData['diff']['variables']
): ReadonlyArray<{ from: string; to: string }> {
  return variables.renamed ?? []
}

/** Whether a diff adds, removes or changes any workflow variable. */
function variablesChanged(variables: SourceApplyData['diff']['variables']): boolean {
  return (
    variables.added.length > 0 ||
    variables.removed.length > 0 ||
    renamedVariables(variables).length > 0 ||
    variables.modified.length > 0
  )
}

/**
 * What a write created (on a dry run, would create; ids are only known once it is written): the
 * workflow of a create, then each block added.
 */
function createdResources(data: SourceApplyData, creating: boolean): CreatedResource[] {
  const written = !data.dryRun && data.applied
  return [
    ...(creating ? [{ kind: 'workflow', ...(written ? { id: data.workflowId } : {}) }] : []),
    ...data.diff.blocks.added.map(({ key, id }) => ({
      kind: 'block',
      key,
      ...(written ? { id } : {}),
    })),
  ]
}

/**
 * The result of a write. A create that did not apply stored nothing, so its provisional workflow
 * id names no workflow. Notes are listed in a `machine` result, and counted in a display one,
 * which prints them on stderr.
 */
function summarize(data: SourceApplyData, creating: boolean, machine: boolean) {
  const created = data.dryRun || data.applied ? createdResources(data, creating) : []
  return {
    ...(creating && !data.applied ? {} : { workflowId: data.workflowId }),
    applied: data.applied,
    dryRun: data.dryRun,
    noop: data.diff.noop,
    ...(created.length > 0 ? { created } : {}),
    blocksAdded: data.diff.blocks.added.length,
    ...(data.diff.blocks.added.length > 0 && {
      added: data.diff.blocks.added.map(({ key, type }) => ({ block: key, type })),
    }),
    blocksRemoved: data.diff.blocks.removed.length,
    ...(data.diff.blocks.removed.length > 0 && {
      removed: data.diff.blocks.removed.map(({ key, type }) => ({ block: key, type })),
    }),
    blocksModified: data.diff.blocks.modified.length,
    ...(data.diff.blocks.modified.length > 0 && {
      modified: data.diff.blocks.modified.map(({ key, fields }) => ({ block: key, fields })),
    }),
    edgesAdded: data.diff.edges.added,
    edgesRemoved: data.diff.edges.removed,
    ...(variablesChanged(data.diff.variables) && { variables: data.diff.variables }),
    errors: data.diagnostics.filter((diagnostic) => diagnostic.severity === 'error').length,
    warnings: data.diagnostics.filter((diagnostic) => diagnostic.severity === 'warning').length,
    notes: machine ? data.notes : data.notes.length,
    fingerprint: data.base.fingerprint,
    needsRedeployment: data.needsRedeployment,
    ...(creating && data.applied && !data.dryRun ? { guide: SOURCE_AGENTS_FILE } : {}),
  }
}
