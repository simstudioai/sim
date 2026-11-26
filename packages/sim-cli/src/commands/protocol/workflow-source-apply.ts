import { toRecord } from '@sim/utils/object'
import { SOURCE_ENTRY_FILE as ENTRY_FILE } from '@sim/workflow-code/limits'
import type { Command } from 'commander'
import { publishSummary } from '#sim-cli/output/github-actions'
import { printError } from '#sim-cli/output/io'
import type { NextStep } from '#sim-cli/output/next-step'
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
import {
  draftIsLive,
  liveAfterActivation,
  liveAgainstDraft,
  liveDeploymentStatus,
} from '../../runtime/deployment-live'
import { runFailureMessage } from '../../runtime/execute'
import { withRunNext } from '../../runtime/run-next'
import { searchTasks } from '../search'
import {
  type DeployedUrl,
  deployedUrlsText,
  deploymentAfterDeploy,
  lockBlockNames,
  namedUrls,
} from './deployed-urls'
import { gitProvenance } from './git-provenance'
import { CliUsageError, SourceDirError } from './local-errors'
import { printProtocolResult } from './result'
import { printRunFailureSite } from './run-source-location'
import { folderChildResults } from './source-check'
import {
  absoluteDirOption,
  assertSendableCodeFiles,
  assertSourceDirKind,
  directoryWorkspace,
  readSourceText,
  recordedWorkspace,
  SOURCE_AGENTS_FILE,
  SOURCE_STARTER_FILE,
  updateSourceDir,
  withSourceCommandLock,
  writeBack,
} from './source-dir'
import { sourceExitCodesHelp } from './source-exit-codes'
import { cachedCatalogByHash, printTreeResult, refreshWorkflowWorkspaceTypes } from './source-tree'
import {
  type CreatedResource,
  createdText,
  errorBullets,
  type FindingsOutput,
  findingsOutput,
  fresh,
  isMachine,
  markdownCell,
  printRefusal,
  refusedExitCode,
  SUMMARY_ROWS,
  shellWord,
  summaryFileFlag,
  summaryFileOption,
  summaryMarker,
  verboseFlag,
  type WriteMode,
  writeMode,
} from './source-ui'
import { runSourceWrite } from './source-write'
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
import { dryRunDraft, printSideEffects } from './workflow-run-follow'

type SourceApplyData = ApplyWorkflowSourceResponse['data']

interface SourceWriteOptions {
  dir: string
  dry?: boolean
  yes?: boolean
  allowDelete?: boolean
  verbose?: boolean
  deploy?: boolean
  /** `--run [input]`: the test run's input as `--input` takes it, or `true` for none. */
  run?: string | true
  summaryFile?: string
}

/** The `--run` flag as written in a next command. */
function runFlag(run: SourceWriteOptions['run']): string {
  if (run === undefined) return ''
  return run === true ? ' --run' : ` --run ${shellWord(run)}`
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

/** What changed in the workflow's variables, one entry per kind of change. */
function variableChangeList(variables: SourceApplyData['diff']['variables']): string[] {
  return [
    ...(['added', 'removed', 'modified'] as const).flatMap((change) =>
      variables[change].length > 0 ? [`${change} ${variables[change].join(', ')}`] : []
    ),
    ...variables.renamed.map(({ from, to }) => `renamed ${from} → ${to}`),
  ]
}

type BlockDiff = SourceApplyData['diff']['blocks']

/** An added or removed block as a person and a JSON result name it: `key (type)`. */
const typedBlock = ({ key, type }: BlockDiff['added'][number]) => `${key} (${type})`

/** A modified block and the fields that changed: `key (field, …)`. */
const modifiedBlock = ({ key, fields }: BlockDiff['modified'][number]) =>
  `${key} (${fields.join(', ')})`

/** How many blocks a diff adds, removes, renames and modifies, as one clause. */
function blockCounts(blocks: BlockDiff): string {
  return `${blocks.added.length} added, ${blocks.removed.length} removed, ${blocks.renamed.length} renamed, ${blocks.modified.length} modified`
}

/** One line naming what the apply changes, shown before asking to confirm it. */
function diffSummary(data: SourceApplyData): string {
  const { blocks, edges, variables } = data.diff
  if (data.diff.noop) return 'No graph changes (names, order or comments may still be saved).'
  const variableChanges = variableChangeList(variables)
  return `Blocks: ${blockCounts(blocks)}. Connections: +${edges.added} -${edges.removed}.${
    blocks.added.length > 0 ? `\nAdded: ${blocks.added.map(typedBlock).join('; ')}` : ''
  }${blocks.removed.length > 0 ? `\nRemoved: ${blocks.removed.map(typedBlock).join('; ')}` : ''}${
    blocks.modified.length > 0 ? `\nModified: ${blocks.modified.map(modifiedBlock).join('; ')}` : ''
  }${variableChanges.length > 0 ? `\nVariables: ${variableChanges.join('; ')}` : ''}`
}

/** Whether a write in `mode` only reads the directory: a dry run, or a plan that stops before writing. */
function isReadOnly(mode: WriteMode): boolean {
  return mode === 'dry' || mode === 'plan'
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
  client: OperationClient<
    Operation | 'deployWorkflow' | 'getWorkflowDeployment' | 'executeWorkflow'
  >
  /** The workspace the write is in, for the `--run` test run's request. */
  workspaceId: string
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
  /**
   * The write to run again once this one is saved, without `--yes`: an apply's own command; a
   * create's is an apply of the workflow it created, whose name a second create finds taken.
   */
  savedCommand: string
}): Promise<void> {
  const { options, creating } = args
  assertSendableCodeFiles(args.body.files)
  /** Sends the write (or its dry run); a refusal prints its diagnostics and rethrows. */
  const send = async (dry: boolean): Promise<SourceApplyData> => {
    try {
      const query = {
        ...(dry ? { dry: true } : {}),
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
        ...(dry ? {} : { ifAnswerLost: args.ifAnswerLost }),
        verbose: options.verbose === true,
      })
    }
  }
  const findings = findingsOutput(args.output, options.verbose, options.dir)
  const notes = new Set<string>()
  /**
   * Prints the result: a one-line `summary` first and `errors`, `warnings`, `live` and `next`
   * last, so both `| head` and `| tail` of a long result (findings, many blocks) show the outcome.
   */
  const report = (data: SourceApplyData, deployment: DeployOutcome = {}, run?: TestRun) => {
    const { live: deployedLive, deployed, next, ...outcome } = deployment
    const live = deployedLive ?? liveAgainstDraft(data.deployedVersion, data.needsRedeployment)
    publishSummary(() => planMarkdown(data, creating, live), {
      file: options.summaryFile,
      marker: summaryMarker(options.dir),
    })
    const details = summarize(data, creating, findings.machine)
    const errors = countOf(data, 'error')
    const warnings = countOf(data, 'warning')
    // `deployed.version` is the version the deploy admitted, which may not be live yet: a person
    // reads `live` instead, and a machine result keeps the record.
    const result = {
      summary: summaryLine(data, creating, { errors, warnings, run, live }),
      ...details,
      ...(run ? { run } : {}),
      ...(deployed && findings.machine ? { deployed } : {}),
      ...outcome,
      ...findings.result(data.diagnostics),
      errors,
      warnings,
      ...(live ? { live } : {}),
      ...(next ? { next } : {}),
    }
    printProtocolResult(args.output, result, {
      ...(details.created ? { created: createdText(details.created) } : {}),
      ...(outcome.urls?.length ? { urls: deployedUrlsText(outcome.urls) } : {}),
    })
    if (run?.sideEffects && !findings.machine) {
      printSideEffects(run.sideEffects, undefined, data.workflowId)
    }
  }
  const hasErrors = (data: SourceApplyData) => countOf(data, 'error') > 0
  /** Whether a committed answer stored the write: not refused, and a create that applied. */
  const stored = (data: SourceApplyData) =>
    !data.dry && !hasErrors(data) && (data.applied || !creating)
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
  if (!stored(data)) {
    report(data)
    return
  }
  let run: TestRun | undefined
  /** Runs a step after the stored write; a failure prints the write's result first: it stands. */
  const afterWrite = async <T>(step: () => Promise<T>): Promise<T> => {
    try {
      return await step()
    } catch (error) {
      report(data, {}, run)
      throw error
    }
  }
  if (options.run !== undefined) {
    const input = options.run === true ? undefined : options.run
    const record = await afterWrite(() =>
      dryRunDraft(args.client, data.workflowId, input, args.workspaceId)
    )
    run = testRunResult(record)
    if (record.status !== 'completed') {
      await printRunFailureSite(options.dir, data.workflowId, record.error)
      const next = {
        command: `${args.savedCommand} --yes`,
        reason: 'applies your fix and tests it again',
      }
      report(data, { next }, run)
      const why =
        runFailureMessage('executeWorkflow', record) ?? `it ended ${String(record.status)}`
      throw new SimApiError(
        `The ${verb} was saved into ${options.dir}, but the test run ${String(record.status)}: ${why}${options.deploy ? ' Nothing was deployed.' : ''} Fix the source, then run \`${args.savedCommand} --yes\`.`,
        0
      )
    }
  }
  const deployment = await afterWrite(() =>
    deployStep(args.client, data, {
      ...options,
      verb,
      machine: findings.machine,
      // Read only without --deploy: an untested draft's next names the tested deploy too.
      testedDeploy:
        run === undefined && !creating
          ? `${args.savedCommand} --yes --run '{…}' --deploy`
          : undefined,
    })
  )
  report(data, deployment, run)
}

/** What a write's result shows of its `--run` test run. */
interface TestRun {
  runId: unknown
  status: unknown
  error?: unknown
  output: unknown
  sideEffects?: unknown
  next?: unknown
}

/**
 * A `--run` record as the write's result shows it: the run id, status, error message, the
 * workflow's output, the side effects the dry run held back and, for a run that failed in a
 * block, the dry rerun from where the server says a rerun can start (none when it names none).
 */
function testRunResult(record: Record<string, unknown>): TestRun {
  const { next } = toRecord(withRunNext('executeWorkflow', record))
  return {
    runId: record.runId,
    status: record.status,
    ...(record.error ? { error: toRecord(record.error).message ?? record.error } : {}),
    output: record.output,
    ...(record.sideEffects ? { sideEffects: record.sideEffects } : {}),
    ...(next ? { next } : {}),
  }
}

/** How many of a write's findings have `severity`. */
function countOf(data: SourceApplyData, severity: 'error' | 'warning'): number {
  return data.diagnostics.filter((diagnostic) => diagnostic.severity === severity).length
}

/**
 * The write's outcome in one line: what it did (or would do), its findings, the test run and
 * what is live, so the first line of a long result already answers whether it worked.
 */
function summaryLine(
  data: SourceApplyData,
  creating: boolean,
  outcome: { errors: number; warnings: number; run?: TestRun; live?: string }
): string {
  const { blocks, edges } = data.diff
  const changes = data.diff.noop
    ? 'no graph changes'
    : `${blockCounts(blocks)}, connections +${edges.added} -${edges.removed}`
  return [
    `${writeOutcome(data, creating, outcome.errors)}: ${changes}`,
    `${outcome.errors} error(s), ${outcome.warnings} warning(s)`,
    ...(outcome.run ? [`test run ${String(outcome.run.status)}`] : []),
    ...(outcome.live ? [`live: ${outcome.live}`] : []),
  ].join('; ')
}

/** What a write did, in a word or two. */
function writeOutcome(data: SourceApplyData, creating: boolean, errors: number): string {
  if (data.dry) return 'plan'
  if (errors > 0) return 'refused'
  if (!data.applied) return 'not applied'
  return creating ? 'created' : 'applied'
}

/**
 * The plan of a dry run or write as the Markdown a step summary or `--summary-file` holds: the
 * counts, each block changed, each error, and what is live.
 */
function planMarkdown(data: SourceApplyData, creating: boolean, live: string | undefined): string {
  const { blocks, edges } = data.diff
  const [added, removed, modified] = data.dry
    ? ['to add', 'to remove', 'to modify']
    : ['added', 'removed', 'modified']
  const verb = creating ? 'create' : 'apply'
  const changes = [
    ...blocks.added.map(
      ({ key, type }) => `| + | ${markdownCell(key)} (${markdownCell(type)}) | added |`
    ),
    ...blocks.removed.map(
      ({ key, type }) => `| - | ${markdownCell(key)} (${markdownCell(type)}) | removed |`
    ),
    ...blocks.renamed.map(
      ({ from, to }) => `| ~ | ${markdownCell(from)} → ${markdownCell(to)} | renamed |`
    ),
    ...blocks.modified.map(
      ({ key, fields }) =>
        `| ~ | ${markdownCell(key)} (${markdownCell(fields.join(', '))}) | modified |`
    ),
  ]
  const variableChanges = variableChangeList(data.diff.variables)
  const errors = data.diagnostics.filter((finding) => finding.severity === 'error')
  const warnings = countOf(data, 'warning')
  return [
    `### Sim workflow ${data.dry ? 'plan' : verb}: ${markdownCell(data.workflowId)}`,
    '',
    data.diff.noop
      ? `No graph changes; ${errors.length} error(s), ${warnings} warning(s).`
      : `${blocks.added.length} ${added}, ${blocks.removed.length} ${removed}, ${blocks.modified.length} ${modified}, ${blocks.renamed.length} renamed; connections +${edges.added} -${edges.removed}; ${errors.length} error(s), ${warnings} warning(s).`,
    ...(variableChanges.length > 0
      ? ['', `Variables: ${variableChanges.map(markdownCell).join('; ')}`]
      : []),
    ...(data.diff.meta?.length ? ['', `Metadata: ${data.diff.meta.join(', ')}`] : []),
    ...(changes.length > 0
      ? [
          '',
          '| | Block | Change |',
          '|---|---|---|',
          ...changes.slice(0, SUMMARY_ROWS),
          ...(changes.length > SUMMARY_ROWS
            ? [`\n…and ${changes.length - SUMMARY_ROWS} more.`]
            : []),
        ]
      : []),
    ...(errors.length > 0 ? ['', '**Errors**', '', ...errorBullets(errors)] : []),
    ...(live ? ['', `Live: ${markdownCell(live)}`] : []),
  ].join('\n')
}

/** What a write adds to its result about deploying: the deploy it ran, or the one to run. */
interface DeployOutcome {
  /** What is live after the deploy step, when it deployed or read the deployment. */
  live?: string
  deployed?: { version?: number; isDeployed: boolean; warnings?: string[] }
  deployedVersion?: number | null
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
  options: {
    deploy?: boolean
    dir: string
    verb: string
    machine: boolean
    /** The write again with a test run and the deploy, named in `next.reason` while the draft is untested. */
    testedDeploy?: string
  }
): Promise<DeployOutcome> {
  // Pinned to the draft this write stored, as `--deploy` is: an edit made since is never deployed.
  const deployCommand = `sim workflows deploy ${data.workflowId} --expected-draft-fingerprint ${data.base.fingerprint}`
  if (!options.deploy) {
    if (!data.needsRedeployment) return {}
    return {
      next: {
        command: deployCommand,
        reason: `The workflow is deployed and its draft now differs from the live version: deploy to make the change live (or ${options.verb} with --deploy).${options.testedDeploy ? ` The draft is untested: \`${options.testedDeploy}\` tests and deploys it in one step.` : ''}`,
      },
    }
  }
  if (!data.applied && !data.needsRedeployment) {
    // A no-op write changed no draft: when the live version already matches it and no other
    // version is activating to replace it, a deploy would only publish the same version again.
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
    if (draftIsLive(status)) {
      if (!options.machine)
        printError('The live version already matches the draft; nothing was deployed.')
      return {
        live: liveDeploymentStatus(status, data.workflowId).live,
        deployed: {
          ...(status.activeDeployment ? { version: status.activeDeployment.version } : {}),
          isDeployed: true,
        },
        deployedVersion: status.activeDeployment?.version ?? null,
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
  const { live, next } = liveAfterActivation(
    deployed,
    data.workflowId,
    deployed.version,
    'this deploy',
    deployCommand
  )
  // What serves and whether the draft still differs, read back as the deployment status reports
  // them (a pending version leaves `needsRedeployment` false); whether it is live yet is `live`'s.
  const status = await deploymentAfterDeploy(client, data.workflowId)
  return {
    live,
    ...(next ? { next } : {}),
    deployed: {
      ...(deployed.version !== undefined ? { version: deployed.version } : {}),
      isDeployed: deployed.isDeployed,
      ...(options.machine && deployed.warnings.length > 0 ? { warnings: deployed.warnings } : {}),
    },
    ...(status
      ? {
          deployedVersion: status.activeDeployment?.version ?? null,
          needsRedeployment: status.needsRedeployment,
          urls: namedUrls(status.webhooks, lockBlockNames(data.lock)),
        }
      : // Unread, so unknown: never the apply's own answer, read before the deploy.
        { deployedVersion: undefined, needsRedeployment: undefined }),
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

/** `sim workflows source apply` with the write flags `options` holds, without `--yes`. */
function applyCommand(options: SourceWriteOptions): string {
  return `sim workflows source apply --dir ${shellWord(options.dir)}${options.allowDelete ? ' --allow-delete' : ''}${runFlag(options.run)}${options.deploy ? ' --deploy' : ''}${summaryFileFlag(options.summaryFile)}`
}

/** Refuses `--deploy` or `--run` beside `--dry`: a dry run stores nothing to deploy or run. */
function assertNotDry(options: SourceWriteOptions): void {
  if (!options.dry) return
  if (options.deploy) {
    throw new CliUsageError(
      '--deploy deploys what the write saves, and --dry saves nothing: drop one of them.'
    )
  }
  if (options.run !== undefined) {
    throw new CliUsageError(
      '--run test-runs what the write saves, and --dry saves nothing: drop one of them.'
    )
  }
}

/** `--run [input]` and `--deploy` on a write: test the saved draft, then deploy it. */
function runAndDeployOptions(command: Command): Command {
  return command
    .option(
      '--run [input]',
      'After the write is saved, dry-run the draft with this input (JSON or @file, as `sim workflows run --dry --input` takes it): a run that does not complete exits 1 and deploys nothing'
    )
    .option(
      '--deploy',
      'After the write is saved (and a --run completed), deploy the workflow (as `sim workflows deploy <workflowId>` does)'
    )
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
 * needs `--yes`. `--dry` writes nothing, so it never asks.
 */
export function attachWorkflowSourceApply(source: Command): void {
  const [command, connectApply] = apiCommand(source, 'apply', [
    'applyWorkflowSource',
    'deployWorkflow',
    'getWorkflowDeployment',
    'getSourceResources',
    'executeWorkflow',
  ])
  absoluteDirOption(command)
  verboseFlag(command)
  summaryFileOption(command)
  command
    .argument(
      '[workflowId]',
      'Refuse unless .sim/base.json names this workflow (default: the workflowId there)'
    )
    .option('--dir <dir>', DIR_DESCRIPTION, '.')
    .option('--dry', 'Check the source and show the outcome without saving or writing files')
    .option('-y, --yes', 'Apply without asking for confirmation')

  runAndDeployOptions(command)
    .option(
      '--allow-delete',
      'Delete blocks and variables the source no longer declares; without it, an apply that deletes one is refused'
    )
    .allowExcessArguments(false)
    .description('Apply a workflow source directory to a workflow draft')
    .addHelpText('after', sourceExitCodesHelp('workflows source apply'))
    .action(async (named: string | undefined, options: SourceWriteOptions) => {
      const mode = writeMode(options)
      await withSourceCommandLock(
        options.dir,
        async () => {
          assertNotDry(options)
          await assertSourceDirKind(options.dir, 'workflow')
          const { client, profile } = connectApply()
          const lock = await readLock(options.dir)
          const base = await readBase(options.dir, named)
          const workflowId = base.workflowId
          const files = await readSourceFiles(options.dir, lock)
          if (!isReadOnly(mode)) {
            await refreshWorkflowWorkspaceTypes(client, options.dir, base.workspaceId)
          }
          const childResults = isReadOnly(mode) ? undefined : await folderChildResults(options.dir)
          await writeWorkflowSource<'applyWorkflowSource'>({
            options,
            mode,
            creating: false,
            question: `Apply these changes to workflow ${workflowId}?`,
            command: applyCommand(options),
            savedCommand: applyCommand(options),
            output: profile.output,
            client,
            workspaceId: base.workspaceId,
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
                cachedCatalogByHash(toRecord(data.base).catalogHash),
                childResults
              )
              await writeBack(options.dir, data, lock, { write: edges ? [edges] : [] })
              await refreshWorkflowTsconfigs(options.dir, data)
            },
            ifAnswerLost: `It may have been saved. Run \`sim workflows source apply ${workflowId} --dir ${options.dir} --dry\`: exit 5 (stale) means the draft changed since this directory was read, by this apply or by someone else. Run \`sim workflows source get ${workflowId} --dir <fresh dir>\` and compare it with ${options.dir}: if it holds your edit, \`sim workflows source get ${workflowId} --dir ${options.dir} --force\` brings this directory up to date; if not, reapply your edit in the fresh directory. Any other outcome means it was not saved: apply again.`,
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
    'executeWorkflow',
  ])
  absoluteDirOption(command)
  verboseFlag(command)
  summaryFileOption(command)
  searchTasks(command, [
    'build a new workflow',
    'create a new workflow as code',
    'author or write a workflow in TypeScript',
    'build a workflow that answers questions with an agent over a knowledge base, table or integration',
  ])
  command
    .requiredOption(
      '--dir <dir>',
      'Source directory: workflow.ts and functions/*. Without workflow.ts, writes a starter and the types instead (an error with --dry or --yes)'
    )
    .option('--dry', 'Check the source and show the outcome without creating anything')
    .option('--name <name>', "The workflow name (default: the source's)")
    .option('--folder <path>', 'The folder to create it in (default: the root)')
    .option('-y, --yes', 'Create without asking for confirmation')

  runAndDeployOptions(command)
    .allowExcessArguments(false)
    .description('Create a workflow from a workflow source directory')
    .addHelpText('after', sourceExitCodesHelp('workflows source create'))
    .action(async (options: SourceWriteOptions & { name?: string; folder?: string }) => {
      const mode = writeMode(options)
      await withSourceCommandLock(
        options.dir,
        async () => {
          await assertSourceDirKind(options.dir, 'workflow')
          if ((await readSourceText(options.dir, ENTRY_FILE)) === null) {
            if (options.dry || options.yes) {
              throw new SourceDirError(
                `${options.dir} has no ${ENTRY_FILE}, so there is nothing to ${options.dry ? 'check' : 'create'}. Write ${ENTRY_FILE} there, or run \`sim workflows source create --dir ${options.dir}\` without --dry and --yes to write a starter.`
              )
            }
            const { client, profile } = connectCreate()
            const workspaceId = client.requireWorkspace()
            const tree = await writeSourceScaffold(client, options.dir, workspaceId)
            const next: NextStep = {
              command: `${createCommand(shellWord(options.dir), workspaceId)} --yes${runFlag(options.run)}${options.deploy ? ' --deploy' : ''}${summaryFileFlag(options.summaryFile)}`,
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
          assertNotDry(options)
          const { client, profile } = connectCreate()
          // A directory is bound to the workspace it records: a starter to the one its types were
          // written for (--workspace still chooses another), a workspace folder to its workspace.
          const recorded = directoryWorkspace(
            options.dir,
            await recordedWorkspace(options.dir, profile),
            profile,
            (from, _named, setting) => `Run it without ${setting} to create it in ${from}.`
          )
          const workspaceId = client.requireWorkspace(recorded ?? undefined)
          const files = await readSourceFiles(options.dir, null)
          if (!isReadOnly(mode)) {
            await refreshWorkflowWorkspaceTypes(client, options.dir, workspaceId)
          }
          const childResults = isReadOnly(mode) ? undefined : await folderChildResults(options.dir)
          await writeWorkflowSource<'createWorkflowFromSource'>({
            options,
            mode,
            creating: true,
            question: 'Create this workflow?',
            command: `${createCommand(shellWord(options.dir), workspaceId)}${options.name !== undefined ? ` --name ${shellWord(options.name)}` : ''}${options.folder !== undefined ? ` --folder ${shellWord(options.folder)}` : ''}${runFlag(options.run)}${options.deploy ? ' --deploy' : ''}${summaryFileFlag(options.summaryFile)}`,
            savedCommand: applyCommand(options),
            output: profile.output,
            client,
            operation: 'createWorkflowFromSource',
            params: { workspaceId },
            workspaceId,
            ifAnswerLost: `It may have been created. Run this command again: a SOURCE_NAME_TAKEN refusal means it was, so find its id with \`sim workflows list\` and run \`sim workflows source get <workflowId> --dir ${options.dir} --force\`.`,
            save: async (data) => {
              await writeSourceDirectory(client, options.dir, data, [], childResults)
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

/** Whether a diff adds, removes or changes any workflow variable. */
function variablesChanged(variables: SourceApplyData['diff']['variables']): boolean {
  return (
    variables.added.length > 0 ||
    variables.removed.length > 0 ||
    variables.renamed.length > 0 ||
    variables.modified.length > 0
  )
}

/**
 * What a write created (on a dry run, would create; ids are only known once it is written): the
 * workflow of a create, then each block added.
 */
function createdResources(data: SourceApplyData, creating: boolean): CreatedResource[] {
  const written = !data.dry && data.applied
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
  const created = data.dry || data.applied ? createdResources(data, creating) : []
  return {
    ...(creating && !data.applied ? {} : { workflowId: data.workflowId }),
    applied: data.applied,
    dry: data.dry,
    noop: data.diff.noop,
    ...(created.length > 0 ? { created } : {}),
    // One string per block (`key (type)`, `key (field, …)`): a line each in a JSON result.
    blocksAdded: data.diff.blocks.added.length,
    ...(data.diff.blocks.added.length > 0 && {
      added: data.diff.blocks.added.map(typedBlock),
    }),
    blocksRemoved: data.diff.blocks.removed.length,
    ...(data.diff.blocks.removed.length > 0 && {
      removed: data.diff.blocks.removed.map(typedBlock),
    }),
    blocksModified: data.diff.blocks.modified.length,
    ...(data.diff.blocks.modified.length > 0 && {
      modified: data.diff.blocks.modified.map(modifiedBlock),
    }),
    edgesAdded: data.diff.edges.added,
    edgesRemoved: data.diff.edges.removed,
    ...(variablesChanged(data.diff.variables) && { variables: data.diff.variables }),
    notes: machine ? data.notes : data.notes.length,
    fingerprint: data.base.fingerprint,
    deployedVersion: data.deployedVersion,
    needsRedeployment: data.needsRedeployment,
    ...(creating && data.applied && !data.dry ? { guide: SOURCE_AGENTS_FILE } : {}),
  }
}
