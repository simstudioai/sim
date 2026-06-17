/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { CodeLanguage } from '@/lib/execution/languages'

const { mockCreate, mockRunCode, mockCommandsRun, mockFilesWrite, mockKill } = vi.hoisted(() => ({
  mockCreate: vi.fn(),
  mockRunCode: vi.fn(),
  mockCommandsRun: vi.fn(),
  mockFilesWrite: vi.fn(),
  mockKill: vi.fn(),
}))

vi.mock('@e2b/code-interpreter', () => ({ Sandbox: { create: mockCreate } }))
vi.mock('@/lib/core/config/env', () => ({ env: { E2B_API_KEY: 'test-key' } }))

import { executeInE2B, executeShellInE2B } from '@/lib/execution/e2b'

describe('e2b sandbox inputs', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockCreate.mockResolvedValue({
      sandboxId: 'sb_1',
      files: { write: mockFilesWrite },
      commands: { run: mockCommandsRun },
      runCode: mockRunCode,
      kill: mockKill,
    })
    mockRunCode.mockResolvedValue({
      error: null,
      text: '',
      logs: { stdout: [], stderr: [] },
      results: [],
    })
    // Default: shell code run + any fetch succeed.
    mockCommandsRun.mockResolvedValue({ stdout: '', stderr: '', exitCode: 0 })
  })

  it('fetches a url entry via curl with URL/DST/DIR passed as envs (no inline write)', async () => {
    await executeInE2B({
      code: 'x',
      language: CodeLanguage.JavaScript,
      timeoutMs: 1000,
      sandboxFiles: [
        { type: 'url', path: '/home/user/tables/t.csv', url: 'https://s3.example/p?a=1&b=2' },
      ],
    })

    expect(mockCommandsRun).toHaveBeenCalledTimes(1)
    const [cmd, opts] = mockCommandsRun.mock.calls[0]
    expect(cmd).toContain('curl')
    expect(cmd).toContain('mkdir -p')
    // URL/path go through envs, never interpolated into the command string.
    expect(cmd).not.toContain('https://s3.example')
    expect(opts.envs).toEqual({
      URL: 'https://s3.example/p?a=1&b=2',
      DST: '/home/user/tables/t.csv',
      DIR: '/home/user/tables',
    })
    expect(opts.user).toBeUndefined() // code sandbox runs as default user
    expect(mockFilesWrite).not.toHaveBeenCalled()
  })

  it('writes a content entry inline (no fetch)', async () => {
    await executeInE2B({
      code: 'x',
      language: CodeLanguage.JavaScript,
      timeoutMs: 1000,
      sandboxFiles: [{ path: '/home/user/f.txt', content: 'hi' }],
    })

    expect(mockFilesWrite).toHaveBeenCalledWith('/home/user/f.txt', 'hi')
    expect(mockCommandsRun).not.toHaveBeenCalled()
  })

  it('fetches as root in the shell sandbox', async () => {
    await executeShellInE2B({
      code: 'echo hi',
      envs: {},
      timeoutMs: 1000,
      sandboxFiles: [{ type: 'url', path: '/home/user/tables/t.csv', url: 'https://s3.example/p' }],
    })

    const fetchCall = mockCommandsRun.mock.calls.find((c) => c[1]?.envs?.URL)
    expect(fetchCall).toBeDefined()
    expect(fetchCall?.[0]).toContain('curl')
    expect(fetchCall?.[1].user).toBe('root')
  })

  it('throws a clear error and kills the sandbox when the fetch fails', async () => {
    mockCommandsRun.mockRejectedValueOnce(new Error('curl: (22) 403'))

    await expect(
      executeInE2B({
        code: 'x',
        language: CodeLanguage.JavaScript,
        timeoutMs: 1000,
        sandboxFiles: [
          { type: 'url', path: '/home/user/tables/t.csv', url: 'https://s3.example/p' },
        ],
      })
    ).rejects.toThrow(/Failed to fetch mounted file into sandbox/)

    expect(mockKill).toHaveBeenCalled()
    expect(mockRunCode).not.toHaveBeenCalled()
  })
})
