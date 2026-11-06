import { isRecordLike } from '@sim/utils/object'
import type { Command } from 'commander'
import { writeStderr } from '#sim-cli/output/io'
import { styles } from '#sim-cli/output/presentation'
import { CLI_CONTRACT } from '../../contract/commands'
import { embedStore } from '../../embed-context'
import { V2_OPERATIONS } from '../../generated/v2-api'
import { SimApiError } from '../../http/client'
import { readNdjson } from '../../http/ndjson'
import { safeOneLine, sanitize } from '../../output/render'
import { callsOperations, connect } from '../../runtime/called-operations'
import { executeOperation, runFailureMessage } from '../../runtime/execute'
import { retypeApiError } from '../../runtime/naming'
import { buildRequest } from '../../runtime/request'
import { renderResult } from '../../runtime/result'
import type { OperationSpec } from '../../runtime/types'
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
export interface CommentaryWriter {
  write(text: string): unknown
}

export interface FollowOptions {
  includeThinking: boolean
  includeToolCalls: boolean
  stderr: CommentaryWriter
}

type WorkflowRunSelection = {
  source: 'manual'
  entry?:
    | { type: 'trigger'; blockId?: string; useMockPayload?: boolean }
    | { type: 'block'; blockId: string; sourceRunId: string }
  stopAfterBlockId?: string
}

/** Projects friendly CLI flags into the API's strict nested run selector. */
export function resolveWorkflowRunSelection(
  flags: Record<string, unknown>
): WorkflowRunSelection | undefined {
  const trigger = typeof flags.trigger === 'string' ? flags.trigger : undefined
  const useMockPayload = flags.mockPayload === true
  const stopAfter = typeof flags.stopAfter === 'string' ? flags.stopAfter : undefined
  /** A trigger entry and a stop block only exist on the draft, so these flags imply `--manual`. */
  const manual =
    flags.manual === true || trigger !== undefined || useMockPayload || stopAfter !== undefined
  const fromBlock = typeof flags.fromBlock === 'string' ? flags.fromBlock : undefined
  const sourceRun = typeof flags.sourceRun === 'string' ? flags.sourceRun : undefined

  if (fromBlock && (trigger || useMockPayload)) {
    throw new SimApiError('--from-block cannot be combined with --trigger or --mock-payload', 0)
  }
  if (fromBlock && !sourceRun) {
    throw new SimApiError('--from-block requires --source-run <runId>', 0)
  }
  if (sourceRun && !fromBlock) {
    throw new SimApiError('--source-run requires --from-block <blockId>', 0)
  }
  if ((manual || fromBlock) && flags.async === true) {
    throw new SimApiError(
      `Manual execution does not support --async; pass ${WAIT_TIMEOUT_FLAG} to let a long run continue in the background`,
      0
    )
  }
  if (useMockPayload && flags.input !== undefined) {
    throw new SimApiError('--mock-payload cannot be combined with --input', 0)
  }
  if (stopAfter !== undefined && stopAfter.trim() === '') {
    throw new SimApiError('--stop-after requires a block ID', 0)
  }

  const stop = stopAfter !== undefined ? { stopAfterBlockId: stopAfter } : {}
  if (fromBlock && sourceRun) {
    return {
      source: 'manual',
      entry: { type: 'block', blockId: fromBlock, sourceRunId: sourceRun },
      ...stop,
    }
  }
  if (!manual) return undefined
  if (!trigger && !useMockPayload) return { source: 'manual', ...stop }
  return {
    source: 'manual',
    entry: {
      type: 'trigger',
      ...(trigger ? { blockId: trigger } : {}),
      ...(useMockPayload ? { useMockPayload: true } : {}),
    },
    ...stop,
  }
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
  waitTimeoutSeconds: number | undefined
): Promise<void> {
  const flags = command.optsWithGlobals() as Record<string, unknown>
  const connection = connect(command, ['executeWorkflow', 'getWorkflowRun'])
  const { client, profile } = connection
  const operation = V2_OPERATIONS.executeWorkflow as OperationSpec
  const commandSpec = CLI_CONTRACT.executeWorkflow ?? {}

  try {
    const request = await buildRequest('executeWorkflow', [workflowId], flags, profile.workspaceId)
    const body = withEmbeddedFileReferences(request.body)
    const response = await client.requestRaw('executeWorkflow', {
      params: request.params,
      query: request.query,
      body: waitTimeoutSeconds === undefined ? body : { ...body, waitTimeoutSeconds },
      headers: { ...request.headers, accept: WORKFLOW_RESULT_STREAM_CONTENT_TYPE },
    })
    const result = await readWorkflowResult(response)
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

    const failure = runFailureMessage('executeWorkflow', payload)
    if (failure) throw new SimApiError(failure, 0)
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
      buffer += done ? decoder.decode() : decoder.decode(value, { stream: true })

      const lines = buffer.split('\n')
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
async function followRun(workflowId: string, command: Command): Promise<void> {
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
  const request = await buildRequest('executeWorkflow', [workflowId], flags, profile.workspaceId)

  const response = await client.requestRaw('executeWorkflow', {
    params: request.params,
    query: request.query,
    body: {
      ...withEmbeddedFileReferences(request.body),
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
 * The handler Commander invokes for the generated `run` leaf, given the handler
 * it is replacing.
 */
function followOrDelegate(previous: ((args: unknown[]) => unknown) | null) {
  return async (workflowId: string, _options: unknown, command: Command): Promise<void> => {
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
    const selection = resolveWorkflowRunSelection(initialFlags)
    if (selection) command.setOptionValue('run', selection)
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
        await runWithResultStream(workflowId, command, waitTimeoutSeconds)
        return
      }

      if (previous) {
        await previous(command.processedArgs)
        return
      }
      await executeOperation(
        'executeWorkflow',
        CLI_CONTRACT.executeWorkflow ?? {},
        V2_OPERATIONS.executeWorkflow as OperationSpec,
        [workflowId, command.opts(), command]
      )
      return
    }

    await followRun(workflowId, command)
  }
}

/**
 * Teaches the generated `workflows run` leaf to stream.
 *
 * `--follow` rides on `run` rather than standing up a sibling command because
 * it is the same operation with a different response encoding: the input,
 * output-selection, and `--async` flags all still apply, and a second command
 * would have to restate every one of them and then drift.
 *
 * Commander offers no way to read the action it already holds, so the existing
 * handler is captured for async execution. Synchronous execution uses the same
 * generated request and result builders with a heartbeat-capable response.
 */
export function attachWorkflowRunFollow(workflows: Command): void {
  const run = workflows.commands.find((command) => command.name() === 'run')
  if (!run) {
    throw new Error('workflows run must be registered before --follow can be attached to it')
  }

  const held = (run as Command & { _actionHandler?: unknown })._actionHandler
  const previous = typeof held === 'function' ? (held as (args: unknown[]) => unknown) : null
  // A run that outlasts --wait-timeout is read back from the runs resource.
  callsOperations(run, ['executeWorkflow', 'getWorkflowRun'], { runs: 'executeWorkflow' })

  run
    .option('--manual', 'Run the current saved workflow state instead of the active deployment')
    .option(
      '--trigger <blockId>',
      'Enter the run through this runnable trigger; runs the current saved workflow state (implies --manual)'
    )
    .option(
      '--mock-payload',
      "Use the selected trigger's server-derived mock payload; runs the current saved workflow state (implies --manual)"
    )
    .option('--from-block <blockId>', 'Run manually from this saved workflow block')
    .option(
      '--source-run <runId>',
      'Prior run whose persisted state supplies upstream outputs (requires --from-block)'
    )
    .option(
      '--stop-after <blockId>',
      'Stop the run after this saved block, failing it if the run takes a path that skips the block; with --from-block on the same block, re-runs only that block (implies --manual)'
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
    .action(followOrDelegate(previous))
}
