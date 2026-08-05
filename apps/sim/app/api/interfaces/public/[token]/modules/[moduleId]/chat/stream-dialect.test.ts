/**
 * @vitest-environment node
 *
 * Pins the wire dialect this route speaks to the one its client decodes.
 *
 * The chat module renders a public share through the same `useInterfaceChat` →
 * `useExecutionStream` → `processSSEStream` path as a workspace surface, and
 * that decoder switches on a typed `event.type`. A route that streams the
 * deployed chat's `{ blockId, chunk }` / `{ event: 'final' }` dialect instead
 * parses fine and dispatches nothing: every frame falls through the decoder's
 * `default` branch, the turn never settles, and the user is told "Response
 * stopped by user" while the run log shows a successful execution.
 *
 * Nothing about that failure is visible to a test that mocks the stream, so
 * this one runs the real stream through the real client decoder.
 */
import { executionPreprocessingMock, executionPreprocessingMockFns } from '@sim/testing'
import { NextRequest, NextResponse } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ExecuteWorkflowOptions } from '@/lib/workflows/executor/execute-workflow'
import type { ExecutionStreamCallbacks } from '@/hooks/use-execution-stream'

const {
  mockEnforcePerIp,
  mockEnforcePerShare,
  mockResolvePublicInterfaceModule,
  mockTryAdmit,
  mockAdmissionRejectedResponse,
  mockReleaseExecutionSlot,
  mockExecuteWorkflow,
  mockCleanupExecutionBase64Cache,
} = vi.hoisted(() => ({
  mockEnforcePerIp: vi.fn(),
  mockEnforcePerShare: vi.fn(),
  mockResolvePublicInterfaceModule: vi.fn(),
  mockTryAdmit: vi.fn(),
  mockAdmissionRejectedResponse: vi.fn(),
  mockReleaseExecutionSlot: vi.fn(),
  mockExecuteWorkflow: vi.fn(),
  mockCleanupExecutionBase64Cache: vi.fn(),
}))

vi.mock('@/lib/public-shares/rate-limit', () => ({
  enforcePerIpRateLimit: mockEnforcePerIp,
  enforcePerShareRateLimit: mockEnforcePerShare,
}))

vi.mock('@/lib/public-shares/interface-access', () => ({
  resolvePublicInterfaceModule: mockResolvePublicInterfaceModule,
}))

vi.mock('@/lib/core/admission/gate', () => ({
  tryAdmit: mockTryAdmit,
  admissionRejectedResponse: mockAdmissionRejectedResponse,
}))

vi.mock('@/lib/billing/calculations/usage-reservation', () => ({
  releaseExecutionSlot: mockReleaseExecutionSlot,
}))

vi.mock('@/lib/workflows/executor/execute-workflow', () => ({
  executeWorkflow: mockExecuteWorkflow,
}))

vi.mock('@/lib/execution/payloads/serializer', () => ({
  compactExecutionPayload: vi.fn(async (value: unknown) => value),
}))

vi.mock('@/lib/uploads/utils/user-file-base64.server', () => ({
  cleanupExecutionBase64Cache: mockCleanupExecutionBase64Cache,
}))

vi.mock('@/lib/logs/execution/logging-session', () => ({
  LoggingSession: class {
    safeStart = vi.fn()
    safeComplete = vi.fn()
    safeCompleteWithError = vi.fn()
    markAsFailed = vi.fn()
  },
}))

vi.mock('@/lib/execution/preprocessing', () => executionPreprocessingMock)

import { POST } from '@/app/api/interfaces/public/[token]/modules/[moduleId]/chat/route'
import { processSSEStream } from '@/hooks/use-execution-stream'

const TOKEN = 'tok_1'
const MODULE_ID = 'mod-chat'
const WS = 'ws-a'
const WORKFLOW_ID = 'wf-stored'
const ANSWER_BLOCK = 'block-stored'
const HIDDEN_BLOCK = 'block-internal'

/**
 * Per-test overrides. The published path and the answering block's output are
 * the two things the redaction is a function of, so both are steerable rather
 * than fixed — a test that cannot vary them can only ever assert the default.
 */
const overrides: { publishedPath: string; answerOutput: unknown } = {
  publishedPath: 'content',
  answerOutput: undefined,
}

const chatModule = {
  id: MODULE_ID,
  type: 'chat' as const,
  placement: { row: 0, col: 0, rowSpan: 1, colSpan: 1 },
  get config() {
    return {
      workflowId: WORKFLOW_ID,
      outputConfigs: [{ blockId: ANSWER_BLOCK, path: overrides.publishedPath }],
      showThinking: true,
      welcomeMessage: 'Hi',
    }
  },
}

const access = {
  share: { id: 'sh_1', token: TOKEN, authType: 'public', password: null },
  definition: {
    id: 'int-a',
    workspaceId: WS,
    name: 'Support desk',
    description: null,
    layout: { version: 1, grid: { rows: 2, cols: 2 }, modules: [chatModule] },
    createdBy: 'owner-1',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    archivedAt: null,
  },
  workspaceId: WS,
  module: chatModule,
  resource: { type: 'workflow' as const, id: WORKFLOW_ID },
}

function textStream(chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder()
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk))
      controller.close()
    },
  })
}

function blockCompletion(output: unknown, executionOrder: number) {
  return {
    input: { prompt: 'internal prompt' },
    output,
    executionTime: 5,
    startedAt: '2026-01-01T00:00:00.000Z',
    endedAt: '2026-01-01T00:00:00.005Z',
    executionOrder,
  }
}

/**
 * The answering block's real output shape. An agent block returns far more than
 * the text: `toolCalls.list` holds the literal arguments sent to every tool and
 * the literal response that came back. The module publishes only `content`, so
 * this fixture is what makes the narrowing assertions mean something — with a
 * bare `{ content }` they would pass no matter what the route forwarded.
 */
const ANSWER_BLOCK_OUTPUT = {
  content: 'Hello',
  model: 'gpt-4',
  toolCalls: {
    list: [
      {
        name: 'lookup',
        arguments: { apiKey: 'sk-live-must-not-leak' },
        result: { rows: ['confidential-row'] },
      },
    ],
    count: 1,
  },
}

/**
 * Stands in for a real run: one hidden block, then the answering block, which
 * streams its text before completing.
 */
async function runWorkflow(options: ExecuteWorkflowOptions) {
  await options.onBlockStart?.(HIDDEN_BLOCK, 'Fetch records', 'api', 1)
  await options.onBlockComplete?.(HIDDEN_BLOCK, blockCompletion({ records: ['secret-record'] }, 1))
  await options.onBlockStart?.(ANSWER_BLOCK, 'Agent', 'agent', 2)
  await options.onStream?.({
    execution: { blockId: ANSWER_BLOCK },
    stream: textStream(['Hel', 'lo']),
  } as never)
  await options.onBlockComplete?.(
    ANSWER_BLOCK,
    blockCompletion(overrides.answerOutput ?? ANSWER_BLOCK_OUTPUT, 2)
  )
  return {
    success: true,
    output: { content: 'Hello' },
    logs: [],
    metadata: {
      duration: 39,
      startTime: '2026-01-01T00:00:00.000Z',
      endTime: '2026-01-01T00:00:00.039Z',
    },
  }
}

async function postChat() {
  const request = new NextRequest(
    `http://localhost/api/interfaces/public/${TOKEN}/modules/${MODULE_ID}/chat`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ input: { input: 'hello' } }),
    }
  )
  return POST(request, { params: Promise.resolve({ token: TOKEN, moduleId: MODULE_ID }) })
}

/** Runs the route's own bytes through the client's decoder. */
async function decodeChat(
  options: { publishedPath?: string; answerOutput?: unknown } = {}
): Promise<{
  calls: Array<{ handler: keyof ExecutionStreamCallbacks; data: any }>
  frames: any[]
}> {
  overrides.publishedPath = options.publishedPath ?? 'content'
  overrides.answerOutput = options.answerOutput
  const response = await postChat()
  expect(response.status).toBe(200)
  const [forDecoder, forFrames] = response.body!.tee()

  const calls: Array<{ handler: keyof ExecutionStreamCallbacks; data: any }> = []
  const record =
    (handler: keyof ExecutionStreamCallbacks) =>
    (data: unknown): void => {
      calls.push({ handler, data })
    }

  await processSSEStream(
    forDecoder.getReader(),
    {
      onExecutionStarted: record('onExecutionStarted'),
      onExecutionCompleted: record('onExecutionCompleted'),
      onExecutionPaused: record('onExecutionPaused'),
      onExecutionError: record('onExecutionError'),
      onExecutionCancelled: record('onExecutionCancelled'),
      onBlockStarted: record('onBlockStarted'),
      onBlockCompleted: record('onBlockCompleted'),
      onBlockError: record('onBlockError'),
      onStreamChunk: record('onStreamChunk'),
      onStreamDone: record('onStreamDone'),
    },
    'Dialect'
  )

  const raw = await new Response(forFrames).text()
  const frames = raw
    .split('\n')
    .filter((line) => line.startsWith('data:'))
    .map((line) => JSON.parse(line.slice(5).trim()))

  return { calls, frames }
}

describe('public interface chat stream dialect', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockEnforcePerIp.mockResolvedValue(null)
    mockEnforcePerShare.mockResolvedValue(null)
    mockTryAdmit.mockReturnValue({ release: vi.fn() })
    mockAdmissionRejectedResponse.mockReturnValue(
      NextResponse.json({ error: 'Too many requests' }, { status: 429 })
    )
    mockResolvePublicInterfaceModule.mockResolvedValue({ ok: true, access })
    executionPreprocessingMockFns.mockPreprocessExecution.mockResolvedValue({
      success: true,
      actorUserId: 'system-actor',
      billingAttribution: { actorUserId: 'system-actor', workspaceId: WS },
      workflowRecord: {
        id: WORKFLOW_ID,
        userId: 'owner-1',
        workspaceId: WS,
        isDeployed: true,
        variables: {},
      },
    })
    mockExecuteWorkflow.mockImplementation(
      async (
        _workflow: unknown,
        _requestId: string,
        _input: unknown,
        _actorUserId: string,
        options: ExecuteWorkflowOptions
      ) => runWorkflow(options)
    )
  })

  /**
   * The exact failure that shipped: legacy frames parse as JSON, so the stream
   * completes cleanly while dispatching nothing.
   */
  it('emits only frames the client decoder dispatches', async () => {
    const { calls, frames } = await decodeChat()

    expect(frames.length).toBeGreaterThan(0)
    for (const frame of frames) {
      expect(typeof frame.type).toBe('string')
    }
    expect(calls.length).toBe(frames.length)
  })

  it('delivers the streamed answer as stream:chunk frames', async () => {
    const { calls } = await decodeChat()
    const chunks = calls
      .filter((call) => call.handler === 'onStreamChunk')
      .map((call) => call.data.chunk)
    expect(chunks.join('')).toBe('Hello')
  })

  /**
   * Without a terminal event the turn never settles and `useInterfaceChat`
   * closes it with the stopped-by-user note.
   */
  it('settles the turn with a terminal execution event', async () => {
    const { calls } = await decodeChat()
    const completed = calls.find((call) => call.handler === 'onExecutionCompleted')
    expect(completed?.data.success).toBe(true)
  })

  /**
   * Progress is published; composition is not. A withheld block reports that it
   * ran under a positional label, so the thinking steps still resolve without
   * naming the workflow's internal blocks.
   */
  it('reports every block that ran under a positional label when it is withheld', async () => {
    const { calls, frames } = await decodeChat()
    const started = calls.filter((call) => call.handler === 'onBlockStarted')
    const completed = calls.filter((call) => call.handler === 'onBlockCompleted')
    expect(started.map((call) => call.data.blockName)).toEqual(['Step 1', 'Agent'])
    expect(started.map((call) => call.data.blockType)).toEqual(['', 'agent'])
    expect(completed.map((call) => call.data.executionOrder)).toEqual([1, 2])
    expect(JSON.stringify(frames)).not.toContain('Fetch records')
  })

  it('gives the client the selected block output it renders', async () => {
    const { calls } = await decodeChat()
    const answer = calls.find(
      (call) => call.handler === 'onBlockCompleted' && call.data.blockId === ANSWER_BLOCK
    )
    expect(answer?.data.output).toEqual({ content: 'Hello' })
  })

  /**
   * Publishing a block is not publishing all of it. An agent block's output
   * carries `toolCalls.list`, whose entries hold the literal arguments sent to
   * every tool and the literal response that came back — retrieved rows, CRM
   * records, internal ids. The module published `content`; `content` is what
   * leaves.
   */
  it('narrows a published block to the paths the module named', async () => {
    const { frames } = await decodeChat()
    const wire = JSON.stringify(frames)

    expect(wire).not.toContain('sk-live-must-not-leak')
    expect(wire).not.toContain('confidential-row')
    expect(wire).not.toContain('toolCalls')
    expect(wire).not.toContain('gpt-4')
  })

  /**
   * An empty `path` is the documented default: the schema permits it, the Sim
   * agent stores it whenever it names a block without one, and
   * `serializeOutputId` reads it as `content`. It must not be taken literally —
   * `traverseObjectPath(output, '')` returns the WHOLE object, so forwarding it
   * would hand the viewer everything path-level authorisation exists to
   * withhold, wrapped under an empty key.
   */
  it('reads an empty published path as content, not as the whole output', async () => {
    const { calls, frames } = await decodeChat({ publishedPath: '' })
    const answer = calls.find(
      (call) => call.handler === 'onBlockCompleted' && call.data.blockId === ANSWER_BLOCK
    )

    expect(answer?.data.output).toEqual({ content: 'Hello' })
    const wire = JSON.stringify(frames)
    expect(wire).not.toContain('sk-live-must-not-leak')
    expect(wire).not.toContain('confidential-row')
  })

  /**
   * `error` is never a publishable path, so picking alone strips it — and the
   * event builder decides `block:error` from exactly that field. A published
   * block that failed must not report success with an empty output; that is the
   * silent-success the withheld branch already refuses.
   */
  it('still reports a published block that failed as a failure', async () => {
    const { calls } = await decodeChat({
      answerOutput: { error: 'upstream 500: token=sk-live-must-not-leak' },
    })
    const errored = calls.find((call) => call.handler === 'onBlockError')
    const completed = calls.find(
      (call) => call.handler === 'onBlockCompleted' && call.data.blockId === ANSWER_BLOCK
    )

    expect(errored ?? completed).toBeDefined()
    const reported = JSON.stringify(errored?.data ?? completed?.data)
    expect(reported).toContain('This step failed.')
    expect(reported).not.toContain('sk-live-must-not-leak')
  })

  /**
   * An anonymous viewer sees what the module publishes, not the workflow's
   * intermediate blocks — nor the inputs any block was called with.
   */
  it('withholds unselected block outputs and every block input', async () => {
    const { calls, frames } = await decodeChat()
    const hidden = calls.find(
      (call) => call.handler === 'onBlockCompleted' && call.data.blockId === HIDDEN_BLOCK
    )
    expect(hidden?.data.output).toEqual({})
    expect(JSON.stringify(frames)).not.toContain('secret-record')
    expect(JSON.stringify(frames)).not.toContain('internal prompt')
  })

  /**
   * A block error string routinely embeds the upstream response body, URL, or
   * echoed credential that caused it. The failure is reported; the message is
   * not.
   */
  it('withholds the failure message of an unselected block', async () => {
    const secretError =
      'Request to https://api.internal/v1/customers failed: 401 {"key":"sk_live_XXX"}'
    mockExecuteWorkflow.mockImplementation(
      async (
        _workflow: unknown,
        _requestId: string,
        _input: unknown,
        _actorUserId: string,
        options: ExecuteWorkflowOptions
      ) => {
        await options.onBlockStart?.(HIDDEN_BLOCK, 'Fetch Stripe customers', 'api', 1)
        await options.onBlockComplete?.(HIDDEN_BLOCK, blockCompletion({ error: secretError }, 1))
        await options.onBlockStart?.(ANSWER_BLOCK, 'Agent', 'agent', 2)
        await options.onBlockComplete?.(ANSWER_BLOCK, blockCompletion({ content: 'Hello' }, 2))
        return {
          success: true,
          output: { content: 'Hello' },
          logs: [],
          metadata: { duration: 1, startTime: 'a', endTime: 'b' },
        }
      }
    )

    const { calls, frames } = await decodeChat()
    const failed = calls.find((call) => call.handler === 'onBlockError')
    expect(failed?.data.blockId).toBe(HIDDEN_BLOCK)
    expect(failed?.data.error).toBe('This step failed.')
    expect(JSON.stringify(frames)).not.toContain('sk_live_XXX')
    expect(JSON.stringify(frames)).not.toContain('api.internal')
  })

  /**
   * Chunk frames are the live answer, so they follow the same selection: text
   * streamed by a block the module never published does not reach the viewer.
   */
  it('withholds the streamed text of an unselected block', async () => {
    mockExecuteWorkflow.mockImplementation(
      async (
        _workflow: unknown,
        _requestId: string,
        _input: unknown,
        _actorUserId: string,
        options: ExecuteWorkflowOptions
      ) => {
        await options.onBlockStart?.(HIDDEN_BLOCK, 'Draft notes', 'agent', 1)
        await options.onStream?.({
          execution: { blockId: HIDDEN_BLOCK },
          stream: textStream(['internal ', 'reasoning']),
        } as never)
        await options.onBlockComplete?.(
          HIDDEN_BLOCK,
          blockCompletion({ content: 'internal reasoning' }, 1)
        )
        await options.onBlockStart?.(ANSWER_BLOCK, 'Agent', 'agent', 2)
        await options.onStream?.({
          execution: { blockId: ANSWER_BLOCK },
          stream: textStream(['Hel', 'lo']),
        } as never)
        await options.onBlockComplete?.(ANSWER_BLOCK, blockCompletion({ content: 'Hello' }, 2))
        return {
          success: true,
          output: { content: 'Hello' },
          logs: [],
          metadata: { duration: 1, startTime: 'a', endTime: 'b' },
        }
      }
    )

    const { calls, frames } = await decodeChat()
    const chunks = calls
      .filter((call) => call.handler === 'onStreamChunk')
      .map((call) => call.data.chunk)
    expect(chunks.join('')).toBe('Hello')
    expect(JSON.stringify(frames)).not.toContain('internal reasoning')
  })
})
