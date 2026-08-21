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

const FINAL = {
  type: 'final',
  data: { content: 'Hello there', conversationId: 'conv-1', model: 'mothership' },
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

  it('passes -c through as the conversation to continue', async () => {
    requestRaw.mockResolvedValue(ndjson([FINAL]))

    await run('-c', 'conv-1', 'And which run on a schedule?')

    expect(requestRaw).toHaveBeenCalledWith('/api/v2/chat', {
      method: 'POST',
      body: {
        workspaceId: 'ws_local',
        message: 'And which run on a schedule?',
        conversationId: 'conv-1',
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
})
