import { isValidUuid } from '@sim/utils/id'
import { toRecord } from '@sim/utils/object'
import { SOURCE_BASE_FILE } from '@sim/workflow-code/limits'
import type { Command } from 'commander'
import type { GetWorkflowSourceResponse, ListWorkflowsResponse } from '../../generated/v2-api'
import { callsOperations, type OperationClient } from '../../runtime/called-operations'
import { DEFAULT_PAGE_SIZE } from '../../runtime/options'
import { buildRequest } from '../../runtime/request'
import { CliUsageError, SourceDirError } from './local-errors'
import { folderChildResults } from './source-check'
import {
  absoluteDirOption,
  assertPrintedSourcePaths,
  assertSourceDirKind,
  directoryWorkspace,
  locallyEditedFiles,
  readPreviousLock,
  readSourceJson,
  recordedWorkspace,
  withSourceCommandLock,
} from './source-dir'
import { sourceExitCodesHelp } from './source-exit-codes'
import { editLoop, printTreeResult, withSourceExitCode } from './source-tree'
import { findingsOutput } from './source-ui'
import { type PrintedSource, writeSourceDirectory } from './workflow-dir'

const DIR_FLAG = 'dir'
const FORCE_FLAG = 'force'

/** The workflow `.sim/base.json` says the directory holds, or `null` when it names none. */
async function heldWorkflowId(dir: string): Promise<string | null> {
  const held = toRecord(await readSourceJson(dir, SOURCE_BASE_FILE)).workflowId
  return typeof held === 'string' ? held : null
}

/**
 * Refuses, unless `--force`, a get into a directory holding another workflow's source: it would
 * replace that source and prune its function files.
 */
async function assertSameWorkflow(dir: string, workflowId: string): Promise<void> {
  const held = await heldWorkflowId(dir)
  if (held === null || held === workflowId) return
  throw new SourceDirError(
    `${dir} holds the source of workflow ${held}, not ${workflowId}. Get it into another directory, or pass --force to replace it.`,
    { code: 'SOURCE_WORKFLOW_MISMATCH' }
  )
}

/**
 * Refuses, unless `--force`, a get that would replace or prune a source file with edits no apply
 * has saved, such as the edit a stale apply refused.
 */
async function assertNoLocalEdits(dir: string, source: PrintedSource): Promise<void> {
  const edited = await locallyEditedFiles(dir, source, await readPreviousLock(dir))
  if (edited.length === 0) return
  throw new SourceDirError(
    `${dir} has edits no apply has saved (${edited.join(', ')}). Apply them, get into another directory, or pass --force to discard them.`,
    { code: 'SOURCE_LOCAL_EDITS' }
  )
}

/** How many candidates a refused name lookup names. */
const NAMED_CANDIDATES = 10

/**
 * The longest `search` the v2 list routes take (`V2_SEARCH_MAX_LENGTH`), shorter than the longest
 * workflow name: a longer name searches its first this many characters and matches exactly here.
 */
const SEARCH_MAX_LENGTH = 200

/**
 * The workflow `workflow` names: a UUID as it is, else the one workflow in the workspace whose
 * name is exactly `workflow`. No match or several are refused, naming the candidates with their
 * ids (a workflow's name is unique only within its folder).
 */
async function resolveWorkflow(
  client: OperationClient<'listWorkflows'>,
  workflow: string,
  /** The workspace to look in when not the command's own: a directory's recorded one. */
  inWorkspace?: string
): Promise<string> {
  if (isValidUuid(workflow)) return workflow
  // Cut on a character boundary: half an emoji would search for a name no workflow holds.
  const search = workflow
    .trim()
    .slice(0, SEARCH_MAX_LENGTH)
    .replace(/[\uD800-\uDBFF]$/, '')
  if (search === '') {
    throw new CliUsageError('Name a workflow: its id or exact name.', {
      code: 'WORKFLOW_NOT_FOUND',
    })
  }
  const workspaceId = client.requireWorkspace(inWorkspace)
  // Every page: an exact match or a second one can sort after the first page of substring hits.
  const found = await client.requestAllPages<ListWorkflowsResponse['data'][number]>(
    'listWorkflows',
    { query: { workspaceId, search }, pageSize: DEFAULT_PAGE_SIZE }
  )
  const exact = found.filter(({ name }) => name === workflow)
  if (exact.length === 1) return exact[0].id
  const candidates = exact.length > 1 ? exact : found
  const listed = candidates
    .slice(0, NAMED_CANDIDATES)
    .map(({ id, name, folderPath }) => `${name} (${id}${folderPath ? `, in ${folderPath}` : ''})`)
  const more = candidates.length - listed.length
  const named = `${listed.join('; ')}${more > 0 ? `; and ${more} more` : ''}`
  throw new CliUsageError(
    exact.length > 1
      ? `${exact.length} workflows are named "${workflow}": ${named}. Get one by its id.`
      : `No workflow is named exactly "${workflow}"${listed.length > 0 ? `; names containing it: ${named}` : ' in this workspace'}. Pass its id or exact name (\`sim workflows list\` lists them).`,
    { code: exact.length > 1 ? 'WORKFLOW_NAME_AMBIGUOUS' : 'WORKFLOW_NOT_FOUND' }
  )
}

/**
 * Teaches the generated `workflows source get` leaf `--dir <dir>`: instead of printing the
 * response, it writes `workflow.ts`, `functions/*`, `.sim/lock.json`, `.sim/base.json`, SDK
 * declarations for the blocks the source uses (`.sim/sdk/**`; every block's are generated once
 * per catalog into the CLI's cache, which `tsconfig.full.json` includes, and the catalog itself is
 * ETag-cached), `.sim/sdk/workspace.d.ts` from the resource manifest, the tsconfig files, the
 * primer it writes atop `.sim/AGENTS.md` (not printed: the result names the edit loop instead),
 * the examples in `.sim/examples/` and the `.gitattributes` lines that keep the source LF. Without
 * `--dir` the generated handler runs unchanged. Commander offers no way to read the action it
 * holds, so it is captured and delegated to, as `runs get` does.
 */
export function attachWorkflowSourceGet(source: Command): void {
  const get = source.commands.find((command) => command.name() === 'get')
  const held = (get as (Command & { _actionHandler?: unknown }) | undefined)?._actionHandler
  if (!get || typeof held !== 'function') {
    throw new Error('workflows source get must be registered before --dir can be attached to it')
  }
  const previous = held as (args: unknown[]) => unknown
  const connectGet = callsOperations(get, [
    'getWorkflowSource',
    'getSourceCatalog',
    'getSourceResources',
    'listWorkflows',
  ])
  const [workflowArgument] = get.registeredArguments
  if (workflowArgument) workflowArgument.description = 'Workflow id, or its exact name'

  get.option(
    `--${DIR_FLAG} <dir>`,
    'Write the source, its lock and SDK type declarations into this directory instead of printing them'
  )
  get.option(
    `--${FORCE_FLAG}`,
    "With --dir: replace another workflow's source or edits no apply has saved"
  )
  absoluteDirOption(get)
  get.addHelpText('after', sourceExitCodesHelp('workflows source get', 'Exit codes with --dir'))
  get.action(async (workflow: string, _options: unknown, command: Command): Promise<void> => {
    const flags = command.optsWithGlobals() as Record<string, unknown>
    const dir = flags[DIR_FLAG]
    if (typeof dir !== 'string') {
      try {
        // An id needs no connection here: the generated handler connects on its own.
        const workflowId = isValidUuid(workflow)
          ? workflow
          : await resolveWorkflow(connectGet().client, workflow)
        await previous([workflowId, ...command.processedArgs.slice(1)])
      } catch (error) {
        throw withSourceExitCode(error)
      }
      return
    }
    await withSourceCommandLock(dir, async () => {
      const force = flags[FORCE_FLAG] === true
      await assertSourceDirKind(dir, 'workflow')
      const { client, profile } = connectGet()
      // A name is looked up in the workspace the directory was read from, as its other commands
      // act on it; --force gets into it from the command's own workspace instead.
      const recorded = force
        ? null
        : directoryWorkspace(
            dir,
            await recordedWorkspace(dir, profile),
            profile,
            (_from, _named, setting) =>
              `Drop ${setting}, or pass --force to replace it with a workflow from ${setting}.`
          )
      const workflowId = await resolveWorkflow(client, workflow, recorded ?? undefined)
      if (!force) await assertSameWorkflow(dir, workflowId)
      const request = await buildRequest(
        'getWorkflowSource',
        [workflowId],
        flags,
        profile.workspaceId
      )
      const workflowSource = await client
        .request<GetWorkflowSourceResponse>('getWorkflowSource', {
          params: request.params,
          query: request.query,
        })
        .then(
          (response) => response.data,
          (error: unknown) => {
            throw withSourceExitCode(error)
          }
        )
      assertPrintedSourcePaths(workflowSource.files)
      if (!force) await assertNoLocalEdits(dir, workflowSource)
      const { runFindings, ...tree } = await writeSourceDirectory(
        client,
        dir,
        workflowSource,
        workflowSource.blockTypes,
        await folderChildResults(dir)
      )
      const diagnostics = [...workflowSource.diagnostics, ...runFindings]
      const findings = findingsOutput(profile.output, false, dir)
      findings.print(diagnostics)
      printTreeResult(profile.output, {
        workflowId: workflowSource.workflowId,
        dir,
        ...tree,
        editLoop: editLoop('workflow', dir),
        fingerprint: workflowSource.base.fingerprint,
        ...findings.result(diagnostics),
      })
    })
  })
}
