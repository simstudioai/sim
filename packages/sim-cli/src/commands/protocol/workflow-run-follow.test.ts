import { Command } from 'commander'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SimApiError } from '../../http/client'
import { buildGeneratedCommands } from '../../runtime/build'
import { attachWorkflowRunFollow, renderRunStream } from './workflow-run-follow'

const { output, request, requestRaw } = vi.hoisted(() => ({
  output: { format: 'json' },
  request: vi.fn(),
  requestRaw: vi.fn(),
}))

vi.mock('../../context', () => ({
  clientFrom: () => ({
    client: { request, requestRaw, requireWorkspace: () => 'ws_local' },
    profile: {
      workspaceId: 'ws_local',
      output: output.format,
      name: 'default',
      apiKey: 'k',
      endpoint: 'https://sim.example',
    },
  }),
}))

/** Collects commentary the way `process.stderr` would receive it. */
function writer() {
  const written: string[] = []
  return {
    write: (text: string) => {
      written.push(text)
      return true
    },
    get text() {
      return written.join('')
    },
  }
}

function bodyOf(chunks: string[]): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(new TextEncoder().encode(chunk))
      controller.close()
    },
  })
}

function sse(...frames: unknown[]): ReadableStream<Uint8Array> {
  return bodyOf(frames.map((frame) => `data: ${JSON.stringify(frame)}\n\n`))
}

function streamResponse(body: ReadableStream<Uint8Array>): Response {
  return {
    body,
    status: 200,
    headers: new Headers({ 'content-type': 'text/event-stream' }),
  } as unknown as Response
}

function jsonResponse(data: Record<string, unknown>): Response {
  return new Response(JSON.stringify({ data }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  })
}

function ndjsonResponse(...events: Array<Record<string, unknown>>): Response {
  return new Response(bodyOf(events.map((event) => `${JSON.stringify(event)}\n`)), {
    status: 200,
    headers: { 'content-type': 'application/x-ndjson; charset=utf-8' },
  })
}

function options(overrides: Partial<Parameters<typeof renderRunStream>[1]> = {}) {
  return { includeThinking: false, includeToolCalls: false, stderr: writer(), ...overrides }
}

beforeEach(() => {
  output.format = 'json'
  request.mockReset()
  requestRaw.mockReset()
  requestRaw.mockImplementation(async () =>
    jsonResponse({
      runId: 'run-1',
      workflowId: WORKFLOW_ID,
      status: 'completed',
      output: {},
      error: null,
    })
  )
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

describe('renderRunStream', () => {
  it('reassembles a frame split across chunk boundaries', async () => {
    const final = await renderRunStream(
      bodyOf(['data: {"event":"fin', 'al","data":{"success":true}}\n\n', 'data: "[DONE]"\n\n']),
      options()
    )

    expect(final).toEqual({ success: true })
  })

  it('reports a retraction so streamed text is never silently wrong', async () => {
    const stderr = writer()
    await renderRunStream(
      sse(
        { blockId: 'agent-1', chunk: 'draft answer' },
        { event: 'chunk_reset', blockId: 'agent-1' },
        { event: 'final', data: { success: true } }
      ),
      options({ stderr })
    )

    expect(stderr.text).toContain('retracted')
  })

  it('fails with the server message on a terminal error frame', async () => {
    await expect(
      renderRunStream(sse({ event: 'error', error: 'Agent block timed out' }), options())
    ).rejects.toThrow(/Agent block timed out/)
  })

  it('fails rather than reporting an empty success when the stream is truncated', async () => {
    await expect(
      renderRunStream(sse({ blockId: 'agent-1', chunk: 'partial' }), options())
    ).rejects.toThrow(/ended before the workflow reported a result/)
  })

  it('strips terminal control sequences out of server-supplied answer text', async () => {
    const stderr = writer()
    await renderRunStream(
      sse(
        { blockId: 'agent-1', chunk: '\u001b[2Joops' },
        { event: 'final', data: { success: true } }
      ),
      options({ stderr })
    )

    expect(stderr.text).not.toContain('\u001b[2J')
    expect(stderr.text).toContain('oops')
  })
})

function program(): Command {
  const root = new Command()
  root.exitOverride()
  for (const command of buildGeneratedCommands()) root.addCommand(command)

  const workflows = root.commands.find((command) => command.name() === 'workflows')
  if (!workflows) throw new Error('workflows group missing')
  attachWorkflowRunFollow(workflows)
  return root
}

/**
 * A workflow id is a bare UUID. `wf_` is the workspace-file prefix, so it never
 * names a workflow — spelling one that way here would model the wrong scheme.
 */
const WORKFLOW_ID = '00000000-0000-4000-8000-00000000000a'

async function run(...argv: string[]): Promise<void> {
  await program().parseAsync(['node', 'sim', 'workflows', 'run', ...argv])
}

describe('sim workflows run --follow', () => {
  it('forwards stop-after and explicit deployed entry without turning the run into a draft run', async () => {
    requestRaw.mockResolvedValue(streamResponse(sse({ event: 'final', data: { success: true } })))
    vi.spyOn(console, 'log').mockImplementation(() => {})
    vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
    await run(
      WORKFLOW_ID,
      '--follow',
      '--stop-after',
      'format-1',
      '--run',
      JSON.stringify({ source: 'deployment', entry: { type: 'trigger', blockId: 'schedule-1' } })
    )
    expect(requestRaw.mock.calls[0][1].body).toEqual({
      stream: true,
      stopAfterBlockId: 'format-1',
      run: { source: 'deployment', entry: { type: 'trigger', blockId: 'schedule-1' } },
    })
  })

  it('refuses asynchronous stop-after before sending an execution request', async () => {
    await expect(run(WORKFLOW_ID, '--async', '--stop-after', 'format-1')).rejects.toThrow(
      '--stop-after applies to synchronous runs'
    )
    expect(requestRaw).not.toHaveBeenCalled()
    expect(request).not.toHaveBeenCalled()
  })

  it('announces a pollable manual run ID before sending the request', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {})
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
    requestRaw.mockImplementation(async (_path, init) => {
      const runId = init.headers['x-run-id']
      expect(runId).toMatch(/^[0-9a-f-]{36}$/)
      expect(stderr.mock.calls.map(([line]) => String(line)).join('')).toContain(
        `sim workflows runs get ${runId} --workflow ${WORKFLOW_ID}`
      )
      return jsonResponse({ runId, status: 'completed' })
    })
    await run(WORKFLOW_ID, '--manual')
    expect(requestRaw).toHaveBeenCalledTimes(1)
  })

  it('preserves an explicit run ID when following a partial retry', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {})
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
    requestRaw.mockResolvedValue(streamResponse(sse({ event: 'final', data: { success: true } })))
    await run(
      WORKFLOW_ID,
      '--from-block',
      'agent-1',
      '--source-run',
      'source-1',
      '--run-id',
      'retry-1',
      '--follow'
    )
    expect(requestRaw.mock.calls[0][1].headers['x-run-id']).toBe('retry-1')
    expect(stderr.mock.calls.map(([line]) => String(line)).join('')).toContain('Run ID: retry-1')
  })

  it('announces the canonical ID for a low-level JSON manual selection', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {})
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
    requestRaw.mockResolvedValue(jsonResponse({ status: 'completed' }))
    await run(WORKFLOW_ID, '--run', '{"source":"manual"}')
    const runId = requestRaw.mock.calls[0][1].headers['x-run-id']
    expect(runId).toMatch(/^[0-9a-f-]{36}$/)
    expect(stderr.mock.calls.map(([line]) => String(line)).join('')).toContain(`Run ID: ${runId}`)
  })

  it('translates API field names in synchronous run errors', async () => {
    requestRaw.mockRejectedValue(
      new SimApiError('executionTimeoutSeconds must be less than or equal to 3000', 400)
    )

    await expect(run(WORKFLOW_ID)).rejects.toThrow(
      '--execution-timeout-seconds must be less than or equal to 3000'
    )
  })

  it('lets --trigger and --mock-payload imply --manual', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {})

    await run(WORKFLOW_ID, '--trigger', 'slack-trigger')
    await run(WORKFLOW_ID, '--mock-payload')

    expect(request).not.toHaveBeenCalled()
    expect(requestRaw).toHaveBeenCalledTimes(2)
    expect(requestRaw.mock.calls[0][1].body).toEqual({
      run: { source: 'manual', entry: { type: 'trigger', blockId: 'slack-trigger' } },
    })
    expect(requestRaw.mock.calls[1][1].body).toEqual({
      run: { source: 'manual', entry: { type: 'trigger', useMockPayload: true } },
    })
  })

  it('lets --from-block imply manual and requires an exact source run', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {})

    await run(WORKFLOW_ID, '--from-block', 'agent-1', '--source-run', 'run-1')

    expect(requestRaw.mock.calls[0][1].body).toEqual({
      run: {
        source: 'manual',
        entry: { type: 'block', blockId: 'agent-1', sourceRunId: 'run-1' },
      },
    })
  })

  it('prints then fails for a failed NDJSON run just like the JSON path', async () => {
    requestRaw.mockResolvedValue(
      ndjsonResponse({
        type: 'final',
        data: {
          runId: 'run-1',
          workflowId: WORKFLOW_ID,
          status: 'failed',
          output: { partial: true },
          error: { message: 'Agent failed', code: 'BLOCK_EXECUTION_FAILED' },
        },
      })
    )
    const stdout = vi.spyOn(console, 'log').mockImplementation(() => {})

    await expect(run(WORKFLOW_ID)).rejects.toThrow('Agent failed')
    expect(stdout).toHaveBeenCalled()
  })

  it('explains a deployment that answers JSON instead of an event stream', async () => {
    const cancel = vi.fn().mockResolvedValue(undefined)
    requestRaw.mockResolvedValue({
      body: { cancel },
      status: 200,
      headers: new Headers({ 'content-type': 'application/json' }),
    } as unknown as Response)

    await expect(run(WORKFLOW_ID, '--follow')).rejects.toThrow(/instead of an event stream/)
    expect(cancel).toHaveBeenCalled()
  })
})
