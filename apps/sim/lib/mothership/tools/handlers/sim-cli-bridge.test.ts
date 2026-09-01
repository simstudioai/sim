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
}))
vi.mock('sim/embed', () => ({
  runEmbeddedCli: mockRunEmbeddedCli,
  createEmbeddedClient: vi.fn(),
}))
vi.mock('@/lib/mothership/chat/delegation', () => ({ mintDelegationToken: mockMint }))
vi.mock('@/lib/core/utils/urls', () => ({ getInternalApiBaseUrl: () => 'http://internal' }))

import { executeSimCli } from '@/lib/mothership/tools/handlers/sim-cli'

const context = { workspaceId: 'ws-1', userId: 'u-1', chatId: 'chat-1' } as Parameters<
  typeof executeSimCli
>[1]

describe('sim-cli machine file bridge', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockMint.mockResolvedValue('key')
    mockRunEmbeddedCli.mockResolvedValue({ exitCode: 0, stdout: 'BIG OUTPUT', stderr: '' })
  })

  it('pre-reads @tokens from the machine into the embed file map', async () => {
    mockRead.mockResolvedValue({ outcome: 'read', content: '{"text":"hi"}' })
    await executeSimCli({ args: ['workflows', 'run', 'wf1', '--input', '@env.json'] }, context)
    expect(mockRead).toHaveBeenCalledWith('mothership-chat:chat-1', 'env.json')
    expect(mockRunEmbeddedCli).toHaveBeenCalledWith(
      ['workflows', 'run', 'wf1', '--input', '@env.json'],
      expect.anything(),
      { fileArguments: { 'env.json': '{"text":"hi"}' } }
    )
  })

  it('leaves @@ literals and @- alone, and omits missing files from the map', async () => {
    mockRead.mockResolvedValue({ outcome: 'no-file', detail: 'nope' })
    await executeSimCli({ args: ['x', '@@literal', '@missing.json'] }, context)
    expect(mockRead).toHaveBeenCalledTimes(1)
    expect(mockRunEmbeddedCli).toHaveBeenCalledWith(
      ['x', '@@literal', '@missing.json'],
      expect.anything(),
      {
        fileArguments: {},
      }
    )
  })

  it('cold machine on read degrades via the empty map (CLI core words the refusal)', async () => {
    mockRead.mockResolvedValue({ outcome: 'no-session' })
    await executeSimCli({ args: ['x', '@env.json'] }, context)
    expect(mockRunEmbeddedCli).toHaveBeenCalledWith(['x', '@env.json'], expect.anything(), {
      fileArguments: {},
    })
  })

  it('outputFile lands stdout on the machine and returns only the ack', async () => {
    mockWrite.mockResolvedValue({ outcome: 'written', path: '/home/user/trace.json' })
    const result = await executeSimCli(
      { args: ['logs', 'get', 'r1'], outputFile: 'trace.json' },
      context
    )
    expect(mockWrite).toHaveBeenCalledWith('mothership-chat:chat-1', 'trace.json', 'BIG OUTPUT')
    const output = result.output as { stdout: string }
    expect(output.stdout).toContain('written to trace.json')
    expect(output.stdout).toContain('10 chars')
    expect(output.stdout).not.toContain('BIG OUTPUT')
  })

  it('outputFile on a cold machine returns output inline with boot guidance', async () => {
    mockWrite.mockResolvedValue({ outcome: 'no-session' })
    const result = await executeSimCli(
      { args: ['logs', 'get', 'r1'], outputFile: 'trace.json' },
      context
    )
    const output = result.output as { stdout: string }
    expect(output.stdout).toContain('BIG OUTPUT')
    expect(output.stdout).toContain('not booted')
  })

  it('outputFile is skipped on command failure so the error stays visible', async () => {
    mockRunEmbeddedCli.mockResolvedValue({ exitCode: 1, stdout: '', stderr: 'boom' })
    const result = await executeSimCli(
      { args: ['logs', 'get', 'r1'], outputFile: 'trace.json' },
      context
    )
    expect(mockWrite).not.toHaveBeenCalled()
    expect(result.success).toBe(false)
  })
})
