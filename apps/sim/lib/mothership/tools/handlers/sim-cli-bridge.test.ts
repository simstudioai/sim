/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockRead, mockWrite, mockRunEmbeddedCli, mockMint } = vi.hoisted(() => ({
  mockRead: vi.fn(),
  mockWrite: vi.fn(),
  mockRunEmbeddedCli: vi.fn(),
  mockMint: vi.fn(),
}))

vi.mock('@/lib/execution/remote-sandbox/session-files', () => ({
  readSessionSandboxFile: mockRead,
  writeSessionSandboxFile: mockWrite,
  resolveSessionPath: (path: string) => (path.startsWith('/') ? path : `/home/user/${path}`),
}))
vi.mock('sim/embed', () => ({
  runEmbeddedCli: mockRunEmbeddedCli,
  createEmbeddedClient: vi.fn(),
}))
vi.mock('@/lib/mothership/chat/delegation', () => ({ mintDelegationToken: mockMint }))
vi.mock('@/lib/core/utils/urls', () => ({
  getInternalApiBaseUrl: () => 'http://internal',
  SITE_URL: 'http://sim.test',
}))

import type { AgentCliRequest } from '@/lib/mothership/generated/agent-cli'
import { executeSimCli } from '@/lib/mothership/tools/handlers/sim-cli'

const context = { workspaceId: 'ws-1', userId: 'u-1', chatId: 'chat-1' } as Parameters<
  typeof executeSimCli
>[1]

function cli(argv: string[], extra: Partial<AgentCliRequest> = {}): { request: AgentCliRequest } {
  return { request: { invocation: { kind: 'cli', argv }, ...extra } }
}

describe('sim-cli handler executes the worker-built request', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockMint.mockResolvedValue('key')
    mockRunEmbeddedCli.mockResolvedValue({ exitCode: 0, stdout: 'BIG OUTPUT', stderr: '' })
  })

  it('refuses a frame without the typed request — this side never re-parses argv', async () => {
    const result = await executeSimCli({ args: ['workflows', 'list'] }, context)
    expect(result.success).toBe(false)
    expect(mockRunEmbeddedCli).not.toHaveBeenCalled()
  })

  it('forwards the invocation cancellation signal and refuses a stopped invocation before credentials', async () => {
    const controller = new AbortController()
    await executeSimCli(cli(['workflows', 'list']), { ...context, abortSignal: controller.signal })
    expect(mockRunEmbeddedCli.mock.calls[0]?.[1]?.signal).toBe(controller.signal)
    controller.abort()
    expect(
      (
        await executeSimCli(cli(['workflows', 'list']), {
          ...context,
          abortSignal: controller.signal,
        })
      ).success
    ).toBe(false)
    expect(mockMint).toHaveBeenCalledTimes(1)
    expect(mockRunEmbeddedCli).toHaveBeenCalledTimes(1)
  })

  it('preserves artifact observations across the tool result boundary', async () => {
    const observations = [
      { name: 'chart.png', resourceId: 'file-1', mediaType: 'image/png', data: 'AA==' },
    ]
    mockRunEmbeddedCli.mockResolvedValue({
      exitCode: 0,
      stdout: 'metadata',
      stderr: '',
      observations,
    })
    const result = await executeSimCli(cli(['files', 'get', 'file-1']), context)
    expect(result.success).toBe(true)
    expect(result.output).toEqual({ exitCode: 0, stdout: 'metadata', stderr: '', observations })
  })

  it('binds the CLI reader to the chat machine without pre-reading argv', async () => {
    mockRead.mockResolvedValue({
      outcome: 'read',
      content: Buffer.from('{"text":"hi"}').toString('base64'),
    })
    mockRunEmbeddedCli.mockImplementationOnce(async (_argv, _identity, options) => {
      expect(mockRead).not.toHaveBeenCalled()
      expect(await options.readFile('env.json')).toEqual(Buffer.from('{"text":"hi"}'))
      return { exitCode: 0, stdout: '', stderr: '' }
    })
    await executeSimCli(cli(['workflows', 'run', 'wf1', '--input', '@env.json']), context)
    expect(mockRead).toHaveBeenCalledWith('mothership-chat:chat-1', 'env.json', 'base64', undefined)
    expect(mockRunEmbeddedCli).toHaveBeenCalledWith(
      ['workflows', 'run', 'wf1', '--input', '@env.json'],
      expect.anything(),
      expect.objectContaining({ readFile: expect.any(Function) })
    )
  })

  it('returns a workbench read failure only when the CLI consumes that file', async () => {
    mockRead.mockResolvedValue({ outcome: 'no-file', detail: 'nope' })
    mockRunEmbeddedCli.mockImplementationOnce(async (_argv, _identity, options) => {
      expect(mockRead).not.toHaveBeenCalled()
      await options.readFile('missing.json')
      throw new Error('An unreadable file cannot succeed')
    })
    expect(
      await executeSimCli(cli(['workflows', 'run', 'wf1', '--input', '@missing.json']), context)
    ).toMatchObject({ success: false, error: expect.stringContaining('nope') })
    expect(mockRead).toHaveBeenCalledTimes(1)
  })

  it('sink lands stdout on the machine and returns only the ack', async () => {
    mockWrite.mockResolvedValue({ outcome: 'written', path: '/home/user/trace.json' })
    const result = await executeSimCli(
      cli(['logs', 'get', 'r1'], { sink: { kind: 'sandbox-file', path: 'trace.json' } }),
      context
    )
    expect(mockWrite).toHaveBeenCalledWith(
      'mothership-chat:chat-1',
      'trace.json',
      'BIG OUTPUT',
      undefined,
      { overwrite: true, observe: expect.any(Function) }
    )
    const output = result.output as { stdout: string }
    expect(output.stdout).toContain('written to /home/user/trace.json')
    expect(output.stdout).toContain('10 chars')
    expect(output.stdout).not.toContain('BIG OUTPUT')
  })

  it('a stdout invocation only lands the worker-sliced text — nothing is executed', async () => {
    mockWrite.mockResolvedValue({ outcome: 'written', path: '/home/user/sliced.json' })
    const result = await executeSimCli(
      {
        request: {
          invocation: { kind: 'stdout', stdout: 'SLICED' },
          sink: { kind: 'sandbox-file', path: 'sliced.json' },
        },
      },
      context
    )
    expect(mockRunEmbeddedCli).not.toHaveBeenCalled()
    expect(mockWrite).toHaveBeenCalledWith(
      'mothership-chat:chat-1',
      'sliced.json',
      'SLICED',
      undefined,
      { overwrite: true, observe: expect.any(Function) }
    )
    const output = result.output as { stdout: string }
    expect(output.stdout).toContain('written to /home/user/sliced.json')
  })

  it('a failed sink preserves mutation success without encouraging a repeated mutation', async () => {
    mockWrite.mockResolvedValue({ outcome: 'error', detail: 'provider unavailable' })
    const result = await executeSimCli(
      cli(['files', 'create', '--name', 'report'], {
        sink: { kind: 'sandbox-file', path: 'trace.json' },
      }),
      context
    )
    const output = result.output as { stdout: string }
    expect(output.stdout).toContain('BIG OUTPUT')
    expect(result.success).toBe(true)
    expect(output.stdout).toContain('Command succeeded')
    expect(output.stdout).toContain('Do not repeat a mutation')
    expect(mockRunEmbeddedCli).toHaveBeenCalledTimes(1)
  })

  it('sink is skipped on command failure so the error stays visible', async () => {
    mockRunEmbeddedCli.mockResolvedValue({ exitCode: 1, stdout: '', stderr: 'boom' })
    const result = await executeSimCli(
      cli(['logs', 'get', 'r1'], { sink: { kind: 'sandbox-file', path: 'trace.json' } }),
      context
    )
    expect(mockWrite).not.toHaveBeenCalled()
    expect(result.success).toBe(false)
  })
})
