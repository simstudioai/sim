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

describe('e2b result marker extraction', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockCreate.mockResolvedValue({
      sandboxId: 'sb_1',
      files: { write: mockFilesWrite },
      commands: { run: mockCommandsRun },
      runCode: mockRunCode,
      kill: mockKill,
    })
    mockCommandsRun.mockResolvedValue({ stdout: '', stderr: '', exitCode: 0 })
  })

  it('parses the result marker from a single stdout entry', async () => {
    mockRunCode.mockResolvedValue({
      error: null,
      text: '',
      logs: { stdout: ['before\n', `__SIM_RESULT__=${JSON.stringify({ ok: true })}\n`] },
      results: [],
    })

    const res = await executeInE2B({
      code: 'x',
      language: CodeLanguage.Python,
      timeoutMs: 1000,
    })

    expect(res.error).toBeUndefined()
    expect(res.result).toEqual({ ok: true })
    expect(res.stdout).toBe('before')
  })

  it('reassembles a marker line split across stream chunks (large single-line result)', async () => {
    const payload = 'x'.repeat(50_000)
    const markerLine = `__SIM_RESULT__=${JSON.stringify(payload)}\n`
    // The kernel splits one long line across several stream messages; each
    // chunk is NOT newline-terminated except the last.
    const chunks = [
      'log line\n',
      markerLine.slice(0, 20_000),
      markerLine.slice(20_000, 40_000),
      markerLine.slice(40_000),
    ]
    mockRunCode.mockResolvedValue({
      error: null,
      text: '',
      logs: { stdout: chunks },
      results: [],
    })

    const res = await executeInE2B({
      code: 'x',
      language: CodeLanguage.Python,
      timeoutMs: 1000,
    })

    expect(res.error).toBeUndefined()
    expect(res.result).toBe(payload)
    expect(res.stdout).toBe('log line')
  })

  it('returns an error instead of a truncated fragment when the marker payload is corrupted', async () => {
    // A genuinely broken payload (e.g. the tail chunk was lost entirely).
    mockRunCode.mockResolvedValue({
      error: null,
      text: '',
      logs: { stdout: [`__SIM_RESULT__="${'x'.repeat(100)}\n`] },
      results: [],
    })

    const res = await executeInE2B({
      code: 'x',
      language: CodeLanguage.Python,
      timeoutMs: 1000,
    })

    expect(res.error).toMatch(/corrupted in transport/)
    expect(res.result).toBeNull()
  })

  it('parses the shell marker and falls back to the raw string for non-JSON payloads', async () => {
    mockCommandsRun.mockResolvedValueOnce({
      stdout: `hello\n__SIM_RESULT__=${JSON.stringify([1, 2])}\n`,
      stderr: '',
      exitCode: 0,
    })
    const ok = await executeShellInE2B({ code: 'x', envs: {}, timeoutMs: 1000 })
    expect(ok.error).toBeUndefined()
    expect(ok.result).toEqual([1, 2])
    expect(ok.stdout).toBe('hello')

    // Shell markers are user-authored (`echo "__SIM_RESULT__=$STATUS"`), so a
    // plain non-JSON value is a string result, never a transport error.
    mockCommandsRun.mockResolvedValueOnce({
      stdout: '__SIM_RESULT__=ok\n',
      stderr: '',
      exitCode: 0,
    })
    const plain = await executeShellInE2B({ code: 'x', envs: {}, timeoutMs: 1000 })
    expect(plain.error).toBeUndefined()
    expect(plain.result).toBe('ok')
  })

  it('takes the LAST marker line so user-printed marker lines cannot shadow the real result', async () => {
    mockRunCode.mockResolvedValue({
      error: null,
      text: '',
      logs: {
        stdout: [
          '__SIM_RESULT__=user-debug-junk\n',
          `__SIM_RESULT__=${JSON.stringify({ real: true })}\n`,
        ],
      },
      results: [],
    })

    const res = await executeInE2B({
      code: 'x',
      language: CodeLanguage.Python,
      timeoutMs: 1000,
    })

    expect(res.error).toBeUndefined()
    expect(res.result).toEqual({ real: true })
    expect(res.stdout).not.toContain('__SIM_RESULT__')
  })

  it('finds a marker that landed on stderr', async () => {
    mockRunCode.mockResolvedValue({
      error: null,
      text: '',
      logs: {
        stdout: ['regular output\n'],
        stderr: [`__SIM_RESULT__=${JSON.stringify([1])}\n`],
      },
      results: [],
    })

    const res = await executeInE2B({
      code: 'x',
      language: CodeLanguage.Python,
      timeoutMs: 1000,
    })

    expect(res.error).toBeUndefined()
    expect(res.result).toEqual([1])
    expect(res.stdout).not.toContain('__SIM_RESULT__')
  })

  it('keeps separate print lines intact (chunks concatenated verbatim, not newline-joined)', async () => {
    mockRunCode.mockResolvedValue({
      error: null,
      text: '',
      logs: { stdout: ['a\n', 'b\n'], stderr: ['warn\n'] },
      results: [],
    })

    const res = await executeInE2B({
      code: 'x',
      language: CodeLanguage.Python,
      timeoutMs: 1000,
    })

    expect(res.result).toBeNull()
    expect(res.stdout).toBe('a\nb\n\nwarn\n')
  })
})
