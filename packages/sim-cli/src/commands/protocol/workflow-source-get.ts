import { toRecord } from '@sim/utils/object'
import { SOURCE_BASE_FILE } from '@sim/workflow-code/limits'
import type { Command } from 'commander'
import type { GetWorkflowSourceResponse } from '../../generated/v2-api'
import { callsOperations } from '../../runtime/called-operations'
import { buildRequest } from '../../runtime/request'
import { SourceDirError } from './local-errors'
import {
  absoluteDirOption,
  assertPrintedSourcePaths,
  assertSourceDirKind,
  locallyEditedFiles,
  readPreviousLock,
  readSourceJson,
  withSourceCommandLock,
} from './source-dir'
import { sourceExitCodesHelp } from './source-exit-codes'
import { printTreeResult, withSourceExitCode } from './source-tree'
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

/**
 * Teaches the generated `workflows source get` leaf `--dir <dir>`: instead of printing the
 * response, it writes `workflow.ts`, `functions/*`, `.sim/lock.json`, `.sim/base.json`, SDK
 * declarations for the blocks the source uses (`.sim/sdk/**`; every block's are generated once
 * per catalog into the CLI's cache, which `tsconfig.full.json` includes, and the catalog itself is
 * ETag-cached), `.sim/sdk/workspace.d.ts` from the resource manifest, the tsconfig files, the
 * primer it prints atop `.sim/AGENTS.md`, the examples in `.sim/examples/` and the
 * `.gitattributes` lines that keep the source LF. Without `--dir` the generated handler runs unchanged. Commander offers
 * no way to read the action it holds, so it is captured and delegated to, as `runs get` does.
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
  ])

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
  get.action(async (workflowId: string, _options: unknown, command: Command): Promise<void> => {
    const flags = command.optsWithGlobals() as Record<string, unknown>
    const dir = flags[DIR_FLAG]
    if (typeof dir !== 'string') {
      try {
        await previous(command.processedArgs)
      } catch (error) {
        throw withSourceExitCode(error)
      }
      return
    }
    await withSourceCommandLock(dir, async () => {
      const force = flags[FORCE_FLAG] === true
      await assertSourceDirKind(dir, 'workflow')
      if (!force) await assertSameWorkflow(dir, workflowId)
      const { client, profile } = connectGet()
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
      const tree = await writeSourceDirectory(
        client,
        dir,
        workflowSource,
        workflowSource.blockTypes
      )
      const findings = findingsOutput(profile.output, false, dir)
      findings.print(workflowSource.diagnostics)
      printTreeResult(profile.output, {
        workflowId: workflowSource.workflowId,
        dir,
        ...tree,
        fingerprint: workflowSource.base.fingerprint,
        ...findings.result(workflowSource.diagnostics),
      })
    })
  })
}
