import type { Command } from 'commander'
import { clientFrom } from '../../context'
import { CLI_CONTRACT } from '../../contract/commands'
import { V2_OPERATIONS } from '../../generated/v2-api'
import { resolvePath, SimApiError, type SimClient } from '../../http/client'
import { retypeApiError } from '../../runtime/naming'
import { buildRequest, readListValues } from '../../runtime/request'
import { renderResult } from '../../runtime/result'
import type { OperationSpec } from '../../runtime/types'

/**
 * A well-formed UUID of any version, which is what every block id is.
 *
 * The same test the run resource applies (`isValidUuid`) before deciding a
 * selector head is a name it cannot resolve.
 */
const BLOCK_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const SELECT_OUTPUT_FLAG = 'select-output'

/**
 * A block name as the executor compares one: lowercased, whitespace and dots
 * removed.
 *
 * `normalizeWorkflowBlockName` in `@sim/workflow-types`, restated. It is the
 * rule `workflows run --select-output` resolves names with server-side and the
 * one every block-name conflict check applies, so `Summarize Result` and
 * `summarizeresult` name the same block on both commands. Restated rather than
 * imported because this package ships standalone and carries no workspace
 * dependency.
 */
function normalizeBlockName(name: string): string {
  return name.toLowerCase().replace(/\s+/g, '').replace(/\./g, '')
}

interface WorkflowBlock {
  id: string
  name: string
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * The workflow's blocks, read from its draft graph.
 *
 * The run resource reads a recorded run and never loads the workflow, so it
 * matches ids only; the draft graph is where the names live. A block renamed
 * since the run still resolves — to its id, which is what the recording keyed
 * on — and a block deleted since does not, which the refusal lists.
 */
async function loadWorkflowBlocks(client: SimClient, workflowId: string): Promise<WorkflowBlock[]> {
  const operation = V2_OPERATIONS.getWorkflowState
  const raw = await client.request<unknown>(resolvePath(operation.path, { workflowId }), {
    method: operation.method,
  })
  const state = isRecord(raw) && isRecord(raw.data) ? raw.data : raw
  const blocks = isRecord(state) && isRecord(state.blocks) ? Object.entries(state.blocks) : []
  return blocks.map(([key, block]) => ({
    id: isRecord(block) && typeof block.id === 'string' ? block.id : key,
    name: isRecord(block) && typeof block.name === 'string' ? block.name : '',
  }))
}

/** A selector split at its first dot: the block reference, and the path into that block's output. */
function splitSelector(selector: string): { head: string; path: string } {
  const dot = selector.indexOf('.')
  return dot === -1
    ? { head: selector, path: '' }
    : { head: selector.slice(0, dot), path: selector.slice(dot) }
}

function isIdHeaded(selector: string): boolean {
  return BLOCK_ID.test(splitSelector(selector).head)
}

interface ResolvedSelection {
  /** The selection as the run resource takes it: every head a block id. */
  resolved: string[]
  /** What the caller typed for each resolved selector, so the answer is keyed the way it was asked. */
  typedBy: Map<string, string>
}

/**
 * Rewrites each name-headed selector onto the block it names; id-headed ones
 * pass through untouched, the way the run resource already took them.
 *
 * Mirrors the server's `resolveOutputBlockRef`: an exact id first, then the one
 * block whose normalized name matches. Every miss is collected before refusing,
 * so a selection with two typos is fixed in one round rather than two.
 */
function resolveSelection(
  typed: readonly string[],
  blocks: readonly WorkflowBlock[],
  workflowId: string
): ResolvedSelection {
  const resolved: string[] = []
  const typedBy = new Map<string, string>()
  const unresolved: string[] = []

  for (const selector of typed) {
    const { head, path } = splitSelector(selector)
    let blockId = head
    if (!BLOCK_ID.test(head)) {
      const wanted = normalizeBlockName(head)
      const matches = blocks.filter(
        (block) => block.id === head || normalizeBlockName(block.name) === wanted
      )
      if (matches.length === 0) {
        unresolved.push(selector)
        continue
      }
      // Duplicate normalized names are refused at write time, so this is the
      // graph disagreeing with its own rule; the ids are the only safe spelling.
      if (matches.length > 1) {
        throw new SimApiError(
          `--${SELECT_OUTPUT_FLAG} ${selector} names ${matches.length} blocks (${matches.map((block) => block.id).join(', ')}); pass the block id instead`,
          0
        )
      }
      blockId = matches[0].id
    }
    const rewritten = `${blockId}${path}`
    resolved.push(rewritten)
    if (!typedBy.has(rewritten)) typedBy.set(rewritten, selector)
  }

  if (unresolved.length > 0) {
    const names = blocks.map((block) => block.name).filter((name) => name !== '')
    throw new SimApiError(
      `--${SELECT_OUTPUT_FLAG} did not resolve to any block on this run: ${unresolved.join(', ')}. Pass a block id or its name — "blockId", "blockId.path", "blockName" or "blockName.path"; names match ignoring case, spaces and dots. Blocks on workflow ${workflowId}: ${names.length > 0 ? names.join(', ') : 'none'}.`,
      0
    )
  }

  return { resolved, typedBy }
}

/**
 * Keys the answer by what the caller typed.
 *
 * The run resource keys `blockOutputs` by the selector it received, which is
 * the id-headed rewrite; handing that back would make `summarize.result` come
 * out as `<uuid>.result` — a key the caller never wrote and a `jq` path they
 * cannot predict. `workflows run` keys by the caller's own selector, and this
 * matches it.
 */
function keyByTyped(payload: unknown, typedBy: ReadonlyMap<string, string>): unknown {
  if (!isRecord(payload) || !isRecord(payload.blockOutputs)) return payload
  const blockOutputs: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(payload.blockOutputs)) {
    blockOutputs[typedBy.get(key) ?? key] = value
  }
  return { ...payload, blockOutputs }
}

/**
 * Reads the run with a selection that named at least one block.
 *
 * The generated path is not delegated to here because the answer has to be
 * re-keyed before it is rendered (see {@link keyByTyped}), and rendering is the
 * generated handler's last act. Everything else follows it: the same request
 * builder, the same result renderer, and the same field-spelling retype on a
 * server refusal.
 */
async function readRunByName(runId: string, typed: string[], command: Command): Promise<void> {
  const flags = command.optsWithGlobals() as Record<string, unknown>
  const { client, profile } = clientFrom(command)
  const operation = V2_OPERATIONS.getWorkflowRun as OperationSpec
  const spec = CLI_CONTRACT.getWorkflowRun ?? {}

  // Built once before anything is fetched, so a flag the generated path would
  // refuse is refused the same way — and before a request is spent on the
  // workflow's blocks. Rebuilt below once the names are ids.
  await buildRequest('getWorkflowRun', [runId], flags, profile.workspaceId)
  const workflowId = String(flags.workflow)
  const selection = resolveSelection(
    typed,
    await loadWorkflowBlocks(client, workflowId),
    workflowId
  )
  const request = await buildRequest(
    'getWorkflowRun',
    [runId],
    { ...flags, selectOutput: selection.resolved },
    profile.workspaceId
  )

  let result: { data?: unknown } | undefined
  try {
    result = await client.request<{ data?: unknown }>(request.path, {
      method: operation.method,
      headers: request.headers,
      query: request.query,
      body: request.body,
    })
  } catch (error) {
    throw retypeApiError(error, 'getWorkflowRun', spec, operation)
  }
  renderResult(
    'getWorkflowRun',
    profile.output,
    keyByTyped(result?.data ?? result, selection.typedBy),
    spec,
    {},
    result
  )
}

/**
 * Teaches the generated `workflows runs get` leaf the block names
 * `workflows run --select-output` already takes.
 *
 * The run resource matches recorded block ids only — it never loads the
 * workflow — so `--select-output summarize.result`, the spelling the run was
 * started with, came back `400` and the fix was to go and look up an id. The
 * lookup is done here instead: a selection with any name-headed selector reads
 * the workflow's blocks once, rewrites names onto ids, and reads the run keyed
 * the way it was asked. A selection of ids alone, or no selection, still runs
 * the generated handler byte for byte. Commander offers no way to read the
 * action it holds, so it is captured and delegated to, as `--follow` does.
 */
export function attachWorkflowRunGet(runs: Command): void {
  const get = runs.commands.find((command) => command.name() === 'get')
  const held = (get as (Command & { _actionHandler?: unknown }) | undefined)?._actionHandler
  if (!get || typeof held !== 'function') {
    throw new Error(
      'workflows runs get must be registered before block names can be attached to it'
    )
  }
  const previous = held as (args: unknown[]) => unknown

  get.action(async (runId: string, _options: unknown, command: Command): Promise<void> => {
    const raw: unknown = (command.optsWithGlobals() as Record<string, unknown>).selectOutput
    if (raw === undefined) {
      await previous(command.processedArgs)
      return
    }
    // Expanded here, once: a `@-` source cannot be read twice, and the
    // generated path would read it again if it still saw the `@`.
    const typed = await readListValues(raw, SELECT_OUTPUT_FLAG)
    command.setOptionValue('selectOutput', typed)
    if (typed.every(isIdHeaded)) {
      await previous(command.processedArgs)
      return
    }
    await readRunByName(runId, typed, command)
  })
}
