/**
 * @vitest-environment node
 */
import { Command } from 'commander'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { sleep } from '../../helpers'
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
  requestRaw.mockResolvedValue(
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
  it('returns the final envelope and writes answer text to the commentary sink', async () => {
    const stderr = writer()
    const final = await renderRunStream(
      sse(
        { blockId: 'agent-1', chunk: 'Hello' },
        { blockId: 'agent-1', chunk: ' world' },
        { event: 'final', data: { success: true, output: { answer: 'Hello world' } } },
        '[DONE]'
      ),
      options({ stderr })
    )

    expect(final).toEqual({ success: true, output: { answer: 'Hello world' } })
    expect(stderr.text).toContain('Hello world')
  })

  it('reassembles a frame split across chunk boundaries', async () => {
    const final = await renderRunStream(
      bodyOf(['data: {"event":"fin', 'al","data":{"success":true}}\n\n', 'data: "[DONE]"\n\n']),
      options()
    )

    expect(final).toEqual({ success: true })
  })

  it('renders answer text while the run is still open, not only once it ends', async () => {
    const held: { source?: ReadableStreamDefaultController<Uint8Array> } = {}
    const body = new ReadableStream<Uint8Array>({
      start(source) {
        held.source = source
      },
    })
    const source = held.source
    if (!source) throw new Error('stream controller was not captured')

    const encode = (text: string) => new TextEncoder().encode(text)
    const stderr = writer()
    const rendered = renderRunStream(body, options({ stderr }))

    // Deliberately without the trailing blank line: a reader keyed on the
    // `\n\n` event separator would hold this frame until the next one arrived.
    source.enqueue(encode('data: {"blockId":"agent-1","chunk":"live"}\n'))
    await sleep(0)
    expect(stderr.text).toContain('live')

    source.enqueue(encode('\ndata: {"event":"final","data":{"success":true}}\n\n'))
    source.close()
    await expect(rendered).resolves.toEqual({ success: true })
  })

  it('hides thinking and tool frames unless they were asked for', async () => {
    const stderr = writer()
    await renderRunStream(
      sse(
        { event: 'thinking', blockId: 'agent-1', data: 'weighing options' },
        { event: 'tool', blockId: 'agent-1', phase: 'start', id: 't1', name: 'http_request' },
        { event: 'final', data: { success: true } }
      ),
      options({ stderr })
    )

    expect(stderr.text).not.toContain('weighing options')
    expect(stderr.text).not.toContain('http_request')
  })

  it('renders thinking and tool frames when they were asked for', async () => {
    const stderr = writer()
    await renderRunStream(
      sse(
        { event: 'thinking', blockId: 'agent-1', data: 'weighing options' },
        { event: 'tool', blockId: 'agent-1', phase: 'start', id: 't1', name: 'http_request' },
        {
          event: 'tool',
          blockId: 'agent-1',
          phase: 'end',
          id: 't1',
          name: 'http_request',
          status: 'error',
        },
        { event: 'final', data: { success: true } }
      ),
      options({ stderr, includeThinking: true, includeToolCalls: true })
    )

    expect(stderr.text).toContain('weighing options')
    expect(stderr.text).toContain('http_request')
    expect(stderr.text).toContain('(error)')
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

  it('keeps reading after a non-terminal stream_error and warns about it', async () => {
    const stderr = writer()
    const final = await renderRunStream(
      sse(
        { event: 'stream_error', blockId: 'agent-1', error: 'partial read' },
        { event: 'final', data: { success: true, output: {} } }
      ),
      options({ stderr })
    )

    expect(stderr.text).toContain('warning: partial read')
    expect(final).toEqual({ success: true, output: {} })
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

  it('stops at the terminal sentinel and ignores anything after it', async () => {
    const final = await renderRunStream(
      sse({ event: 'final', data: { success: true, output: { a: 1 } } }, '[DONE]', {
        event: 'final',
        data: { success: false },
      }),
      options()
    )

    expect(final).toEqual({ success: true, output: { a: 1 } })
  })

  it('skips a frame shape it does not understand instead of failing the run', async () => {
    const final = await renderRunStream(
      bodyOf([
        'data: not json at all\n\n',
        'data: {"event":"invented_later","blockId":"b"}\n\n',
        'data: {"event":"final","data":{"success":true}}\n\n',
      ]),
      options()
    )

    expect(final).toEqual({ success: true })
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
  it('refuses --follow together with --async', async () => {
    await expect(run(WORKFLOW_ID, '--follow', '--async')).rejects.toThrow(/pass one, not both/)
    expect(requestRaw).not.toHaveBeenCalled()
  })

  it('refuses stream-only flags without --follow', async () => {
    await expect(run(WORKFLOW_ID, '--include-thinking')).rejects.toThrow(/add --follow/)
    expect(request).not.toHaveBeenCalled()
  })

  it('refuses --select-output without --follow and sends nothing', async () => {
    await expect(run(WORKFLOW_ID, '--select-output', 'agent_1.content')).rejects.toThrow(
      /add --follow/
    )
    expect(request).not.toHaveBeenCalled()
    expect(requestRaw).not.toHaveBeenCalled()
  })

  it('points a refused --select-output at the dialect the run resource takes', async () => {
    // The caller just typed a block *name*, which is what this flag accepts and
    // what `workflows runs get` rejects, so a hint that only repeated the flag
    // would send them into a second 400.
    await expect(run(WORKFLOW_ID, '--select-output', 'agent_1.content')).rejects.toThrow(
      /workflows runs get .*--select-output <blockId>\[\.path\].*block ids, not the block names/s
    )
  })

  it('tells --async --select-output that no stream is coming, rather than to follow', async () => {
    // `--async --follow` is refused outright, so "add --follow" would be advice
    // that cannot be taken.
    const failure = await run(WORKFLOW_ID, '--async', '--select-output', 'agent_1.content').catch(
      (error: Error) => error
    )

    expect(failure?.message).toContain('--async returns as soon as the run is queued')
    expect(failure?.message).not.toContain('add --follow')
    expect(request).not.toHaveBeenCalled()
  })

  it('sends the selection with the stream once --follow is passed', async () => {
    requestRaw.mockResolvedValue(streamResponse(sse({ event: 'final', data: { success: true } })))
    vi.spyOn(console, 'log').mockImplementation(() => {})
    vi.spyOn(process.stderr, 'write').mockImplementation(() => true)

    await run(WORKFLOW_ID, '--follow', '--select-output', 'agent_1.content')

    expect(requestRaw.mock.calls[0][1].body).toEqual({
      stream: true,
      selectedOutputs: ['agent_1.content'],
    })
  })

  it('negotiates a heartbeat result stream for an ordinary sync run', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {})

    await run(WORKFLOW_ID, '--input', '{"topic":"otters"}')

    expect(request).not.toHaveBeenCalled()
    expect(requestRaw).toHaveBeenCalledTimes(1)
    expect(requestRaw.mock.calls[0][1]).toMatchObject({
      body: { input: { topic: 'otters' } },
      headers: { accept: 'application/x-ndjson' },
    })
  })

  it('translates API field names in synchronous run errors', async () => {
    requestRaw.mockRejectedValue(
      new SimApiError('executionTimeoutSeconds must be less than or equal to 3000', 400)
    )

    await expect(run(WORKFLOW_ID)).rejects.toThrow(
      '--execution-timeout-seconds must be less than or equal to 3000'
    )
  })

  it('keeps async runs on the generated JSON path', async () => {
    request.mockResolvedValue({ data: { runId: 'run-1', statusUrl: '/runs/run-1' } })
    vi.spyOn(console, 'log').mockImplementation(() => {})

    await run(WORKFLOW_ID, '--async')

    expect(request).toHaveBeenCalledTimes(1)
    expect(requestRaw).not.toHaveBeenCalled()
    expect(request.mock.calls[0][1].body).toEqual({ async: true })
  })

  it('projects manual trigger flags into one nested run selector', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {})

    await run(
      WORKFLOW_ID,
      '--manual',
      '--trigger',
      'slack-trigger',
      '--input',
      '{"event":"created"}'
    )

    expect(requestRaw.mock.calls[0][1].body).toEqual({
      input: { event: 'created' },
      run: { source: 'manual', entry: { type: 'trigger', blockId: 'slack-trigger' } },
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

  it('passes the same manual selector through the streaming path', async () => {
    requestRaw.mockResolvedValue(streamResponse(sse({ event: 'final', data: { success: true } })))
    vi.spyOn(console, 'log').mockImplementation(() => {})
    vi.spyOn(process.stderr, 'write').mockImplementation(() => true)

    await run(WORKFLOW_ID, '--manual', '--mock-payload', '--follow')

    expect(requestRaw.mock.calls[0][1].body).toEqual({
      run: { source: 'manual', entry: { type: 'trigger', useMockPayload: true } },
      stream: true,
    })
  })

  it('consumes heartbeats and prints the final NDJSON result', async () => {
    requestRaw.mockResolvedValue(
      ndjsonResponse(
        { type: 'heartbeat', timestamp: '2026-09-07T00:00:00.000Z' },
        {
          type: 'final',
          data: {
            runId: 'run-1',
            workflowId: WORKFLOW_ID,
            status: 'completed',
            output: { answer: 42 },
            error: null,
          },
        }
      )
    )
    const stdout = vi.spyOn(console, 'log').mockImplementation(() => {})

    await run(WORKFLOW_ID, '--manual')

    expect(JSON.parse(String(stdout.mock.calls[0][0]))).toMatchObject({
      runId: 'run-1',
      status: 'completed',
      output: { answer: 42 },
    })
  })

  it('accepts an older server JSON response without a content type', async () => {
    requestRaw.mockResolvedValue(
      new Response(
        JSON.stringify({
          data: {
            runId: 'run-1',
            workflowId: WORKFLOW_ID,
            status: 'completed',
            output: { answer: 42 },
            error: null,
          },
        }),
        { status: 200 }
      )
    )
    const stdout = vi.spyOn(console, 'log').mockImplementation(() => {})

    await run(WORKFLOW_ID)

    expect(JSON.parse(String(stdout.mock.calls[0][0]))).toMatchObject({
      runId: 'run-1',
      status: 'completed',
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

  it('fails fast on invalid manual flag combinations', async () => {
    await expect(run(WORKFLOW_ID, '--trigger', 'trigger-1')).rejects.toThrow(/require --manual/)
    await expect(run(WORKFLOW_ID, '--from-block', 'agent-1')).rejects.toThrow(
      /requires --source-run/
    )
    await expect(run(WORKFLOW_ID, '--source-run', 'run-1')).rejects.toThrow(/requires --from-block/)
    await expect(run(WORKFLOW_ID, '--manual', '--async')).rejects.toThrow(
      /does not support --async/
    )
    await expect(
      run(WORKFLOW_ID, '--manual', '--mock-payload', '--input', '{"event":"created"}')
    ).rejects.toThrow(/cannot be combined/)
    expect(request).not.toHaveBeenCalled()
    expect(requestRaw).not.toHaveBeenCalled()
  })

  it('asks for a stream and does not negotiate agent events by default', async () => {
    requestRaw.mockResolvedValue(streamResponse(sse({ event: 'final', data: { success: true } })))
    vi.spyOn(console, 'log').mockImplementation(() => {})
    vi.spyOn(process.stderr, 'write').mockImplementation(() => true)

    await run(WORKFLOW_ID, '--follow', '--input', '{"topic":"otters"}')

    const [path, init] = requestRaw.mock.calls[0]
    expect(path).toBe(`/api/v2/workflows/${WORKFLOW_ID}/execute`)
    expect(init.body).toEqual({ input: { topic: 'otters' }, stream: true })
    expect(init.headers.accept).toBe('text/event-stream')
    expect(init.headers['x-sim-stream-protocol']).toBeUndefined()
  })

  it('negotiates the agent-event protocol when event frames are requested', async () => {
    requestRaw.mockResolvedValue(streamResponse(sse({ event: 'final', data: { success: true } })))
    vi.spyOn(console, 'log').mockImplementation(() => {})
    vi.spyOn(process.stderr, 'write').mockImplementation(() => true)

    await run(WORKFLOW_ID, '--follow', '--include-thinking', '--include-tool-calls')

    const init = requestRaw.mock.calls[0][1]
    expect(init.body).toMatchObject({ stream: true, includeThinking: true, includeToolCalls: true })
    expect(init.headers['x-sim-stream-protocol']).toBe('agent-events-v1')
  })

  it('prints the final envelope on stdout and the chatter on stderr', async () => {
    requestRaw.mockResolvedValue(
      streamResponse(
        sse(
          { blockId: 'agent-1', chunk: 'thinking out loud' },
          { event: 'final', data: { success: true, output: { answer: 42 } } },
          '[DONE]'
        )
      )
    )
    const stdout = vi.spyOn(console, 'log').mockImplementation(() => {})
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)

    await run(WORKFLOW_ID, '--follow')

    const printed = stdout.mock.calls.map((call) => String(call[0])).join('\n')
    expect(JSON.parse(printed)).toEqual({ success: true, output: { answer: 42 } })
    expect(printed).not.toContain('thinking out loud')
    expect(stderr.mock.calls.map((call) => String(call[0])).join('')).toContain('thinking out loud')
  })

  it('still prints the envelope, then fails, when the run itself failed', async () => {
    requestRaw.mockResolvedValue(
      streamResponse(
        sse({ event: 'final', data: { success: false, error: 'Block agent_1 failed', output: {} } })
      )
    )
    const stdout = vi.spyOn(console, 'log').mockImplementation(() => {})
    vi.spyOn(process.stderr, 'write').mockImplementation(() => true)

    await expect(run(WORKFLOW_ID, '--follow')).rejects.toThrow(/Block agent_1 failed/)
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

  it('reports a mid-stream failure as an explainable error, not a crash', async () => {
    requestRaw.mockResolvedValue(
      streamResponse(sse({ event: 'error', error: 'Execution cancelled' }, '[DONE]'))
    )
    vi.spyOn(process.stderr, 'write').mockImplementation(() => true)

    await expect(run(WORKFLOW_ID, '--follow')).rejects.toBeInstanceOf(SimApiError)
  })
})
