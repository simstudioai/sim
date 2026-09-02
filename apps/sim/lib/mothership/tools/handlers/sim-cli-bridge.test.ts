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

  it('pre-reads @tokens from the machine into the embed file map', async () => {
    mockRead.mockResolvedValue({ outcome: 'read', content: '{"text":"hi"}' })
    await executeSimCli(cli(['workflows', 'run', 'wf1', '--input', '@env.json']), context)
    expect(mockRead).toHaveBeenCalledWith('mothership-chat:chat-1', 'env.json')
    expect(mockRunEmbeddedCli).toHaveBeenCalledWith(
      ['workflows', 'run', 'wf1', '--input', '@env.json'],
      expect.anything(),
      expect.objectContaining({ fileArguments: { 'env.json': '{"text":"hi"}' } })
    )
  })

  it('leaves @@ literals and @- alone, and omits missing files from the map', async () => {
    mockRead.mockResolvedValue({ outcome: 'no-file', detail: 'nope' })
    await executeSimCli(cli(['x', '@@literal', '@missing.json']), context)
    expect(mockRead).toHaveBeenCalledTimes(1)
    expect(mockRunEmbeddedCli).toHaveBeenCalledWith(
      ['x', '@@literal', '@missing.json'],
      expect.anything(),
      expect.objectContaining({ fileArguments: {} })
    )
  })

  it('sink lands stdout on the machine and returns only the ack', async () => {
    mockWrite.mockResolvedValue({ outcome: 'written', path: '/home/user/trace.json' })
    const result = await executeSimCli(
      cli(['logs', 'get', 'r1'], { sink: { kind: 'sandbox-file', path: 'trace.json' } }),
      context
    )
    expect(mockWrite).toHaveBeenCalledWith('mothership-chat:chat-1', 'trace.json', 'BIG OUTPUT')
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
    expect(mockWrite).toHaveBeenCalledWith('mothership-chat:chat-1', 'sliced.json', 'SLICED')
    const output = result.output as { stdout: string }
    expect(output.stdout).toContain('written to /home/user/sliced.json')
  })

  it('sink on a cold machine returns output inline with boot guidance', async () => {
    mockWrite.mockResolvedValue({ outcome: 'no-session' })
    const result = await executeSimCli(
      cli(['logs', 'get', 'r1'], { sink: { kind: 'sandbox-file', path: 'trace.json' } }),
      context
    )
    const output = result.output as { stdout: string }
    expect(output.stdout).toContain('BIG OUTPUT')
    expect(output.stdout).toContain('not booted')
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
