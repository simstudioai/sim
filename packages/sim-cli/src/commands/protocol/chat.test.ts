import { Command } from 'commander'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { buildGeneratedCommands } from '../../runtime/build'
import { attachProtocolCommands } from './index'

const { output, requestRaw } = vi.hoisted(() => ({
  output: { format: 'table' },
  requestRaw: vi.fn(),
}))

vi.mock('../../context', () => ({
  clientFrom: () => ({
    client: { requestRaw, requireWorkspace: () => 'ws_local' },
    profile: {
      workspaceId: 'ws_local',
      output: output.format,
      name: 'default',
      apiKey: 'k',
      endpoint: 'https://sim.example',
    },
  }),
}))

interface WriteSpy {
  mock: { calls: unknown[][] }
}

let stdout: WriteSpy
let stderr: WriteSpy

beforeEach(() => {
  output.format = 'table'
  requestRaw.mockReset()
  stdout = vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
  stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
})

afterEach(() => {
  vi.restoreAllMocks()
})

function ndjson(events: Array<Record<string, unknown>>): Response {
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const event of events) {
        controller.enqueue(new TextEncoder().encode(`${JSON.stringify(event)}\n`))
      }
      controller.close()
    },
  })
  return new Response(body, {
    status: 200,
    headers: { 'content-type': 'application/x-ndjson; charset=utf-8' },
  })
}

/** An NDJSON body that stays open after the last event, as a proxy may hold it. */
function openNdjson(events: Array<Record<string, unknown>>): Response {
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const event of events) {
        controller.enqueue(new TextEncoder().encode(`${JSON.stringify(event)}\n`))
      }
    },
  })
  return new Response(body, {
    status: 200,
    headers: { 'content-type': 'application/x-ndjson; charset=utf-8' },
  })
}

/**
 * Makes the next stdout write fail the way Node does — asynchronously, as an
 * `error` event on the stream rather than a throw from `write` itself.
 */
function failWrites(code: string): void {
  let raised = false
  vi.mocked(process.stdout.write).mockImplementation((() => {
    if (raised) return true
    raised = true
    const error: NodeJS.ErrnoException = new Error(`write ${code}`)
    error.code = code
    process.stdout.emit('error', error)
    return false
  }) as never)
}

function program(): Command {
  const root = new Command('sim').exitOverride()
  for (const group of buildGeneratedCommands()) root.addCommand(group)
  attachProtocolCommands(root)
  return root
}

function run(...args: string[]): Promise<unknown> {
  return program().parseAsync(['chat', ...args], { from: 'user' })
}

function written(spy: WriteSpy): string {
  return spy.mock.calls.map((call) => String(call[0])).join('')
}

/** A conversation id in the shape the route accepts and the command prints. */
const _CONVERSATION_ID = '3f2a1c4e-0000-4000-8000-000000000000'

const FINAL = {
  type: 'final',
  data: { content: 'Hello there', conversationId: 'conv-1', model: 'sim' },
}

describe('sim chat', () => {
  it('prints the final suffix the chunks never carried, without repeating the prefix', async () => {
    requestRaw.mockResolvedValue(ndjson([{ type: 'chunk', content: 'Hello ' }, FINAL]))

    await run('hello')

    expect(written(stdout)).toBe('Hello there\n')
  })

  it('strips terminal control sequences from the streamed reply', async () => {
    requestRaw.mockResolvedValue(ndjson([{ type: 'chunk', content: 'safe\u001b[31m text' }, FINAL]))

    await run('hello')

    expect(written(stdout)).toContain('safe text')
    expect(written(stdout)).not.toContain('\u001b')
  })

  it('ends the turn at the final event even when the body never closes', async () => {
    requestRaw.mockResolvedValue(openNdjson([{ type: 'chunk', content: 'Hello there' }, FINAL]))

    await run('hello')

    expect(written(stdout)).toBe('Hello there\n')
    expect(written(stderr)).toContain('conversation: conv-1')
  })

  it('exits quietly when the reader of the pipe leaves early', async () => {
    const exit = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never)
    failWrites('EPIPE')
    requestRaw.mockResolvedValue(ndjson([{ type: 'chunk', content: 'Hello ' }, FINAL]))

    await run('hello')

    expect(exit).toHaveBeenCalledWith(0)
  })

  it('does not swallow a write failure that is not a broken pipe', async () => {
    failWrites('ENOSPC')
    requestRaw.mockResolvedValue(ndjson([{ type: 'chunk', content: 'Hello ' }, FINAL]))

    await expect(run('hello')).rejects.toThrow('write ENOSPC')
  })
})
