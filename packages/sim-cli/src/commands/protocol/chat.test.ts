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
const CONVERSATION_ID = '3f2a1c4e-0000-4000-8000-000000000000'

const FINAL = {
  type: 'final',
  data: { content: 'Hello there', conversationId: 'conv-1', model: 'sim' },
}

describe('sim chat', () => {
  it('sends the message and streams the reply, then names the conversation on stderr', async () => {
    requestRaw.mockResolvedValue(
      ndjson([
        { type: 'heartbeat', timestamp: '2026-08-21T00:00:00.000Z' },
        { type: 'chunk', content: 'Hello ' },
        { type: 'chunk', content: 'there' },
        FINAL,
      ])
    )

    await run('What workflows do I have?')

    expect(requestRaw).toHaveBeenCalledWith('/api/v2/chat', {
      method: 'POST',
      body: { workspaceId: 'ws_local', message: 'What workflows do I have?' },
      headers: { accept: 'application/x-ndjson' },
    })
    expect(written(stdout)).toBe('Hello there\n')
    expect(written(stderr)).toContain('conversation: conv-1')
  })

  /**
   * The route's own refusals name `message` and `conversationId`, and this
   * command builds its request by hand so nothing retypes them into what the
   * caller typed. A blank `-c` was worse than misnamed: it is falsy, so it was
   * dropped from the body and silently started a NEW conversation.
   */
  it('refuses a blank message and a blank -c before the request', async () => {
    await expect(run('   ')).rejects.toThrow('<message> cannot be empty')
    await expect(run('-c', '', 'hello')).rejects.toThrow('-c/--conversation cannot be empty')
    await expect(run('-c', '   ', 'hello')).rejects.toThrow('-c/--conversation cannot be empty')
    expect(requestRaw).not.toHaveBeenCalled()
  })

  /**
   * A conversation id as the command prints it. The shape is the route's rule
   * to enforce — the CLI refuses only a blank `-c`, which is falsy and would
   * otherwise be dropped from the body and start a new conversation.
   */
  it('passes -c through as the conversation to continue', async () => {
    requestRaw.mockResolvedValue(ndjson([FINAL]))

    await run('-c', CONVERSATION_ID, 'And which run on a schedule?')

    expect(requestRaw).toHaveBeenCalledWith('/api/v2/chat', {
      method: 'POST',
      body: {
        workspaceId: 'ws_local',
        message: 'And which run on a schedule?',
        conversationId: CONVERSATION_ID,
      },
      headers: { accept: 'application/x-ndjson' },
    })
  })

  it('prints the full content when the stream carried no chunks', async () => {
    requestRaw.mockResolvedValue(ndjson([FINAL]))

    await run('hello')

    expect(written(stdout)).toBe('Hello there\n')
  })

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

  it('prints one finished document for --output json, without streaming', async () => {
    output.format = 'json'
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    requestRaw.mockResolvedValue(ndjson([{ type: 'chunk', content: 'Hello ' }, FINAL]))

    await run('hello')

    expect(written(stdout)).toBe('')
    const printed = JSON.parse(log.mock.calls.map((call) => String(call[0])).join('\n'))
    expect(printed).toMatchObject({ content: 'Hello there', conversationId: 'conv-1' })
  })

  it('surfaces a server error event as a clean failure', async () => {
    requestRaw.mockResolvedValue(
      ndjson([{ type: 'heartbeat' }, { type: 'error', error: 'Chat request failed' }])
    )

    await expect(run('hello')).rejects.toThrow('Chat request failed')
  })

  it('reports a stream that ends without a final result', async () => {
    requestRaw.mockResolvedValue(ndjson([{ type: 'chunk', content: 'partial' }]))

    await expect(run('hello')).rejects.toThrow('Chat stream ended without a final result')
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

  it('ends the streamed line before an error is reported after it', async () => {
    requestRaw.mockResolvedValue(
      ndjson([
        { type: 'chunk', content: 'partial' },
        { type: 'error', error: 'auth expired' },
      ])
    )

    await expect(run('hello')).rejects.toThrow('auth expired')
    expect(written(stdout)).toBe('partial\n')
  })

  it('rejects an extra positional argument rather than dropping it', async () => {
    await expect(run('hello', 'dropped')).rejects.toThrow(/too many arguments/i)
    expect(requestRaw).not.toHaveBeenCalled()
  })
})
