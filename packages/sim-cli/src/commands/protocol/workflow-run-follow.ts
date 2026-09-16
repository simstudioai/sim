import chalk from 'chalk'
import type { Command } from 'commander'
import { clientFrom } from '../../context'
import { CLI_CONTRACT } from '../../contract/commands'
import { V2_OPERATIONS } from '../../generated/v2-api'
import { SimApiError } from '../../http/client'
import { readNdjson } from '../../http/ndjson'
import { safeOneLine, sanitize } from '../../output/render'
import { executeOperation, runFailureMessage } from '../../runtime/execute'
import { retypeApiError } from '../../runtime/naming'
import { buildRequest } from '../../runtime/request'
import { renderResult } from '../../runtime/result'
import type { OperationSpec } from '../../runtime/types'

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

type WorkflowRunSelection =
  | { source: 'manual' }
  | {
      source: 'manual'
      entry: { type: 'trigger'; blockId?: string; useMockPayload?: boolean }
    }
  | {
      source: 'manual'
      entry: { type: 'block'; blockId: string; sourceRunId: string }
    }

/** Projects friendly CLI flags into the API's strict nested run selector. */
export function resolveWorkflowRunSelection(
  flags: Record<string, unknown>
): WorkflowRunSelection | undefined {
  const manual = flags.manual === true
  const trigger = typeof flags.trigger === 'string' ? flags.trigger : undefined
  const useMockPayload = flags.mockPayload === true
  const fromBlock = typeof flags.fromBlock === 'string' ? flags.fromBlock : undefined
  const sourceRun = typeof flags.sourceRun === 'string' ? flags.sourceRun : undefined

  if ((trigger || useMockPayload) && !manual) {
    throw new SimApiError('--trigger and --mock-payload require --manual', 0)
  }
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
    throw new SimApiError('Manual execution does not support --async', 0)
  }
  if (useMockPayload && flags.input !== undefined) {
    throw new SimApiError('--mock-payload cannot be combined with --input', 0)
  }

  if (fromBlock && sourceRun) {
    return {
      source: 'manual',
      entry: { type: 'block', blockId: fromBlock, sourceRunId: sourceRun },
    }
  }
  if (!manual) return undefined
  if (!trigger && !useMockPayload) return { source: 'manual' }
  return {
    source: 'manual',
    entry: {
      type: 'trigger',
      ...(trigger ? { blockId: trigger } : {}),
      ...(useMockPayload ? { useMockPayload: true } : {}),
    },
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function stringField(frame: Record<string, unknown>, key: string): string | null {
  const value = frame[key]
  return typeof value === 'string' ? value : null
}

/**
 * Reads the heartbeat-delimited result transport used for long synchronous
 * runs. A server that predates the transport ignores `Accept` and returns its
 * ordinary JSON envelope, which is consumed without retrying the run.
 */
async function readWorkflowResult(response: Response): Promise<Record<string, unknown>> {
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
    if (!isRecord(envelope)) {
      throw new SimApiError('Workflow run returned an invalid result envelope', response.status)
    }
    return isRecord(envelope.data) ? envelope.data : envelope
  }

  for await (const value of readNdjson(response.body, 'Workflow result stream')) {
    if (!isRecord(value) || typeof value.type !== 'string') {
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
    if (value.type === 'final' && isRecord(value.data)) return value.data
    throw new SimApiError('Workflow result stream returned an unknown event', response.status)
  }

  throw new SimApiError('Workflow result stream ended without a final result', response.status)
}

/** Runs synchronously while keeping idle-limited HTTP paths active. */
async function runWithResultStream(workflowId: string, command: Command): Promise<void> {
  const flags = command.optsWithGlobals() as Record<string, unknown>
  const { client, profile } = clientFrom(command)
  const operation = V2_OPERATIONS.executeWorkflow as OperationSpec
  const commandSpec = CLI_CONTRACT.executeWorkflow ?? {}

  try {
    const request = buildRequest('executeWorkflow', [workflowId], flags, profile.workspaceId)
    const response = await client.requestRaw(request.path, {
      method: operation.method,
      query: request.query,
      body: request.body,
      headers: { ...request.headers, accept: WORKFLOW_RESULT_STREAM_CONTENT_TYPE },
    })
    const payload = await readWorkflowResult(response)

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
  if (frame.phase === 'start') return chalk.dim(`→ ${name}`)

  const status = stringField(frame, 'status')
  if (status && status !== 'success') return chalk.yellow(`✗ ${name} (${safeOneLine(status)})`)
  return chalk.dim(`✓ ${name}`)
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
    if (!isRecord(frame)) continue

    if (frame.event === undefined && typeof frame.chunk === 'string') {
      commentary.inline(sanitize(frame.chunk))
      continue
    }

    switch (frame.event) {
      case 'chunk_reset':
        commentary.line(chalk.dim('… retracted; that turn resolved to tool calls'))
        break
      case 'thinking':
        if (options.includeThinking && typeof frame.data === 'string') {
          commentary.inline(chalk.dim(sanitize(frame.data)))
        }
        break
      case 'tool':
        if (options.includeToolCalls) commentary.line(toolNotice(frame))
        break
      case 'stream_error':
        commentary.line(
          chalk.yellow(
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
        if (isRecord(frame.data)) final = frame.data
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

  const { client, profile } = clientFrom(command)
  const operation = V2_OPERATIONS.executeWorkflow as OperationSpec
  const request = buildRequest('executeWorkflow', [workflowId], flags, profile.workspaceId)

  const response = await client.requestRaw(request.path, {
    method: 'POST',
    query: request.query,
    body: {
      ...(request.body ?? {}),
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
    stderr: process.stderr,
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
    const selection = resolveWorkflowRunSelection(initialFlags)
    if (selection) command.setOptionValue('run', selection)
    const flags = command.optsWithGlobals() as Record<string, unknown>

    if (flags.follow !== true) {
      // `selectedOutputs` is stream-only server-side, so without `--follow` the
      // generated path spends a request to be told so. The recovery names the
      // run resource and its dialect: `--select-output` here takes block names,
      // and `workflows runs get` resolves block ids only, so repeating what was
      // just typed there fails a second time.
      if (Array.isArray(flags.selectOutput) && flags.selectOutput.length > 0) {
        throw new SimApiError(
          flags.async === true
            ? '--select-output shapes a streamed result, and --async returns as soon as the run is queued, so there is no stream to shape. Drop one of them, or read the finished run with: sim workflows runs get <runId> --workflow <workflowId> --select-output <blockId>[.path] — that resource matches block ids, not the block names --select-output takes here.'
            : '--select-output shapes a streamed result; add --follow. To narrow a run that has already finished: sim workflows runs get <runId> --workflow <workflowId> --select-output <blockId>[.path] — that resource matches block ids, not the block names --select-output takes here.',
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
        await runWithResultStream(workflowId, command)
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

  run
    .option('--manual', 'Run the current saved workflow state instead of the active deployment')
    .option(
      '--trigger <blockId>',
      'Enter a manual run through this runnable trigger (requires --manual)'
    )
    .option(
      '--mock-payload',
      "Use the selected trigger's server-derived mock payload (requires --manual)"
    )
    .option('--from-block <blockId>', 'Run manually from this saved workflow block')
    .option(
      '--source-run <runId>',
      'Prior run whose persisted state supplies upstream outputs (requires --from-block)'
    )
    .option(
      '--follow',
      'Stream the run as it happens; progress on stderr, result on stdout. The stream reports only success and output, so the result omits the run id and timings a non-streaming run returns'
    )
    .option('--include-thinking', 'Show model reasoning while following (requires --follow)')
    .option('--include-tool-calls', 'Show tool calls while following (requires --follow)')
    .action(followOrDelegate(previous))
}
