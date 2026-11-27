import { isPlainRecord, isRecordLike, toArray, toRecord } from '@sim/utils/object'
import { normalizeWorkflowBlockName } from '@sim/workflow-types/workflow'
import type { Command } from 'commander'
import { writeStderr } from '#sim-cli/output/io'
import { styles } from '#sim-cli/output/presentation'
import { CLI_CONTRACT } from '../../contract/commands'
import { embedStore } from '../../embed-context'
import { STILL_RUNNING_EXIT_CODE } from '../../exit-codes'
import { V2_OPERATIONS } from '../../generated/v2-api'
import { SimApiError } from '../../http/client'
import { readNdjson } from '../../http/ndjson'
import { safeOneLine, sanitize } from '../../output/render'
import { callsOperations, connect, type OperationClient } from '../../runtime/called-operations'
import { runFailureMessage } from '../../runtime/execute'
import { retypeApiError } from '../../runtime/naming'
import { collectRepeated } from '../../runtime/options'
import { buildRequest, readArgumentSource } from '../../runtime/request'
import { renderResult } from '../../runtime/result'
import { selectorOf, shellArgument, withRunNext } from '../../runtime/run-next'
import type { OperationSpec } from '../../runtime/types'
import { printRunFailureSite } from './run-source-location'
import { BLOCK_ID } from './workflow-run-get'
import {
  parseWaitTimeout,
  type RunSnapshot,
  WAIT_TIMEOUT_FLAG,
  waitForRun,
} from './workflow-run-wait'

/**
 * Declares that this client understands agent-event framing.
 *
 * The server refuses `includeThinking` / `includeToolCalls` outright without it
 * rather than silently downgrading, so the header is not optional decoration —
 * it is the difference between the flags working and a 400. It is sent *only*
 * when one of those flags is set, because negotiating also switches answer text
 * to live streaming, which the server may later retract with `chunk_reset`.
 * A plain `--follow` therefore stays on settled final-turn text, and nothing
 * printed to the terminal can ever turn out to have been withdrawn.
 */
const AGENT_STREAM_PROTOCOL_HEADER = 'x-sim-stream-protocol'
const AGENT_STREAM_PROTOCOL_V1 = 'agent-events-v1'
const WORKFLOW_RESULT_STREAM_CONTENT_TYPE = 'application/x-ndjson'

/** Terminal marker. Sent JSON-encoded, so the raw payload carries its quotes. */
const DONE_SENTINEL = '[DONE]'

/** The sink live commentary is written to; `process.stderr` satisfies it. */
interface CommentaryWriter {
  write(text: string): unknown
}

export interface FollowOptions {
  includeThinking: boolean
  includeToolCalls: boolean
  stderr: CommentaryWriter
}

type WorkflowRunSelection =
  | { source: 'deployment'; version: number }
  | {
      source: 'draft'
      entry?:
        | { type: 'trigger'; blockId?: string; sample?: boolean }
        | { type: 'block'; blockId: string; sourceRunId: string }
      stopAfterBlockId?: string
      dry?: true
      allow?: string[]
      mocks?: Record<string, Record<string, unknown>>
      mocksFrom?: { runId: string; blocks: string[] }
    }

/** The flags that run the saved draft, which a pinned deployment version never runs. */
const DRAFT_RUN_FLAGS = [
  ['draft', '--draft'],
  ['dry', '--dry'],
  ['trigger', '--trigger'],
  ['sample', '--sample'],
  ['stopAfter', '--stop-after'],
  ['fromBlock', '--from-block'],
  ['sourceRun', '--source-run'],
  ['allow', '--allow'],
  ['mock', '--mock'],
  ['mockFrom', '--mock-from'],
] as const

/**
 * `--deployment-version <n>` as the deployment selector it names, or undefined when it is not
 * given. Refused unless it is a positive integer, and beside any flag that runs the draft.
 */
function pinnedDeployment(
  flags: Record<string, unknown>
): { source: 'deployment'; version: number } | undefined {
  const given = flags.deploymentVersion
  if (given === undefined) return undefined
  const version = typeof given === 'string' && /^[1-9]\d*$/.test(given) ? Number(given) : Number.NaN
  if (!Number.isSafeInteger(version)) {
    throw new SimApiError('--deployment-version must be a positive integer, like 7', 0)
  }
  for (const [key, flag] of DRAFT_RUN_FLAGS) {
    if (flags[key] === undefined || flags[key] === false) continue
    if (Array.isArray(flags[key]) && flags[key].length === 0) continue
    throw new SimApiError(
      `--deployment-version runs a deployed version; ${flag} runs the draft: drop one`,
      0
    )
  }
  return { source: 'deployment', version }
}

/**
 * `--mock <block>=<json|@file>` values as the block selector each names and its output object, and
 * the blocks of each bare `--mock <block>`, which `--mock-from <runId>` answers with the output
 * that run recorded.
 */
async function readBlockMocks(
  values: string[],
  mockFrom: string | undefined
): Promise<{ mocks: Record<string, Record<string, unknown>>; recorded: string[] }> {
  const mocks: Record<string, Record<string, unknown>> = {}
  const recorded: string[] = []
  for (const value of values) {
    const separator = value.indexOf('=')
    if (separator === -1) {
      const block = value.trim()
      if (!block) throw new SimApiError('--mock requires a block id, name or key', 0)
      if (mockFrom === undefined) {
        throw new SimApiError(
          `--mock ${block} names no output: pass <block>=<json|@file>, or add --mock-from <runId> to answer it with the output that run recorded`,
          0
        )
      }
      if (recorded.includes(block)) throw new SimApiError(`--mock names ${block} twice`, 0)
      recorded.push(block)
      continue
    }
    const block = value.slice(0, separator).trim()
    if (!block) {
      throw new SimApiError(`--mock "${value}" must be <block>=<json|@file>`, 0)
    }
    // A JSON object cannot carry `__proto__` as a key the server reads: name the block by its id.
    if (block === '__proto__') {
      throw new SimApiError('--mock cannot name a block __proto__; name it by its block id', 0)
    }
    const source = await readArgumentSource(value.slice(separator + 1), 'mock')
    let output: unknown
    try {
      output = JSON.parse(source.text)
    } catch {
      throw new SimApiError(`--mock ${block}: the output${source.from} is not valid JSON`, 0)
    }
    if (!isPlainRecord(output)) {
      throw new SimApiError(
        `--mock ${block}: the output must be a JSON object, like {"ok":true}`,
        0
      )
    }
    if (Object.hasOwn(mocks, block)) throw new SimApiError(`--mock names ${block} twice`, 0)
    mocks[block] = output
  }
  if (mockFrom !== undefined && recorded.length === 0) {
    throw new SimApiError(
      '--mock-from answers the blocks named by a bare --mock <block>; name at least one',
      0
    )
  }
  return { mocks, recorded }
}

/** Projects friendly CLI flags into the API's strict nested run selector. */
async function resolveWorkflowRunSelection(
  flags: Record<string, unknown>
): Promise<WorkflowRunSelection | undefined> {
  const pinned = pinnedDeployment(flags)
  if (pinned) return pinned
  const trigger = typeof flags.trigger === 'string' ? flags.trigger : undefined
  const sample = flags.sample === true
  const stopAfter = typeof flags.stopAfter === 'string' ? flags.stopAfter : undefined
  const dry = flags.dry === true
  const allow = toArray<string>(flags.allow)
  const mockValues = toArray<string>(flags.mock)
  const mockFrom = typeof flags.mockFrom === 'string' ? flags.mockFrom : undefined
  /** These flags only apply to the draft, so each implies `--draft`. */
  const draft =
    flags.draft === true || trigger !== undefined || sample || stopAfter !== undefined || dry
  const fromBlock = typeof flags.fromBlock === 'string' ? flags.fromBlock : undefined
  const sourceRun = typeof flags.sourceRun === 'string' ? flags.sourceRun : undefined

  if (allow.length > 0 && !dry) {
    throw new SimApiError("--allow sends one block's writes during a dry run; add --dry", 0)
  }
  if ((mockValues.length > 0 || mockFrom !== undefined) && !dry) {
    throw new SimApiError(
      `${mockFrom !== undefined ? '--mock-from' : '--mock'} answers a block during a dry run, so its output never drives real writes; add --dry`,
      0
    )
  }
  if (mockFrom !== undefined && mockFrom.trim() === '') {
    throw new SimApiError('--mock-from requires a run id', 0)
  }
  if (allow.some((block) => block.trim() === '')) {
    throw new SimApiError('--allow requires a block id, name or key', 0)
  }
  if (dry && flags.follow === true) {
    throw new SimApiError(
      '--dry reports its side effects with the run result, which --follow does not return; drop --follow',
      0
    )
  }
  if (dry && (flags.waitTimeout !== undefined || flags.async === true)) {
    throw new SimApiError(
      `--dry reports its side effects with the run result, so the command waits for it; drop ${flags.async === true ? '--async' : '--wait-timeout'}`,
      0
    )
  }

  if (fromBlock && (trigger || sample)) {
    throw new SimApiError('--from-block cannot be combined with --trigger or --sample', 0)
  }
  if (fromBlock && !sourceRun) {
    throw new SimApiError('--from-block requires --source-run <runId>', 0)
  }
  if (sourceRun && !fromBlock) {
    throw new SimApiError('--source-run requires --from-block <block>', 0)
  }
  if ((draft || fromBlock) && flags.async === true) {
    throw new SimApiError(
      `A draft run does not support --async; pass ${WAIT_TIMEOUT_FLAG} to let a long run continue in the background`,
      0
    )
  }
  if (sample && flags.input !== undefined) {
    throw new SimApiError('--sample cannot be combined with --input', 0)
  }
  if (stopAfter !== undefined && stopAfter.trim() === '') {
    throw new SimApiError('--stop-after requires a block id, name or key', 0)
  }

  const { mocks, recorded } = await readBlockMocks(mockValues, mockFrom)
  const options = {
    ...(stopAfter !== undefined ? { stopAfterBlockId: stopAfter } : {}),
    ...(dry ? { dry: true as const } : {}),
    ...(allow.length > 0 ? { allow } : {}),
    ...(Object.keys(mocks).length > 0 ? { mocks } : {}),
    ...(mockFrom !== undefined ? { mocksFrom: { runId: mockFrom, blocks: recorded } } : {}),
  }
  if (fromBlock && sourceRun) {
    return {
      source: 'draft',
      entry: { type: 'block', blockId: fromBlock, sourceRunId: sourceRun },
      ...options,
    }
  }
  if (!draft) return undefined
  if (!trigger && !sample) return { source: 'draft', ...options }
  return {
    source: 'draft',
    entry: {
      type: 'trigger',
      ...(trigger ? { blockId: trigger } : {}),
      ...(sample ? { sample: true } : {}),
    },
    ...options,
  }
}

/**
 * A dry run's side effects in a few lines on stderr, for the human formats: each call that was
 * not sent (a read of a placeholder marked as such, and an MCP call its server declares read-only
 * with the `--allow` that sends it), sent because its block was allowed, or code in a remote
 * sandbox the run cannot see, and notes for an allowed block whose writes all stayed stubbed (an
 * Agent's call to a custom block), an allowed or mocked block the run never reached, and a mock
 * with fields a block reading them never gets. A block is named for `--allow` as the run's
 * `overrides` name it: by id, a child's as `<workflowId>.<blockId>`. The request payloads are in
 * the result itself (`--output json`).
 */
export function printSideEffects(
  sideEffects: unknown,
  overrides: unknown,
  workflowId: unknown
): void {
  if (!isRecordLike(sideEffects)) return
  const list = (key: string) => toArray(sideEffects[key]).filter(isRecordLike)
  const stubbed = list('stubbed')
  const allowed = list('allowed')
  const unchecked = list('unchecked')
  /** Each list keeps a bounded number of entries and counts the rest in `omitted`. */
  const omittedCounts = toRecord(sideEffects.omitted)
  const omittedOf = (key: string) => {
    const count = omittedCounts[key]
    return typeof count === 'number' ? count : 0
  }
  const total = (key: string, entries: unknown[]) => entries.length + omittedOf(key)
  /** An MCP block's call is named by the MCP tool it called, any other by its tool. */
  const label = (entry: Record<string, unknown>) => {
    const mcpTool = toRecord(entry.mcp).tool
    const tool = typeof mcpTool === 'string' ? mcpTool : entry.tool
    return safeOneLine(`${String(entry.block)}${typeof tool === 'string' ? ` → ${tool}` : ''}`)
  }
  const selector = (entry: Record<string, unknown>) => selectorOf(entry, workflowId)
  const why = (entry: Record<string, unknown>) => {
    if (entry.reason === 'placeholder') return ' (reads a placeholder from a stubbed write)'
    if (entry.reason !== 'mcp-read-only') return ''
    return ` (server says read-only: --allow ${shellArgument(safeOneLine(selector(entry)))} sends it)`
  }
  const lines = [
    `Dry run: ${total('stubbed', stubbed)} not sent, ${total('allowed', allowed)} sent (allowed), ${total('unchecked', unchecked)} unchecked`,
    ...stubbed.map((entry) => `  not sent   ${label(entry)}${why(entry)}`),
    ...allowed.map((entry) => `  sent       ${label(entry)}`),
    ...unchecked.map(
      (entry) => `  unchecked  ${label(entry)}: ${safeOneLine(String(entry.reason))}`
    ),
  ]
  const omitted = omittedOf('stubbed') + omittedOf('allowed') + omittedOf('unchecked')
  if (omitted > 0) lines.push(`  … ${omitted} more`)
  for (const allowedBlock of toArray(toRecord(overrides).allow)) {
    if (allowed.some((entry) => selector(entry) === allowedBlock)) continue
    const held = stubbed.find((entry) => selector(entry) === allowedBlock)
    if (!held) continue
    lines.push(
      `  note       ${safeOneLine(String(held.block))} was allowed but sent nothing: allowing an Agent sends only its own tool calls, not a workflow or custom block it calls`
    )
  }
  for (const entry of list('unreached')) {
    lines.push(
      `  note       ${safeOneLine(String(entry.block))} was ${entry.kind === 'mock' ? 'mocked' : 'allowed'} but never ran: check the branch, the entry block, or the workflow you named`
    )
  }
  for (const entry of list('mockFields')) {
    const block = safeOneLine(String(entry.block))
    const undeclared = toArray(entry.undeclared).map(String)
    const dropped = toArray(entry.dropped).map(String)
    if (undeclared.length > 0) {
      lines.push(
        `  note       mock of ${block} sets ${safeOneLine(undeclared.join(', '))}, which the block does not declare; a block reading them gets nothing`
      )
    }
    if (dropped.length > 0) {
      lines.push(
        `  note       mock of ${block} from --mock-from left out ${safeOneLine(dropped.join(', '))}, which only a block sets; a block reading them gets nothing`
      )
    }
  }
  lines.push('Request payloads: sideEffects in --output json')
  writeStderr(styles().dim(`${lines.join('\n')}\n`))
}

function stringField(frame: Record<string, unknown>, key: string): string | null {
  const value = frame[key]
  return typeof value === 'string' ? value : null
}

/** A synchronous run's answer: its result, or the id of a run that outlasted `--wait-timeout`. */
type WorkflowResult =
  | { settled: Record<string, unknown> }
  | {
      /** The run continues in the background; follow it on the runs resource. */
      detachedRunId: string
    }

function detachedRunId(receipt: unknown, status: number): string {
  if (!isRecordLike(receipt) || typeof receipt.runId !== 'string' || receipt.runId === '') {
    throw new SimApiError('Workflow run continued in the background without naming its run', status)
  }
  return receipt.runId
}

/**
 * Reads the heartbeat-delimited result transport used for long synchronous
 * runs. A server that predates the transport ignores `Accept` and returns its
 * ordinary JSON envelope, which is consumed without retrying the run. Either
 * transport may instead hand back the receipt of a run that is still going when
 * `--wait-timeout` elapsed: a `detached` frame, or a `202`.
 */
async function readWorkflowResult(response: Response): Promise<WorkflowResult> {
  const contentType = (response.headers.get('content-type') ?? '').toLowerCase()
  if (!contentType.includes(WORKFLOW_RESULT_STREAM_CONTENT_TYPE)) {
    let envelope: unknown
    try {
      envelope = await response.json()
    } catch {
      throw new SimApiError(
        `Workflow run returned malformed JSON${contentType ? ` as ${contentType}` : ''}`,
        response.status
      )
    }
    if (!isRecordLike(envelope)) {
      throw new SimApiError('Workflow run returned an invalid result envelope', response.status)
    }
    const data = isRecordLike(envelope.data) ? envelope.data : envelope
    if (response.status === 202) return { detachedRunId: detachedRunId(data, response.status) }
    return { settled: data }
  }

  for await (const value of readNdjson(response.body, 'Workflow result stream')) {
    if (!isRecordLike(value) || typeof value.type !== 'string') {
      throw new SimApiError('Workflow result stream returned an unknown event', response.status)
    }
    if (value.type === 'heartbeat') continue
    if (value.type === 'error') {
      throw new SimApiError(
        safeOneLine(typeof value.error === 'string' ? value.error : 'Workflow run failed'),
        typeof value.status === 'number' ? value.status : 0,
        typeof value.code === 'string' ? value.code : null
      )
    }
    if (value.type === 'final' && isRecordLike(value.data)) return { settled: value.data }
    if (value.type === 'detached') {
      return { detachedRunId: detachedRunId(value.data, response.status) }
    }
    throw new SimApiError('Workflow result stream returned an unknown event', response.status)
  }

  throw new SimApiError('Workflow result stream ended without a final result', response.status)
}

/**
 * The `workflows run` request: the generated one, with the run selection the run flags make (the
 * contract omits `run` as a flag of its own) and, for a run this command waits on, an embedded
 * run's file references ({@link withEmbeddedFileReferences}; a queued run rejects the field).
 */
async function runRequest(
  workflowId: string,
  flags: Record<string, unknown>,
  workspaceId: string | null,
  selection: WorkflowRunSelection | undefined,
  waits: boolean
) {
  const request = await buildRequest('executeWorkflow', [workflowId], flags, workspaceId)
  const body = selection ? { ...request.body, run: selection } : request.body
  return { ...request, body: waits ? withEmbeddedFileReferences(body) : body }
}

/**
 * Asks an embedded run for file references without inline bytes unless the caller
 * passed `--include-file-base64`. The embedding host hands stdout to a model, which
 * reads a produced file by id; inlined bytes only grew the result it had to skim and
 * cost the server a storage read and encode per file. Only the synchronous and
 * `--follow` paths set it: an `--async` run rejects the field outright.
 */
function withEmbeddedFileReferences(
  body: Record<string, unknown> | undefined
): Record<string, unknown> | undefined {
  if (!embedStore.getStore() || body?.includeFileBase64 !== undefined) return body
  return { ...body, includeFileBase64: false }
}

/** What a run still going when `--wait-timeout` elapsed says beside its record. */
function stillRunning(runId: string, workflowId: string, waitedSeconds: number) {
  return (snapshot: RunSnapshot) =>
    `Run ${runId} is still ${snapshot.status} after ${waitedSeconds}s and continues in the background. Keep waiting: sim workflows runs wait ${runId} --workflow ${workflowId} --wait-timeout ${waitedSeconds}. Stop it: sim workflows runs cancel ${runId} --workflow ${workflowId}`
}

/** Sends a run this command waits for and reads its answer over the heartbeat transport. */
async function sendWaitedRun(
  client: OperationClient<'executeWorkflow'>,
  workflowId: string,
  flags: Record<string, unknown>,
  workspaceId: string | null,
  selection: WorkflowRunSelection | undefined,
  waitTimeoutSeconds?: number
): Promise<WorkflowResult> {
  const request = await runRequest(workflowId, flags, workspaceId, selection, true)
  const response = await client.requestRaw('executeWorkflow', {
    params: request.params,
    query: request.query,
    body: waitTimeoutSeconds === undefined ? request.body : { ...request.body, waitTimeoutSeconds },
    headers: { ...request.headers, accept: WORKFLOW_RESULT_STREAM_CONTENT_TYPE },
  })
  return readWorkflowResult(response)
}

/** What a write's result shows of its `--run` test run. */
export interface TestRun {
  runId: unknown
  status: unknown
  error?: unknown
  output: unknown
  sideEffects?: unknown
  next?: unknown
}

/**
 * A `--run` record as a source write's result shows it: the run id, status, error message, the
 * workflow's output, the side effects the dry run held back and, for a run that failed in a
 * block, the dry rerun from where the server says a rerun can start (none when it names none).
 */
export function testRunResult(record: Record<string, unknown>): TestRun {
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

/**
 * The run record of `sim workflows run <workflowId> --dry --input <input>`: the saved draft run
 * with its writes stubbed, waited for. `input` is read as `--input` reads it (JSON, or `@file`).
 * A failed run is returned, not thrown: the caller decides what it stops.
 */
export async function dryRunDraft(
  client: OperationClient<'executeWorkflow'>,
  workflowId: string,
  input: string | undefined,
  workspaceId: string | null
): Promise<Record<string, unknown>> {
  const commandSpec = CLI_CONTRACT.executeWorkflow ?? {}
  try {
    const result = await sendWaitedRun(
      client,
      workflowId,
      input === undefined ? {} : { input },
      workspaceId,
      { source: 'draft', dry: true }
    )
    // A dry run is never detached (it cannot take --wait-timeout); a server that did is reported.
    if ('detachedRunId' in result) {
      throw new SimApiError(
        `The test run ${result.detachedRunId} continued in the background: sim workflows runs wait ${result.detachedRunId} --workflow ${workflowId}`,
        0
      )
    }
    return result.settled
  } catch (error) {
    throw retypeApiError(
      error,
      'executeWorkflow',
      commandSpec,
      V2_OPERATIONS.executeWorkflow as OperationSpec
    )
  }
}

/**
 * Runs synchronously while keeping idle-limited HTTP paths active.
 *
 * With `--wait-timeout`, a run the server stops waiting for keeps going, and this
 * command ends as a `workflows runs wait` whose bound just elapsed would: the run
 * record on stdout and its exit status (4 while it is still moving).
 */
async function runWithResultStream(
  workflowId: string,
  command: Command,
  selection: WorkflowRunSelection | undefined,
  waitTimeoutSeconds: number | undefined
): Promise<void> {
  const flags = command.optsWithGlobals() as Record<string, unknown>
  const connection = connect(command, ['executeWorkflow', 'getWorkflowRun'])
  const { client, profile } = connection
  const operation = V2_OPERATIONS.executeWorkflow as OperationSpec
  const commandSpec = CLI_CONTRACT.executeWorkflow ?? {}

  try {
    const result = await sendWaitedRun(
      client,
      workflowId,
      flags,
      profile.workspaceId,
      selection,
      waitTimeoutSeconds
    )
    if ('detachedRunId' in result) {
      // The server already spent the wait, so the run is read once and reported.
      const now = Date.now()
      await waitForRun(connection, {
        runId: result.detachedRunId,
        workflowId,
        startedAt: now,
        deadline: now,
        timedOut: stillRunning(result.detachedRunId, workflowId, waitTimeoutSeconds ?? 0),
      })
      return
    }
    const payload = result.settled

    renderResult('executeWorkflow', profile.output, payload, commandSpec, {
      expandedTrace: flags.trace === true,
    })
    if (profile.output === 'table' || profile.output === 'text') {
      printSideEffects(payload.sideEffects, payload.overrides, payload.workflowId)
    }

    const failure = runFailureMessage('executeWorkflow', payload)
    if (failure) {
      if (typeof flags.dir === 'string') {
        await printRunFailureSite(flags.dir, workflowId, toRecord(payload).error)
      }
      throw new SimApiError(failure, 0)
    }
  } catch (error) {
    throw retypeApiError(error, 'executeWorkflow', commandSpec, operation)
  }
}

/**
 * Yields the payload of every `data:` line in an SSE body.
 *
 * Split on `\n` rather than on the `\n\n` event separator: a chunk boundary can
 * fall between the two newlines, and a parser keyed on the pair would hold the
 * completed event until the next one arrived — turning a live token stream into
 * one that always lags a frame behind.
 */
async function* sseData(body: ReadableStream<Uint8Array>): AsyncGenerator<string> {
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  try {
    while (true) {
      const { done, value } = await reader.read()
      // `buffer` never holds a newline, so only the new text needs splitting.
      const lines = (done ? decoder.decode() : decoder.decode(value, { stream: true })).split('\n')
      lines[0] = buffer + lines[0]
      buffer = done ? '' : (lines.pop() ?? '')

      for (const rawLine of lines) {
        const line = rawLine.endsWith('\r') ? rawLine.slice(0, -1) : rawLine
        if (!line.startsWith('data:')) continue
        const payload = line.slice(5).startsWith(' ') ? line.slice(6) : line.slice(5)
        if (payload.length > 0) yield payload
      }

      if (done) return
    }
  } finally {
    reader.releaseLock()
  }
}

/**
 * Writes run commentary while keeping raw answer text and line-oriented notices
 * from colliding.
 *
 * Answer and thinking text arrive as deltas with no framing of their own, so a
 * tool notice emitted mid-token would be appended to whatever half-sentence was
 * already on the line. The cursor position is tracked instead of guessed.
 */
class Commentary {
  private atLineStart = true

  constructor(private readonly sink: CommentaryWriter) {}

  inline(text: string): void {
    if (text.length === 0) return
    this.sink.write(text)
    this.atLineStart = text.endsWith('\n')
  }

  line(text: string): void {
    this.sink.write(`${this.atLineStart ? '' : '\n'}${text}\n`)
    this.atLineStart = true
  }

  /** Closes a half-written delta line without inventing a blank one. */
  endLine(): void {
    if (this.atLineStart) return
    this.sink.write('\n')
    this.atLineStart = true
  }
}

function toolNotice(frame: Record<string, unknown>): string {
  const name = safeOneLine(stringField(frame, 'name') ?? 'tool')
  if (frame.phase === 'start') return styles().dim(`→ ${name}`)

  const status = stringField(frame, 'status')
  if (status && status !== 'success') return styles().yellow(`✗ ${name} (${safeOneLine(status)})`)
  return styles().dim(`✓ ${name}`)
}

/**
 * Renders one execute stream, returning the `final` envelope.
 *
 * Everything rendered here is commentary and goes to `stderr`: the payload a
 * script captures is the final envelope, which the caller prints to stdout in
 * the profile's output format. Streaming the answer text to stdout as well
 * would put the same content in the redirect twice, once unparseable.
 *
 * Throws on a terminal `error` frame and on a stream that stops before either
 * terminal frame arrives — a truncated stream is a failed run, and reporting it
 * as an empty success is the one outcome a caller cannot detect afterwards.
 */
export async function renderRunStream(
  body: ReadableStream<Uint8Array>,
  options: FollowOptions
): Promise<Record<string, unknown>> {
  const commentary = new Commentary(options.stderr)
  let final: Record<string, unknown> | null = null

  for await (const payload of sseData(body)) {
    let frame: unknown
    try {
      frame = JSON.parse(payload)
    } catch {
      // A `data:` line the CLI cannot parse is a protocol the CLI does not
      // speak yet, not a failed run. Skipping keeps a server that adds a frame
      // shape from breaking every older client that only wants the outcome.
      continue
    }

    if (frame === DONE_SENTINEL) break
    if (!isRecordLike(frame)) continue

    if (frame.event === undefined && typeof frame.chunk === 'string') {
      commentary.inline(sanitize(frame.chunk))
      continue
    }

    switch (frame.event) {
      case 'chunk_reset':
        commentary.line(styles().dim('… retracted; that turn resolved to tool calls'))
        break
      case 'thinking':
        if (options.includeThinking && typeof frame.data === 'string') {
          commentary.inline(styles().dim(sanitize(frame.data)))
        }
        break
      case 'tool':
        if (options.includeToolCalls) commentary.line(toolNotice(frame))
        break
      case 'stream_error':
        commentary.line(
          styles().yellow(
            `warning: ${safeOneLine(stringField(frame, 'error') ?? 'stream read failed')}`
          )
        )
        break
      case 'error':
        commentary.endLine()
        throw new SimApiError(
          safeOneLine(stringField(frame, 'error') ?? 'The workflow run failed.'),
          0
        )
      case 'final':
        if (isRecordLike(frame.data)) final = frame.data
        break
      default:
        break
    }
  }

  commentary.endLine()
  if (!final) {
    throw new SimApiError(
      'The run stream ended before the workflow reported a result. The run may still be in progress — check: sim workflows runs list',
      0
    )
  }
  return final
}

/**
 * Sends the run and renders it. Kept apart from the Commander wiring so the
 * whole protocol can be exercised without parsing argv.
 */
async function followRun(
  workflowId: string,
  command: Command,
  selection: WorkflowRunSelection | undefined
): Promise<void> {
  const flags = command.optsWithGlobals() as Record<string, unknown>

  if (flags.async === true) {
    throw new SimApiError(
      '--follow streams a run as it happens and --async returns before it starts; pass one, not both',
      0
    )
  }

  const includeThinking = flags.includeThinking === true
  const includeToolCalls = flags.includeToolCalls === true
  const negotiates = includeThinking || includeToolCalls

  const { client, profile } = connect(command, ['executeWorkflow'])
  const operation = V2_OPERATIONS.executeWorkflow as OperationSpec
  const request = await runRequest(workflowId, flags, profile.workspaceId, selection, true)

  const response = await client.requestRaw('executeWorkflow', {
    params: request.params,
    query: request.query,
    body: {
      ...request.body,
      stream: true,
      ...(includeThinking ? { includeThinking: true } : {}),
      ...(includeToolCalls ? { includeToolCalls: true } : {}),
    },
    headers: {
      accept: 'text/event-stream',
      ...(negotiates ? { [AGENT_STREAM_PROTOCOL_HEADER]: AGENT_STREAM_PROTOCOL_V1 } : {}),
    },
  })

  const contentType = response.headers.get('content-type') ?? ''
  if (!contentType.toLowerCase().includes('text/event-stream')) {
    await response.body?.cancel()
    throw new SimApiError(
      `${operation.path} answered ${contentType || 'an unknown content type'} instead of an event stream. This deployment may predate streaming runs — re-run without --follow.`,
      response.status
    )
  }
  if (!response.body) {
    throw new SimApiError('The run stream had no body.', response.status)
  }

  const final = await renderRunStream(response.body, {
    includeThinking,
    includeToolCalls,
    stderr: { write: writeStderr },
  })

  renderResult('executeWorkflow', profile.output, final, CLI_CONTRACT.executeWorkflow ?? {})

  // Printed first, then failed: the envelope carries the block outputs that
  // explain *why* the run failed, and exiting before writing it would leave a
  // piped consumer with an exit code and nothing to read.
  if (final.success === false) {
    throw new SimApiError(
      safeOneLine(typeof final.error === 'string' ? final.error : 'The workflow run failed.'),
      0
    )
  }
}

/**
 * The selection a `--stop-after` run sends when the caller selected nothing: the stop block's
 * whole output, so `blockOutputs` (with `--follow`, the final frame's `output`) names the block
 * the run stopped after and holds what it produced (no Response block ran). The block is sent as
 * the executor compares names (`normalizeWorkflowBlockName`), so a display name with a dot is not read
 * as a path; an id is sent as it is.
 */
function stopBlockSelection(
  selection: WorkflowRunSelection | undefined,
  flags: Record<string, unknown>
): string[] | null {
  const stopAfter = selection?.source === 'draft' ? selection.stopAfterBlockId : undefined
  if (stopAfter === undefined) return null
  if (Array.isArray(flags.selectOutput) && flags.selectOutput.length > 0) return null
  return [BLOCK_ID.test(stopAfter) ? stopAfter : normalizeWorkflowBlockName(stopAfter)]
}

/** Queues an `--async` run and prints its receipt: the run id and where to poll it. */
async function queueRun(
  workflowId: string,
  command: Command,
  selection: WorkflowRunSelection | undefined
): Promise<void> {
  const flags = command.optsWithGlobals() as Record<string, unknown>
  const { client, profile } = connect(command, ['executeWorkflow'])
  const operation = V2_OPERATIONS.executeWorkflow as OperationSpec
  const commandSpec = CLI_CONTRACT.executeWorkflow ?? {}
  try {
    const request = await runRequest(workflowId, flags, profile.workspaceId, selection, false)
    const { data } = await client.request<{ data: unknown }>('executeWorkflow', request)
    renderResult('executeWorkflow', profile.output, data, commandSpec)
  } catch (error) {
    throw retypeApiError(error, 'executeWorkflow', commandSpec, operation)
  }
}

/** The action of the `workflows run` leaf: validates the flags, then runs, follows or queues. */
async function runWorkflow(workflowId: string, _options: unknown, command: Command): Promise<void> {
  const initialFlags = command.optsWithGlobals() as Record<string, unknown>
  const waitTimeoutSeconds =
    typeof initialFlags.waitTimeout === 'string'
      ? Math.ceil(parseWaitTimeout(initialFlags.waitTimeout))
      : undefined
  if (waitTimeoutSeconds !== undefined && initialFlags.async === true) {
    throw new SimApiError(
      '--wait-timeout bounds how long a synchronous run is waited for, and --async never waits; pass one, not both',
      0
    )
  }
  if (waitTimeoutSeconds !== undefined && initialFlags.follow === true) {
    throw new SimApiError(
      '--wait-timeout cannot be combined with --follow, which streams the run until it ends',
      0
    )
  }
  if (
    typeof initialFlags.dir === 'string' &&
    (initialFlags.follow === true || initialFlags.async === true)
  ) {
    throw new SimApiError(
      '--dir maps the failure of a run this command waits for; --follow and --async do not report the block that failed. Drop --dir, or run without them',
      0
    )
  }
  const selection = await resolveWorkflowRunSelection(initialFlags)
  const stopBlock = stopBlockSelection(selection, initialFlags)
  if (stopBlock) command.setOptionValue('selectOutput', stopBlock)
  const flags = command.optsWithGlobals() as Record<string, unknown>

  if (flags.follow !== true) {
    // A queued run has produced nothing to select from, so the server would
    // answer 400; failing locally names the recovery: the finished run is read
    // with `runs get`, which takes the same block names (`workflow-run-get.ts`).
    if (
      Array.isArray(flags.selectOutput) &&
      flags.selectOutput.length > 0 &&
      flags.async === true
    ) {
      throw new SimApiError(
        '--select-output names outputs of a completed run, and --async returns as soon as the run is queued. Drop one of them, or read the finished run with: sim workflows runs get <runId> --workflow <workflowId> --select-output <blockName|blockId>[.path] — that resource takes the same selectors --select-output takes here.',
        0
      )
    }
    if (flags.includeThinking === true || flags.includeToolCalls === true) {
      throw new SimApiError(
        '--include-thinking and --include-tool-calls describe a stream; add --follow',
        0
      )
    }
    if (flags.async !== true) {
      await runWithResultStream(workflowId, command, selection, waitTimeoutSeconds)
      return
    }
    await queueRun(workflowId, command, selection)
    return
  }

  await followRun(workflowId, command, selection)
}

/** `sim workflows run --help`, after the options: which version runs, what it prints, how it exits. */
const RUN_HELP = `
Without --draft (or a flag that implies it) this runs the active deployment; a workflow never
deployed has none. --deployment-version <n> runs that deployed version instead (it needs
workspace write access, through a full-access API key or an OAuth token with api:write); the
child workflows it calls still run their own active deployment. --draft runs the saved draft, as
the source loop leaves it, sending its writes.

--dry runs the saved draft without its writes: each call that could change something (a write
tool, any MCP call, an HTTP request other than GET/HEAD/OPTIONS, code's other fetches) gets a
placeholder (ids like dry_run_row_1, numbers above 900000000) and is listed in
sideEffects.stubbed with the request it would have sent; check those payloads. A read that would
send a placeholder is held back too (reason placeholder), and an MCP call its server calls
read-only says so (reason mcp-read-only). Reads, model calls and code run for real; code in a
remote sandbox (shell, Python, imports) is listed in sideEffects.unchecked. Child workflows run
dry too; custom, Human in the loop and Wait blocks are answered whole, so the run never pauses.
--allow <block> sends that block's writes for real (use a test resource). --mock <block>=<json>
answers a block with fixed output, to steer a branch; --mock-from <runId> with a bare
--mock <block> answers it with the output that run recorded. --allow and --mock also name a
block of a workflow this one calls as <workflow>.<block>. Overrides the run never reached are
listed in sideEffects.unreached, and mock fields a block never gets in sideEffects.mockFields.
The API reference describes each list and refusal.

The result is the run: runId, status (completed, failed, paused or cancelled), error, output (the
workflow's final output) and blockOutputs (what --select-output named). It has no success field:
branch on status, or on the exit code. With --follow it is the stream's final frame
instead: success and output.

A run that failed in a block has next: { command, reason }, the command that reruns the saved
draft from that block (or the outermost loop or parallel holding it) with this run as
--source-run. A dry run's keeps --dry and --allow, and reads its mocks again with --mock-from; a
mock it cannot read again (a child's block, one never reached, or one passed beside --mock-from)
is left out and named in nextNote, for you to pass again. A run paused for input has next: the
runs resume command.

Exit codes: 0 completed or paused (--async: queued); 1 failed or cancelled (the result is printed
first, then the error on stderr), or the command failed; ${STILL_RUNNING_EXIT_CODE} still running when --wait-timeout
elapsed.`

/**
 * Teaches the generated `workflows run` leaf to stream.
 *
 * `--follow` rides on `run` rather than standing up a sibling command because
 * it is the same operation with a different response encoding: the input,
 * output-selection, and `--async` flags all still apply, and a second command
 * would have to restate every one of them and then drift.
 *
 * Every mode builds its request with the same generated request builder: the
 * run selection the run flags make is added to the body by hand, since the
 * generated leaf omits `run`. Synchronous execution reads a heartbeat-capable
 * response.
 */
export function attachWorkflowRunFollow(workflows: Command): void {
  const run = workflows.commands.find((command) => command.name() === 'run')
  if (!run) {
    throw new Error('workflows run must be registered before --follow can be attached to it')
  }

  // A run that outlasts --wait-timeout is read back from the runs resource.
  callsOperations(run, ['executeWorkflow', 'getWorkflowRun'], { runs: 'executeWorkflow' })

  run
    .option('--draft', 'Run the saved draft instead of the active deployment, sending its writes')
    .option(
      '--deployment-version <n>',
      "Run this deployed version instead of the active one (a version number from `sim workflows versions list`); a Workflow block in it still runs its child workflow's active deployment. Needs workspace write access, through a full-access API key or an OAuth token with api:write. Not with --draft or any flag that runs the draft"
    )
    .option(
      '--dry',
      'Dry run of the saved draft (implies --draft): writes are not sent but answered with placeholders and listed with their request payloads in sideEffects; reads, model calls and code run for real. Logged as a test run. Not with --follow, --async or --wait-timeout'
    )
    .option(
      '--allow <block>',
      "Send this block's writes for real during a --dry run (its id, display name or key, or <workflow>.<block> for a workflow it calls); for an Agent, only its own tool calls, not a workflow or custom block it calls; repeatable",
      collectRepeated
    )
    .option(
      '--mock <block>=<json|@file>',
      'Answer this block with the given JSON object instead of running it during a --dry run (its id, display name or key, or <workflow>.<block> for a workflow it calls), to steer a branch or give a stubbed write a realistic result; a bare --mock <block> takes its output from --mock-from. Not a locked block, or one of a locked workflow or folder; data only (the API reference lists the fields a mock cannot set). The run records only which blocks were mocked, not the outputs, so a rerun reads them again with --mock-from; repeatable',
      collectRepeated
    )
    .option(
      '--mock-from <runId>',
      "Answer each block a bare --mock <block> names with the output it recorded in this earlier run of the workflow, redacted as the run shows it: this workflow's blocks (not a child's; not inside a loop or parallel unless that run mocked it); fields a mock cannot set, such as cost or model, are left out (requires --dry)"
    )
    .option(
      '--trigger <blockId>',
      'Enter the run through this runnable trigger, by its block id; runs the saved draft (implies --draft)'
    )
    .option(
      '--sample',
      "Run with the selected trigger's sample payload instead of --input; runs the saved draft (implies --draft), whose writes are sent unless --dry"
    )
    .option(
      '--from-block <block>',
      'Rerun the saved draft from this block (its id, display name or key), reusing the outputs --source-run produced before it; a failed run prints this command as next'
    )
    .option(
      '--source-run <runId>',
      'Earlier run of this workflow, deployed or draft, whose outputs the blocks before --from-block keep (requires --from-block)'
    )
    .option(
      '--stop-after <block>',
      'Stop the run after this saved block (its id, display name or key), failing it if the run takes a path that skips the block; with --from-block on the same block, re-runs only that block (implies --draft). Unless --select-output names others, blockOutputs holds the output of that block under its key (or id); output stays empty'
    )
    .option(
      '--dir <dir>',
      "This workflow's source directory: a failed run names the source file and line of the block that failed, read through its .sim/lock.json. Not with --async or --follow, and not for a run --wait-timeout leaves running"
    )
    .option(
      WAIT_TIMEOUT_FLAG,
      'Wait at most this many seconds for a synchronous run (0 waits until it settles). A run still going then continues in the background under async limits: the command prints its run record and exits 4, and `sim workflows runs wait` keeps waiting. Not with --async or --follow'
    )
    .option(
      '--follow',
      'Stream the run as it happens; progress on stderr, result on stdout. The stream reports only success and output, so the result omits the run id and timings a non-streaming run returns'
    )
    .option('--include-thinking', 'Show model reasoning while following (requires --follow)')
    .option('--include-tool-calls', 'Show tool calls while following (requires --follow)')
    .addHelpText('after', RUN_HELP)
    .action(runWorkflow)
}
