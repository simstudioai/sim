/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockRun, mockReadFile, mockWriteFile, mockExecuteTool, mockProviderEnvVar } = vi.hoisted(
  () => ({
    mockRun: vi.fn(),
    mockReadFile: vi.fn(),
    mockWriteFile: vi.fn(),
    mockExecuteTool: vi.fn(),
    mockProviderEnvVar: vi.fn(),
  })
)

vi.mock('@/lib/execution/e2b', () => ({
  withPiSandbox: (fn: (runner: unknown) => unknown) =>
    fn({ run: mockRun, readFile: mockReadFile, writeFile: mockWriteFile }),
}))
vi.mock('@/tools', () => ({ executeTool: mockExecuteTool }))
vi.mock('@/executor/handlers/pi/keys', () => ({
  providerApiKeyEnvVar: mockProviderEnvVar,
  mapThinkingLevel: () => 'medium',
}))
vi.mock('@/executor/handlers/pi/context', () => ({ buildPiPrompt: () => 'PROMPT' }))

import type { PiCloudRunParams } from '@/executor/handlers/pi/backend'
import { runCloudPi } from '@/executor/handlers/pi/cloud-backend'

function baseParams(overrides: Partial<PiCloudRunParams> = {}): PiCloudRunParams {
  return {
    mode: 'cloud',
    model: 'claude',
    providerId: 'anthropic',
    apiKey: 'sk-byok',
    isBYOK: true,
    task: 'do it',
    skills: [],
    initialMessages: [],
    owner: 'octo',
    repo: 'demo',
    githubToken: 'ghp_secret',
    branchName: 'feature-x',
    draft: true,
    ...overrides,
  }
}

describe('runCloudPi', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockProviderEnvVar.mockReturnValue('ANTHROPIC_API_KEY')
    mockReadFile.mockResolvedValue('diff content')
    mockExecuteTool.mockResolvedValue({
      success: true,
      output: { metadata: { html_url: 'https://github.com/octo/demo/pull/1' } },
    })
    mockRun.mockImplementation(
      (command: string, options: { onStdout?: (chunk: string) => void }) => {
        if (command.includes('git clone')) {
          return Promise.resolve({
            stdout: '__BASE_SHA__=abc123\n__DEFAULT_BRANCH__=main',
            stderr: '',
            exitCode: 0,
          })
        }
        if (command.includes('pi -p')) {
          options.onStdout?.(
            '{"type":"message_update","assistantMessageEvent":{"type":"text_delta","delta":"done"}}\n'
          )
          return Promise.resolve({ stdout: '', stderr: '', exitCode: 0 })
        }
        if (command.includes('push')) {
          return Promise.resolve({ stdout: '__PUSHED__=1', stderr: '', exitCode: 0 })
        }
        return Promise.resolve({
          stdout: '__CHANGED__=src/x.ts\n__NEEDS_PUSH__=1',
          stderr: '',
          exitCode: 0,
        })
      }
    )
  })

  it('isolates secrets per command: token only in clone/push, model key only in the Pi loop', async () => {
    const onEvent = vi.fn()
    await runCloudPi(baseParams(), { onEvent })

    const [cloneCmd, cloneOpts] = mockRun.mock.calls[0]
    const [piCmd, piOpts] = mockRun.mock.calls[1]
    const [prepareCmd, prepareOpts] = mockRun.mock.calls[2]
    const [pushCmd, pushOpts] = mockRun.mock.calls[3]

    expect(cloneCmd).toContain('git clone')
    expect(cloneOpts.envs.GITHUB_TOKEN).toBe('ghp_secret')
    expect(cloneOpts.envs.ANTHROPIC_API_KEY).toBeUndefined()

    expect(piCmd).toContain('pi -p')
    expect(piCmd).toContain('--provider')
    expect(piOpts.envs.ANTHROPIC_API_KEY).toBe('sk-byok')
    expect(piOpts.envs.GITHUB_TOKEN).toBeUndefined()
    expect(piOpts.envs.PI_MODEL).toBe('claude')
    expect(piOpts.envs.PI_PROVIDER).toBe('anthropic')

    // PREPARE (add/commit/diff) must NOT carry the token: a repo-config-driven
    // program the agent may have planted (clean filter, fsmonitor, textconv) runs
    // on these commands and `core.hooksPath` does not stop it, so the credential
    // must simply be absent.
    expect(prepareCmd).toContain('add -A')
    expect(prepareCmd).toContain('core.hooksPath=/dev/null')
    expect(prepareOpts.envs.GITHUB_TOKEN).toBeUndefined()
    expect(prepareOpts.envs.ANTHROPIC_API_KEY).toBeUndefined()

    // PUSH is the only token-bearing command, hardened against planted git-config
    // program execution (hooks, credential.helper, fsmonitor).
    expect(pushCmd).toContain('push')
    expect(pushCmd).toContain('core.hooksPath=/dev/null')
    expect(pushCmd).toContain('credential.helper=')
    expect(pushCmd).toContain('core.fsmonitor=')
    expect(pushOpts.envs.GITHUB_TOKEN).toBe('ghp_secret')
    expect(pushOpts.envs.ANTHROPIC_API_KEY).toBeUndefined()

    expect(onEvent).toHaveBeenCalledWith({ type: 'text', text: 'done' })
  })

  it('delivers the prompt and commit message via files, never the command line', async () => {
    await runCloudPi(baseParams(), { onEvent: vi.fn() })

    // Untrusted text is written through the sandbox FS API, not interpolated into a shell command.
    expect(mockWriteFile).toHaveBeenCalledWith('/workspace/pi-prompt.txt', 'PROMPT')
    expect(mockWriteFile).toHaveBeenCalledWith('/workspace/pi-commit.txt', 'Pi: do it')

    const [piCmd, piOpts] = mockRun.mock.calls[1]
    // Prompt arrives on stdin from a fixed path; never a CLI arg or env value.
    expect(piCmd).toContain('< /workspace/pi-prompt.txt')
    expect(piCmd).not.toContain('PROMPT')
    expect(piOpts.envs.PI_TASK).toBeUndefined()

    const [prepareCmd, prepareOpts] = mockRun.mock.calls[2]
    // Commit message is read from a file, not passed as -m "...".
    expect(prepareCmd).toContain('commit -F /workspace/pi-commit.txt')
    expect(prepareCmd).not.toContain('commit -m')
    expect(prepareOpts.envs.COMMIT_MSG).toBeUndefined()
  })

  it('opens a PR from the pushed branch and returns its URL', async () => {
    const result = await runCloudPi(baseParams(), { onEvent: vi.fn() })

    expect(mockExecuteTool).toHaveBeenCalledWith(
      'github_create_pr',
      expect.objectContaining({
        owner: 'octo',
        repo: 'demo',
        head: 'feature-x',
        base: 'main',
        draft: true,
        apiKey: 'ghp_secret',
      })
    )
    expect(result.prUrl).toBe('https://github.com/octo/demo/pull/1')
    expect(result.branch).toBe('feature-x')
    expect(result.changedFiles).toEqual(['src/x.ts'])
    expect(result.diff).toBe('diff content')
  })

  it('skips the PR when nothing was pushed', async () => {
    mockRun.mockImplementation((command: string) => {
      if (command.includes('git clone')) {
        return Promise.resolve({ stdout: '__BASE_SHA__=abc', stderr: '', exitCode: 0 })
      }
      if (command.includes('pi -p')) {
        return Promise.resolve({ stdout: '', stderr: '', exitCode: 0 })
      }
      return Promise.resolve({ stdout: '__NO_CHANGES__=1', stderr: '', exitCode: 0 })
    })

    const result = await runCloudPi(baseParams(), { onEvent: vi.fn() })
    expect(mockExecuteTool).not.toHaveBeenCalled()
    expect(result.prUrl).toBeUndefined()
    // No changes => the token-bearing push command must never run.
    expect(mockRun.mock.calls.some(([cmd]: [string]) => cmd.includes('push'))).toBe(false)
  })

  it('rejects a non-BYOK key (no Sim-owned key in the sandbox)', async () => {
    await expect(runCloudPi(baseParams({ isBYOK: false }), { onEvent: vi.fn() })).rejects.toThrow(
      /BYOK/
    )
  })

  it('rejects providers that cannot run via a single key', async () => {
    mockProviderEnvVar.mockReturnValue(null)
    await expect(runCloudPi(baseParams(), { onEvent: vi.fn() })).rejects.toThrow(/not supported/)
  })

  it('fails when the Pi CLI exits non-zero (no PR opened)', async () => {
    mockRun.mockImplementation((command: string) => {
      if (command.includes('git clone')) {
        return Promise.resolve({ stdout: '__BASE_SHA__=abc', stderr: '', exitCode: 0 })
      }
      if (command.includes('pi -p')) {
        return Promise.resolve({ stdout: '', stderr: 'model not found', exitCode: 1 })
      }
      return Promise.resolve({ stdout: '', stderr: '', exitCode: 0 })
    })
    await expect(runCloudPi(baseParams(), { onEvent: vi.fn() })).rejects.toThrow(/Pi agent failed/)
    expect(mockExecuteTool).not.toHaveBeenCalled()
  })

  it('does not commit, push, or open a PR when the run reports an error on a zero exit', async () => {
    mockRun.mockImplementation(
      (command: string, options: { onStdout?: (chunk: string) => void }) => {
        if (command.includes('git clone')) {
          return Promise.resolve({ stdout: '__BASE_SHA__=abc', stderr: '', exitCode: 0 })
        }
        if (command.includes('pi -p')) {
          options.onStdout?.('{"type":"error","error":"model exploded"}\n')
          return Promise.resolve({ stdout: '', stderr: '', exitCode: 0 })
        }
        return Promise.resolve({
          stdout: '__CHANGED__=src/x.ts\n__NEEDS_PUSH__=1',
          stderr: '',
          exitCode: 0,
        })
      }
    )

    await expect(runCloudPi(baseParams(), { onEvent: vi.fn() })).rejects.toThrow(/model exploded/)
    expect(mockExecuteTool).not.toHaveBeenCalled()
    expect(mockRun.mock.calls.some(([cmd]: [string]) => cmd.includes('push'))).toBe(false)
  })

  it('surfaces the real git push error when the push fails, with the token scrubbed', async () => {
    mockRun.mockImplementation((command: string) => {
      if (command.includes('git clone')) {
        return Promise.resolve({ stdout: '__BASE_SHA__=abc', stderr: '', exitCode: 0 })
      }
      if (command.includes('pi -p')) {
        return Promise.resolve({ stdout: '', stderr: '', exitCode: 0 })
      }
      if (command.includes('push')) {
        return Promise.resolve({ stdout: '', stderr: '', exitCode: 1 })
      }
      return Promise.resolve({
        stdout: '__CHANGED__=src/x.ts\n__NEEDS_PUSH__=1',
        stderr: '',
        exitCode: 0,
      })
    })
    // The push step writes its stderr to a file; the backend reads + scrubs it.
    mockReadFile.mockResolvedValue(
      "remote: Permission to octo/demo.git denied.\nfatal: unable to access 'https://x-access-token:ghp_secret@github.com/octo/demo.git/': 403"
    )

    const error = (await runCloudPi(baseParams(), { onEvent: vi.fn() }).catch((e) => e)) as Error
    expect(error.message).toMatch(/git push failed/)
    expect(error.message).toMatch(/Permission to octo\/demo\.git denied/)
    expect(error.message).not.toContain('ghp_secret')
    expect(mockExecuteTool).not.toHaveBeenCalled()
  })
})
