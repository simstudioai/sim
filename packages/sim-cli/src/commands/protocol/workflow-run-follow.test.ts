import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { jsonResponse } from '@sim/testing/helpers/http'
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
      data: {
        runId: 'run-1',
        workflowId: WORKFLOW_ID,
        status: 'completed',
        output: {},
        error: null,
      },
    })
  )
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

describe('sim workflows run --wait-timeout', () => {
  const receipt = {
    runId: 'run-1',
    statusUrl: `https://sim.example/api/v2/workflows/${WORKFLOW_ID}/runs/run-1`,
  }
  let logged: string[]
  let errored: string[]

  beforeEach(() => {
    process.exitCode = undefined
    logged = []
    errored = []
    vi.spyOn(console, 'log').mockImplementation((line: string) => {
      logged.push(line)
    })
    vi.spyOn(console, 'error').mockImplementation((line: string) => {
      errored.push(line)
    })
  })

  afterEach(() => {
    process.exitCode = undefined
  })

  function runRecord(status: string) {
    return {
      data: {
        runId: 'run-1',
        workflowId: WORKFLOW_ID,
        status,
        startedAt: '2026-08-17T00:00:00.000Z',
        endedAt: null,
        durationMs: null,
        cost: null,
        error: null,
        paused: null,
      },
    }
  }

  it('asks the server to wait that long and prints a run that settled in time as before', async () => {
    requestRaw.mockResolvedValue(
      ndjsonResponse(
        { type: 'heartbeat' },
        {
          type: 'final',
          data: { runId: 'run-1', workflowId: WORKFLOW_ID, status: 'completed', output: { ok: 1 } },
        }
      )
    )

    await run(WORKFLOW_ID, '--manual', '--wait-timeout', '240')

    expect(requestRaw.mock.calls[0][1].body).toEqual({
      run: { source: 'manual' },
      waitTimeoutSeconds: 240,
    })
    expect(request).not.toHaveBeenCalled()
    expect(logged.join('\n')).toContain('"ok": 1')
    expect(process.exitCode).toBeUndefined()
  })

  it('prints the run record and exits 4 when the run outlasts the wait', async () => {
    requestRaw.mockResolvedValue(
      ndjsonResponse({ type: 'heartbeat' }, { type: 'detached', data: receipt })
    )
    request.mockResolvedValue(runRecord('running'))

    await run(WORKFLOW_ID, '--stop-after', 'agent-1', '--wait-timeout', '30')

    expect(request).toHaveBeenCalledTimes(1)
    expect(request.mock.calls[0][0]).toBe(`/api/v2/workflows/${WORKFLOW_ID}/runs/run-1`)
    expect(JSON.parse(logged.join('\n'))).toMatchObject({ runId: 'run-1', status: 'running' })
    expect(errored.join('\n')).toContain(
      `sim workflows runs wait run-1 --workflow ${WORKFLOW_ID} --wait-timeout 30`
    )
    expect(process.exitCode).toBe(4)
  })

  it('reports a run that settled between detaching and the read like runs wait does', async () => {
    requestRaw.mockResolvedValue(ndjsonResponse({ type: 'detached', data: receipt }))
    request.mockResolvedValue(runRecord('failed'))

    await run(WORKFLOW_ID, '--manual', '--wait-timeout', '30')

    expect(JSON.parse(logged.join('\n'))).toMatchObject({ status: 'failed' })
    expect(process.exitCode).toBe(1)
  })

  it('treats a 202 receipt on the JSON transport as a detached run', async () => {
    requestRaw.mockResolvedValue(
      new Response(JSON.stringify({ data: receipt }), {
        status: 202,
        headers: { 'content-type': 'application/json' },
      })
    )
    request.mockResolvedValue(runRecord('running'))

    await run(WORKFLOW_ID, '--manual', '--wait-timeout', '30')

    expect(process.exitCode).toBe(4)
  })

  it('rounds a fractional wait up to whole seconds, and 0 waits until the run settles', async () => {
    await run(WORKFLOW_ID, '--manual', '--wait-timeout', '1.5')
    await run(WORKFLOW_ID, '--manual', '--wait-timeout', '0')

    expect(requestRaw.mock.calls[0][1].body.waitTimeoutSeconds).toBe(2)
    expect(requestRaw.mock.calls[1][1].body.waitTimeoutSeconds).toBe(0)
  })

  it('refuses a wait the run cannot honour before sending anything', async () => {
    await expect(run(WORKFLOW_ID, '--wait-timeout', '-1')).rejects.toThrow('--wait-timeout')
    await expect(run(WORKFLOW_ID, '--wait-timeout', '30', '--async')).rejects.toThrow(
      '--wait-timeout'
    )
    await expect(run(WORKFLOW_ID, '--wait-timeout', '30', '--follow')).rejects.toThrow(
      '--wait-timeout'
    )
    expect(requestRaw).not.toHaveBeenCalled()
  })

  it('points a manual --async at --wait-timeout', async () => {
    await expect(run(WORKFLOW_ID, '--manual', '--async')).rejects.toThrow('--wait-timeout')
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

  it('sends --stop-after with a block entry so one block re-runs against the source run', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {})

    await run(
      WORKFLOW_ID,
      '--from-block',
      'agent-1',
      '--source-run',
      'run-1',
      '--stop-after',
      'agent-1'
    )

    expect(requestRaw.mock.calls[0][1].body).toEqual({
      run: {
        source: 'manual',
        entry: { type: 'block', blockId: 'agent-1', sourceRunId: 'run-1' },
        stopAfterBlockId: 'agent-1',
      },
      selectedOutputs: ['agent-1'],
    })
  })

  it('lets --stop-after alone imply a manual run through the trigger', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {})

    await run(WORKFLOW_ID, '--stop-after', 'agent-1')
    await run(WORKFLOW_ID, '--trigger', 'start', '--stop-after', 'agent-1')

    expect(requestRaw.mock.calls[0][1].body).toEqual({
      run: { source: 'manual', stopAfterBlockId: 'agent-1' },
      selectedOutputs: ['agent-1'],
    })
    expect(requestRaw.mock.calls[1][1].body).toEqual({
      run: {
        source: 'manual',
        entry: { type: 'trigger', blockId: 'start' },
        stopAfterBlockId: 'agent-1',
      },
      selectedOutputs: ['agent-1'],
    })
  })

  it('selects the output of the block a --stop-after run stops after, by its key or id', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {})
    const blockId = '3f2b7c1e-9a4d-4e8b-8c2a-1d5e6f7a8b9c'

    await run(WORKFLOW_ID, '--stop-after', 'Log v1.2 Total')
    await run(WORKFLOW_ID, '--stop-after', blockId)

    expect(requestRaw.mock.calls[0][1].body).toMatchObject({
      run: { stopAfterBlockId: 'Log v1.2 Total' },
      selectedOutputs: ['logv12total'],
    })
    expect(requestRaw.mock.calls[1][1].body.selectedOutputs).toEqual([blockId])
  })

  it('selects the stop block of a --stop-after run it follows, so the final frame holds its output', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {})
    requestRaw.mockResolvedValue(
      streamResponse(sse({ event: 'final', data: { success: true, output: {} } }))
    )

    await run(WORKFLOW_ID, '--stop-after', 'agent-1', '--follow')

    expect(requestRaw.mock.calls[0][1].body).toMatchObject({
      run: { stopAfterBlockId: 'agent-1' },
      selectedOutputs: ['agent-1'],
      stream: true,
    })
  })

  it('keeps the outputs a --stop-after run selects itself', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {})

    await run(WORKFLOW_ID, '--stop-after', 'agent-1', '--select-output', 'start.input')

    expect(requestRaw.mock.calls[0][1].body.selectedOutputs).toEqual(['start.input'])
  })

  it('refuses an empty --stop-after rather than running the whole draft', async () => {
    await expect(run(WORKFLOW_ID, '--stop-after', '')).rejects.toThrow(
      '--stop-after requires a block id, name or key'
    )
    expect(requestRaw).not.toHaveBeenCalled()
  })

  it('refuses --stop-after with --async before sending anything', async () => {
    await expect(run(WORKFLOW_ID, '--stop-after', 'agent-1', '--async')).rejects.toThrow(
      'Manual execution does not support --async'
    )
    expect(request).not.toHaveBeenCalled()
    expect(requestRaw).not.toHaveBeenCalled()
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

  it('with --dir, names the source file and line of the block that failed, through the lock', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'sim-run-site-'))
    try {
      mkdirSync(join(dir, '.sim'), { recursive: true })
      writeFileSync(join(dir, '.sim/base.json'), JSON.stringify({ workflowId: WORKFLOW_ID }))
      writeFileSync(
        join(dir, '.sim/lock.json'),
        JSON.stringify({
          version: 1,
          blocks: {
            normalize: {
              id: 'b-fn',
              parent: null,
              ident: 'clean',
              order: 0,
              codeFile: 'functions/normalize.js',
            },
          },
          variables: {},
        })
      )
      writeFileSync(
        join(dir, 'workflow.ts'),
        "export default workflow('W', () => {\n  const start = trigger.start('Start', {})\n  const clean = fn('Normalize', { code: codeFile('./functions/normalize.js') })\n})\n"
      )
      const failed = (blockId: string) =>
        ndjsonResponse({
          type: 'final',
          data: {
            runId: 'run-1',
            workflowId: WORKFLOW_ID,
            status: 'failed',
            output: {},
            error: {
              message:
                "Type Error: Line 3: `raw.email.split('@')` - Cannot read properties of undefined",
              code: 'BLOCK_EXECUTION_FAILED',
              blockId,
            },
          },
        })
      vi.spyOn(console, 'log').mockImplementation(() => {})
      const stderr = vi.spyOn(console, 'error').mockImplementation(() => {})

      requestRaw.mockResolvedValue(failed('b-fn'))
      await expect(run(WORKFLOW_ID, '--dir', dir)).rejects.toThrow('Type Error')
      const lines = stderr.mock.calls.map((call) => call.join(' '))
      expect(lines).toContain(
        `${join(dir, 'functions/normalize.js')}:3: Type Error: Line 3: \`raw.email.split('@')\` - Cannot read properties of undefined (block normalize (clean), declared at ${join(dir, 'workflow.ts')}:3)`
      )

      stderr.mockClear()
      requestRaw.mockResolvedValue(failed('b-unbound'))
      await expect(run(WORKFLOW_ID, '--dir', dir)).rejects.toThrow('Type Error')
      expect(stderr.mock.calls.map((call) => call.join(' ')).join('\n')).toContain(
        'is not mapped to a source line'
      )
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('with --dir, maps only a block failure, reads a line only from the executor prefix, and keeps the run failure when the directory cannot be read', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'sim-run-site-'))
    try {
      mkdirSync(join(dir, '.sim'), { recursive: true })
      writeFileSync(join(dir, '.sim/base.json'), JSON.stringify({ workflowId: WORKFLOW_ID }))
      writeFileSync(
        join(dir, '.sim/lock.json'),
        JSON.stringify({
          version: 1,
          blocks: {
            normalize: {
              id: 'b-fn',
              parent: null,
              ident: 'normalize',
              order: 0,
              codeFile: 'functions/normalize.js',
            },
          },
          variables: {},
        })
      )
      const failed = (error: Record<string, unknown>) =>
        ndjsonResponse({
          type: 'final',
          data: { runId: 'run-1', workflowId: WORKFLOW_ID, status: 'failed', output: {}, error },
        })
      vi.spyOn(console, 'log').mockImplementation(() => {})
      const stderr = vi.spyOn(console, 'error').mockImplementation(() => {})
      const printed = () => stderr.mock.calls.map((call) => call.join(' ')).join('\n')

      requestRaw.mockResolvedValue(failed({ message: 'The run timed out', code: 'TIMEOUT' }))
      await expect(run(WORKFLOW_ID, '--dir', dir)).rejects.toThrow('The run timed out')
      expect(printed()).not.toContain(dir)

      stderr.mockClear()
      writeFileSync(join(dir, 'workflow.ts'), "export default workflow('W', () => {})\n")
      requestRaw.mockResolvedValue(
        failed({ message: 'Error: Line 3 of the CSV is bad', blockId: 'b-fn' })
      )
      await expect(run(WORKFLOW_ID, '--dir', dir)).rejects.toThrow('Line 3 of the CSV')
      expect(printed()).toContain(
        `${join(dir, 'functions/normalize.js')}: Error: Line 3 of the CSV is bad (block normalize)`
      )

      stderr.mockClear()
      rmSync(join(dir, 'workflow.ts'))
      symlinkSync(join(dir, '.sim/base.json'), join(dir, 'workflow.ts'))
      requestRaw.mockResolvedValue(failed({ message: 'Line 2 - boom', blockId: 'b-fn' }))
      await expect(run(WORKFLOW_ID, '--dir', dir)).rejects.toThrow('boom')
      expect(printed()).toContain('could not be read')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('refuses --dir with --follow or --async before sending anything', async () => {
    await expect(run(WORKFLOW_ID, '--dir', '.', '--follow')).rejects.toThrow(
      '--follow and --async do not report the block that failed'
    )
    await expect(run(WORKFLOW_ID, '--dir', '.', '--async')).rejects.toThrow(
      '--follow and --async do not report the block that failed'
    )
    expect(request).not.toHaveBeenCalled()
    expect(requestRaw).not.toHaveBeenCalled()
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
