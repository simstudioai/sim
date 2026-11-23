import { toRecord } from '@sim/utils/object'
import { SOURCE_ENTRY_FILE as ENTRY_FILE } from '@sim/workflow-code/limits'
import type { Command } from 'commander'
import { printError } from '#sim-cli/output/io'
import { setSoftExitCode } from '../../embed-context'
import type {
  ApplyWorkflowSourceBody,
  ApplyWorkflowSourceResponse,
  CreateWorkflowFromSourceBody,
  DeployWorkflowResponse,
  GetWorkflowDeploymentResponse,
} from '../../generated/v2-api'
import { SimApiError } from '../../http/client'
import { apiCommand, type OperationClient } from '../../runtime/called-operations'
import { searchTasks } from '../search'
import {
  type DeployedUrl,
  deployedUrls,
  deployedUrlsText,
  lockBlockNames,
  namedUrls,
} from './deployed-urls'
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
  withSourceCommandLock,
  writeBack,
} from './source-dir'
import { SOURCE_WRITE_EXIT_CODES_HELP, sourceExitCodesHelp } from './source-exit-codes'
import { cachedCatalogByHash, printTreeResult, refreshWorkflowWorkspaceTypes } from './source-tree'
import {
  type CreatedResource,
  createdText,
  type FindingsOutput,
  findingsOutput,
  fresh,
  isMachine,
  printRefusal,
  refusedExitCode,
  shellWord,
  verboseFlag,
  type WriteMode,
  writeMode,
} from './source-ui'
import { type NextStep, runSourceWrite } from './source-write'
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

type SourceApplyData = ApplyWorkflowSourceResponse['data']

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

/** Whether a write in `mode` only reads the directory: a dry run, or a plan that stops before writing. */
function isReadOnly(mode: WriteMode): boolean {
  return mode === 'dry-run' || mode === 'plan'
}

type SourceWriteOperation = 'applyWorkflowSource' | 'createWorkflowFromSource'

/**
 * A workflow `apply` or `create` through {@link runSourceWrite}: refuse a code file the directory
 * could never hold, then preview, ask or stop at the plan, send, print the diagnostics, and after
 * a successful write save it into the directory with the caller's `save`. The deploy step runs
 * after, on a stored write only, and the result is reported last.
 */
async function writeWorkflowSource<Operation extends SourceWriteOperation>(args: {
  options: SourceWriteOptions
  mode: WriteMode
  creating: boolean
  question: string
  client: OperationClient<Operation | 'deployWorkflow' | 'getWorkflowDeployment'>
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
  const findings = findingsOutput(args.output, options.verbose, options.dir)
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
        ...(deployment.urls?.length ? { urls: deployedUrlsText(deployment.urls) } : {}),
      }
    )
  }
  const hasErrors = (data: SourceApplyData) =>
    data.diagnostics.some((diagnostic) => diagnostic.severity === 'error')
  /** Whether a committed answer stored the write: not refused, and a create that applied. */
  const stored = (data: SourceApplyData) =>
    !data.dryRun && !hasErrors(data) && (data.applied || !creating)
  const { mode } = args
  const verb = creating ? 'create' : 'apply'
  const data = await runSourceWrite<SourceApplyData>({
    mode,
    preview: () => send(true),
    show: (preview) => printFindings(preview, findings, notes),
    refuses: hasErrors,
    // A machine result carries the same counts, so its stderr holds findings and notes only; a
    // person asked to confirm still reads what the write would change.
    explain: (preview) => {
      if (!findings.machine || mode === 'ask') printError(diffSummary(preview))
    },
    commit: async () => {
      const answer = await send(false)
      printFindings(answer, findings, notes)
      if (hasErrors(answer)) setSoftExitCode(refusedExitCode(answer.diagnostics))
      return answer
    },
    save: async (answer) => {
      if (stored(answer)) await args.save(answer)
    },
    report: (answer, next) => report(answer, next ? { next } : {}),
    question: args.question,
    command: args.command,
    interrupt: { verb, dir: options.dir, noun: 'workflow', ifAnswerLost: args.ifAnswerLost },
  })
  if (!data) return

  if (mode === 'write' && stored(data) && !findings.machine) printError(diffSummary(data))
  let deployment: DeployOutcome = {}
  if (stored(data)) {
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
  /** The URL of each webhook the live deployment serves. */
  urls?: DeployedUrl[]
  next?: NextStep
}

/**
 * After a stored write: with `--deploy`, deploys the workflow through the same operation as
 * `sim workflows deploy` (so the same permission check, on the server); without it, names that
 * command as the next step when the workflow is deployed and its draft now differs. A failed
 * deploy says the write itself was saved.
 */
async function deployStep(
  client: OperationClient<'deployWorkflow' | 'getWorkflowDeployment'>,
  data: SourceApplyData,
  options: { deploy?: boolean; dir: string; verb: string; machine: boolean }
): Promise<DeployOutcome> {
  // Pinned to the draft this write stored, as `--deploy` is: an edit made since is never deployed.
  const deployCommand = `sim workflows deploy ${data.workflowId} --expected-draft-fingerprint ${data.base.fingerprint}`
  if (!options.deploy) {
    if (!data.needsRedeployment) return {}
    return {
      next: {
        command: deployCommand,
        reason: `The workflow is deployed and its draft now differs from the live version: deploy to make the change live (or ${options.verb} with --deploy).`,
      },
    }
  }
  if (!data.applied && !data.needsRedeployment) {
    // A no-op write changed no draft: when the live version already matches it, a deploy would
    // only publish the same version again.
    const status = await client
      .request<GetWorkflowDeploymentResponse>('getWorkflowDeployment', {
        params: { workflowId: data.workflowId },
      })
      .then(
        (response) => response.data,
        (error: unknown) => {
          throw deployFailure(error, options, deployCommand)
        }
      )
    if (status.isDeployed && !status.needsRedeployment) {
      if (!options.machine)
        printError('The live version already matches the draft; nothing was deployed.')
      return {
        deployed: {
          ...(status.activeDeployment ? { version: status.activeDeployment.version } : {}),
          isDeployed: true,
        },
        needsRedeployment: false,
        urls: namedUrls(status.webhooks, lockBlockNames(data.lock)),
      }
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
    ...(deployed.isDeployed
      ? { urls: await deployedUrls(client, data.workflowId, lockBlockNames(data.lock)) }
      : {}),
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
    'getWorkflowDeployment',
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
      `${sourceExitCodesHelp('workflows source apply')}${SOURCE_WRITE_EXIT_CODES_HELP}`
    )
    .action(async (named: string | undefined, options: SourceWriteOptions) => {
      const mode = writeMode(options)
      await withSourceCommandLock(
        options.dir,
        async () => {
          assertDeployable(options)
          await assertSourceDirKind(options.dir, 'workflow')
          const { client, profile } = connectApply()
          const lock = await readLock(options.dir)
          const base = await readBase(options.dir, named)
          const workflowId = base.workflowId
          const files = await readSourceFiles(options.dir, lock)
          if (!isReadOnly(mode)) {
            await refreshWorkflowWorkspaceTypes(client, options.dir, base.workspaceId)
          }
          await writeWorkflowSource<'applyWorkflowSource'>({
            options,
            mode,
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
        },
        { readOnly: isReadOnly(mode) }
      )
    })
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
    'getWorkflowDeployment',
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
      `${sourceExitCodesHelp('workflows source create')}${SOURCE_WRITE_EXIT_CODES_HELP}`
    )
    .action(async (options: SourceWriteOptions & { name?: string; folder?: string }) => {
      const mode = writeMode(options)
      await withSourceCommandLock(
        options.dir,
        async () => {
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
            const next: NextStep = {
              command: `${createCommand(shellWord(options.dir), workspaceId)} --yes`,
              reason: `${options.dir} had no ${ENTRY_FILE}, so a starter, the SDK types for workspace ${workspaceId}, tsconfig.json, .sim/AGENTS.md and the examples in .sim/examples/ were written and nothing was created. Edit ${ENTRY_FILE}, check it, then create it.`,
            }
            const machine = isMachine(profile.output)
            if (!machine) printError(`${next.reason} Next: ${next.command}`)
            printTreeResult(profile.output, {
              created: false,
              scaffolded: true,
              ...tree,
              ...(machine ? { next } : {}),
            })
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
          if (!isReadOnly(mode)) {
            await refreshWorkflowWorkspaceTypes(client, options.dir, workspaceId)
          }
          await writeWorkflowSource<'createWorkflowFromSource'>({
            options,
            mode,
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
        },
        { readOnly: isReadOnly(mode) }
      )
    })
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
