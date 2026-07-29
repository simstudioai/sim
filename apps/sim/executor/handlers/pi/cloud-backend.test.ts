/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockRun,
  mockReadFile,
  mockWriteFile,
  mockExecuteTool,
  mockProviderEnvVar,
  mockWithPiSandbox,
  mockRunBabysit,
} = vi.hoisted(() => ({
  mockRun: vi.fn(),
  mockReadFile: vi.fn(),
  mockWriteFile: vi.fn(),
  mockExecuteTool: vi.fn(),
  mockProviderEnvVar: vi.fn(),
  mockWithPiSandbox: vi.fn(),
  mockRunBabysit: vi.fn(),
}))

vi.mock('@/lib/execution/remote-sandbox', () => ({
  withPiSandbox: mockWithPiSandbox,
}))
vi.mock('@/lib/execution/remote-sandbox/pi-lifetime', () => ({
  resolvePiSandboxLifetimeMs: () => 40 * 60 * 1000,
  // Same ceiling: these cases run without an execution deadline, where the run
  // lifetime is the ceiling because there is nothing shorter to narrow to.
  resolvePiRunLifetimeMs: () => 40 * 60 * 1000,
}))
vi.mock('@/executor/handlers/pi/babysit-backend', () => ({
  runBabysitPi: mockRunBabysit,
}))
vi.mock('@/tools', () => ({ executeTool: mockExecuteTool }))
vi.mock('@/executor/handlers/pi/keys', () => ({
  providerApiKeyEnvVar: mockProviderEnvVar,
  mapThinkingLevel: () => 'medium',
}))
vi.mock('@/executor/handlers/pi/context', () => ({ buildPiPrompt: () => 'PROMPT' }))

import { createTimeoutAbortController } from '@/lib/core/execution-limits'
import type { PiCloudBranchRunParams, PiCloudRunParams } from '@/executor/handlers/pi/backend'
import { runCloudBranchPi, runCloudPi } from '@/executor/handlers/pi/cloud-backend'

function baseParams(overrides: Partial<PiCloudRunParams> = {}): PiCloudRunParams {
  return {
    mode: 'cloud',
    model: 'claude',
    piModel: 'claude',
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

function branchParams(overrides: Partial<PiCloudBranchRunParams> = {}): PiCloudBranchRunParams {
  return {
    mode: 'cloud_branch',
    model: 'claude',
    piModel: 'claude',
    providerId: 'anthropic',
    apiKey: 'sk-byok',
    isBYOK: true,
    task: 'continue it',
    skills: [],
    initialMessages: [],
    owner: 'octo',
    repo: 'demo',
    githubToken: 'ghp_secret',
    targetBranch: 'feature/existing',
    prState: 'preserve',
    ...overrides,
  }
}

function existingPullRequestOutput() {
  return {
    success: true,
    output: {
      title: 'Feature',
      body: '',
      html_url: 'https://github.com/octo/demo/pull/7',
      state: 'open',
      merged: false,
      mergeable: true,
      head: {
        sha: 'a'.repeat(40),
        ref: 'feature/existing',
        repo_full_name: 'octo/demo',
      },
      base: { sha: 'b'.repeat(40), ref: 'staging', repo_full_name: 'octo/demo' },
    },
  }
}

function mockExistingBranchPullRequest(): void {
  mockExecuteTool
    .mockResolvedValueOnce({
      success: true,
      output: { items: [{ number: 7 }], count: 1 },
    })
    .mockResolvedValueOnce(existingPullRequestOutput())
}

describe('runCloudPi', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockWithPiSandbox.mockImplementation((_options: unknown, fn: (runner: unknown) => unknown) =>
      fn({ run: mockRun, readFile: mockReadFile, writeFile: mockWriteFile })
    )
    mockProviderEnvVar.mockReturnValue('ANTHROPIC_API_KEY')
    mockReadFile.mockResolvedValue('diff content')
    mockExecuteTool.mockImplementation((tool: string) => {
      if (tool === 'github_list_prs_v2') {
        return Promise.resolve({ success: true, output: { items: [], count: 0 } })
      }
      if (tool === 'github_repo_info_v2') {
        return Promise.resolve({ success: true, output: { default_branch: 'main' } })
      }
      if (tool === 'github_pr_v2') {
        return Promise.resolve(existingPullRequestOutput())
      }
      if (tool === 'github_update_pr') {
        return Promise.resolve({ success: true, output: {} })
      }
      return Promise.resolve({
        success: true,
        output: { metadata: { html_url: 'https://github.com/octo/demo/pull/1', number: 1 } },
      })
    })
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            data: {
              repository: {
                pullRequest: { id: 'PR_kwDOExample', isDraft: false },
              },
            },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        )
      )
    )
    mockRunBabysit.mockResolvedValue({
      totals: {
        finalText: 'Babysit stopped: clean.',
        inputTokens: 2,
        outputTokens: 3,
        toolCalls: [{ name: 'read', isError: false }],
      },
      changedFiles: ['src/y.ts'],
      diff: 'babysit diff',
      rounds: 1,
      threadsClean: true,
      checksGreen: true,
      threadsResolved: 1,
      commitsPushed: 1,
      stopReason: 'clean',
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
    expect(pushCmd).toContain('"HEAD:refs/heads/$BRANCH"')
    expect(pushOpts.envs.GITHUB_TOKEN).toBe('ghp_secret')
    expect(pushOpts.envs.ANTHROPIC_API_KEY).toBeUndefined()
    // The `-c` flags do not reach config-driven URL rewriting, which would send
    // the token's userinfo to another host; neutralizing the system and global
    // scopes does, and leaves repo-local as the only writable one.
    expect(pushOpts.envs.GIT_CONFIG_NOSYSTEM).toBe('1')
    expect(pushOpts.envs.GIT_CONFIG_GLOBAL).toBe('/dev/null')

    expect(onEvent).toHaveBeenCalledWith({ type: 'text', text: 'done' })
  })

  it('pushes the verified commit by explicit refspec, from an absolute git path', async () => {
    await runCloudPi(baseParams(), { onEvent: vi.fn() })

    const [pushCmd] = mockRun.mock.calls[3]

    // The bare branch name would push whatever the local ref points at, which is
    // not necessarily the commit PREPARE just created (detached HEAD, or the
    // agent having switched branches).
    expect(pushCmd).toContain('"HEAD:refs/heads/$BRANCH"')
    expect(pushCmd).toContain('/usr/bin/git')
  })

  it('snapshots the git config digest as the clone script last line, and does not verify it here', async () => {
    await runCloudPi(baseParams(), { onEvent: vi.fn() })

    const [cloneCmd] = mockRun.mock.calls[0]
    const [pushCmd] = mockRun.mock.calls[3]

    // The digest must be taken after the `git remote set-url` rewrite — a digest
    // captured before it mismatches at push time and every push fails.
    const lines = cloneCmd.trim().split('\n')
    expect(lines.at(-1)).toContain('__GIT_CONFIG_DIGEST__=')
    expect(lines.at(-2)).toContain('git remote set-url origin')

    // Emitting the marker is additive for every phase. The optional Babysit
    // continuation verifies it, deliberately alone, because verification would
    // fail a creation run that legitimately writes repository-local git config.
    expect(pushCmd).not.toContain('__GIT_CONFIG_DIGEST__=')
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
      }),
      { signal: undefined }
    )
    expect(result.prUrl).toBe('https://github.com/octo/demo/pull/1')
    expect(result.branch).toBe('feature-x')
    expect(result.changedFiles).toEqual(['src/x.ts'])
    expect(result.diff).toBe('diff content')
  })

  it('destroys the Create PR sandbox before composing Babysit and aggregates both phases', async () => {
    const result = await runCloudPi(
      baseParams({
        draft: true,
        skills: [{ name: 'style', content: 'Be concise.' }],
        initialMessages: [{ role: 'user', content: 'remember this for creation only' }],
        babysit: {
          maxRounds: 4,
          reviewMentions: ['@greptile', '@cursor review'],
          executionId: 'execution-1',
        },
      }),
      { onEvent: vi.fn() }
    )

    expect(mockWithPiSandbox).toHaveBeenCalledTimes(1)
    expect(mockRunBabysit).toHaveBeenCalledTimes(1)
    expect(mockExecuteTool).toHaveBeenCalledWith(
      'github_create_pr',
      expect.objectContaining({ draft: false }),
      { signal: undefined }
    )
    expect(mockWithPiSandbox.mock.invocationCallOrder[0]).toBeLessThan(
      mockRunBabysit.mock.invocationCallOrder[0]
    )
    expect(mockRunBabysit.mock.calls[0][0]).toMatchObject({
      task: 'do it',
      skills: [{ name: 'style', content: 'Be concise.' }],
      initialMessages: [],
      owner: 'octo',
      repo: 'demo',
      pullNumber: 1,
      maxRounds: 4,
      reviewMentions: ['@greptile', '@cursor review'],
      executionId: 'execution-1',
    })
    expect(mockRunBabysit.mock.calls[0][0].executionBudgetMs).toBeGreaterThan(0)
    expect(result).toMatchObject({
      memoryText: 'done',
      prUrl: 'https://github.com/octo/demo/pull/1',
      branch: 'feature-x',
      changedFiles: ['src/x.ts', 'src/y.ts'],
      diff: 'diff content\nbabysit diff',
      rounds: 1,
      threadsClean: true,
      checksGreen: true,
      threadsResolved: 1,
      commitsPushed: 1,
      stopReason: 'clean',
    })
    expect(result.totals).toMatchObject({
      finalText: 'Create PR:\ndone\n\nBabysit:\nBabysit stopped: clean.',
      inputTokens: 2,
      outputTokens: 3,
      toolCalls: [{ name: 'read', isError: false }],
    })
  })

  // Babysit spends this budget sitting in waits, so it has to reflect the deadline the
  // platform will actually enforce. Planning against the enterprise-async ceiling meant a
  // sync run was killed mid-loop with the PR opened and its review comments posted.
  it('budgets Babysit against the run signal deadline, not the platform maximum', async () => {
    const controller = createTimeoutAbortController(4 * 60 * 1000)

    await runCloudPi(
      baseParams({
        babysit: { maxRounds: 4, reviewMentions: ['@greptile'] },
      }),
      { onEvent: vi.fn(), signal: controller.signal }
    )

    const budget = mockRunBabysit.mock.calls[0][0].executionBudgetMs
    expect(budget).toBeGreaterThan(0)
    expect(budget).toBeLessThanOrEqual(4 * 60 * 1000)
    controller.cleanup()
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

  it('reports no_pr_created without starting Babysit when Create PR has no changes', async () => {
    mockRun.mockImplementation((command: string) => {
      if (command.includes('git clone')) {
        return Promise.resolve({ stdout: '__BASE_SHA__=abc', stderr: '', exitCode: 0 })
      }
      if (command.includes('pi -p')) {
        return Promise.resolve({ stdout: '', stderr: '', exitCode: 0 })
      }
      return Promise.resolve({ stdout: '__NO_CHANGES__=1', stderr: '', exitCode: 0 })
    })

    const result = await runCloudPi(
      baseParams({
        babysit: { maxRounds: 3, reviewMentions: ['@greptile'] },
      }),
      { onEvent: vi.fn() }
    )

    expect(mockRunBabysit).not.toHaveBeenCalled()
    expect(result).toMatchObject({
      rounds: 0,
      threadsClean: false,
      checksGreen: false,
      threadsResolved: 0,
      commitsPushed: 0,
      stopReason: 'no_pr_created',
    })
  })

  it('preserves the opened PR and reports startup_failure when GitHub omits its number', async () => {
    mockExecuteTool.mockResolvedValue({
      success: true,
      output: { metadata: { html_url: 'https://github.com/octo/demo/pull/1' } },
    })

    const result = await runCloudPi(
      baseParams({
        babysit: { maxRounds: 3, reviewMentions: ['@greptile'] },
      }),
      { onEvent: vi.fn() }
    )

    expect(mockRunBabysit).not.toHaveBeenCalled()
    expect(result).toMatchObject({
      prUrl: 'https://github.com/octo/demo/pull/1',
      branch: 'feature-x',
      rounds: 0,
      stopReason: 'startup_failure',
    })
  })

  it('preserves the opened PR when Babysit returns a partial failure report', async () => {
    mockRunBabysit.mockResolvedValue({
      totals: {
        finalText: 'Babysit stopped: startup_failure.',
        inputTokens: 0,
        outputTokens: 0,
        toolCalls: [],
      },
      rounds: 0,
      threadsClean: false,
      checksGreen: false,
      threadsResolved: 0,
      commitsPushed: 0,
      stopReason: 'startup_failure',
    })

    const result = await runCloudPi(
      baseParams({
        babysit: { maxRounds: 3, reviewMentions: ['@greptile'] },
      }),
      { onEvent: vi.fn() }
    )

    expect(result).toMatchObject({
      prUrl: 'https://github.com/octo/demo/pull/1',
      branch: 'feature-x',
      rounds: 0,
      threadsClean: false,
      checksGreen: false,
      commitsPushed: 0,
      stopReason: 'startup_failure',
    })
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

  it('fails (no PR) when finalize reports neither no-changes nor a push', async () => {
    mockRun.mockImplementation((command: string) => {
      if (command.includes('git clone')) {
        return Promise.resolve({ stdout: '__BASE_SHA__=abc', stderr: '', exitCode: 0 })
      }
      if (command.includes('pi -p')) {
        return Promise.resolve({ stdout: '', stderr: '', exitCode: 0 })
      }
      // PREPARE aborted before emitting a marker (e.g. the repo dir vanished).
      return Promise.resolve({
        stdout: '',
        stderr: 'cd: /workspace/repo: No such file or directory',
        exitCode: 1,
      })
    })

    await expect(runCloudPi(baseParams(), { onEvent: vi.fn() })).rejects.toThrow(/finalize failed/)
    expect(mockExecuteTool).not.toHaveBeenCalled()
    expect(mockRun.mock.calls.some(([cmd]: [string]) => cmd.includes('push'))).toBe(false)
  })

  describe('optional web search', () => {
    const search = { provider: 'exa' as const, apiKey: 'sk-search' }

    it('runs the stock Pi command with no extension when search is off', async () => {
      await runCloudPi(baseParams(), { onEvent: vi.fn() })

      const [piCmd, piOpts] = mockRun.mock.calls[1]
      expect(piCmd).not.toContain('sim-search-extension')
      expect(piCmd).not.toContain('--no-extensions')
      expect(piOpts.envs.SIM_SEARCH_PROVIDER).toBeUndefined()
      expect(piOpts.envs.SIM_SEARCH_API_KEY).toBeUndefined()
      expect(
        mockWriteFile.mock.calls.some(([path]: [string]) => path.includes('search-extension'))
      ).toBe(false)
    })

    it('installs the extension outside the checkout and loads only it', async () => {
      await runCloudPi(baseParams({ search }), { onEvent: vi.fn() })

      const [path, source] = mockWriteFile.mock.calls.find(([candidate]: [string]) =>
        candidate.includes('search-extension')
      )
      expect(path).toBe('/workspace/sim-search-extension.ts')
      expect(path.startsWith('/workspace/repo')).toBe(false)
      expect(source).toContain('registerTool')

      const [piCmd, piOpts] = mockRun.mock.calls[1]
      // `--no-extensions` first, so a planted user- or repo-level extension cannot also load.
      expect(piCmd).toContain('--no-extensions -e /workspace/sim-search-extension.ts')
      expect(piOpts.envs.SIM_SEARCH_PROVIDER).toBe('exa')
      expect(piOpts.envs.SIM_SEARCH_API_KEY).toBe('sk-search')
    })

    it('keeps the search key out of every other sandbox command', async () => {
      await runCloudPi(baseParams({ search }), { onEvent: vi.fn() })

      const [, cloneOpts] = mockRun.mock.calls[0]
      const [, prepareOpts] = mockRun.mock.calls[2]
      const [, pushOpts] = mockRun.mock.calls[3]
      for (const opts of [cloneOpts, prepareOpts, pushOpts]) {
        expect(JSON.stringify(opts.envs)).not.toContain('sk-search')
      }
    })

    it('scrubs the search key from events, diff, changed files, and the PR body', async () => {
      const onEvent = vi.fn()
      mockReadFile.mockResolvedValue('+const key = "sk-search"')
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
              '{"type":"message_update","assistantMessageEvent":{"type":"text_delta","delta":"found sk-search"}}\n'
            )
            return Promise.resolve({ stdout: '', stderr: '', exitCode: 0 })
          }
          if (command.includes('push')) {
            return Promise.resolve({ stdout: '__PUSHED__=1', stderr: '', exitCode: 0 })
          }
          return Promise.resolve({
            stdout: '__CHANGED__=src/sk-search.ts\n__NEEDS_PUSH__=1',
            stderr: '',
            exitCode: 0,
          })
        }
      )

      const result = await runCloudPi(baseParams({ search }), { onEvent })

      expect(onEvent).toHaveBeenCalledWith({ type: 'text', text: 'found ***' })
      expect(result.totals.finalText).toBe('found ***')
      expect(result.changedFiles).toEqual(['src/***.ts'])
      expect(result.diff).toBe('+const key = "***"')
      const prBody = mockExecuteTool.mock.calls[0][1].body
      expect(prBody).not.toContain('sk-search')
      expect(JSON.stringify({ result, onEvents: onEvent.mock.calls })).not.toContain('sk-search')
    })

    it('scrubs the search key from a failing Pi step', async () => {
      mockRun.mockImplementation((command: string) => {
        if (command.includes('git clone')) {
          return Promise.resolve({ stdout: '__BASE_SHA__=abc', stderr: '', exitCode: 0 })
        }
        if (command.includes('pi -p')) {
          return Promise.resolve({
            stdout: '',
            stderr: 'extension failed: bad key sk-search',
            exitCode: 1,
          })
        }
        return Promise.resolve({ stdout: '', stderr: '', exitCode: 0 })
      })

      const error = (await runCloudPi(baseParams({ search }), { onEvent: vi.fn() }).catch(
        (caught) => caught
      )) as Error
      expect(error.message).toMatch(/Pi agent failed/)
      expect(error.message).not.toContain('sk-search')
    })
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

  describe('Update PR', () => {
    it('checks out and non-force pushes the exact existing branch, then creates its PR', async () => {
      const result = await runCloudBranchPi(branchParams(), { onEvent: vi.fn() })

      const [cloneCmd, cloneOpts] = mockRun.mock.calls[0]
      expect(cloneCmd).toContain('git check-ref-format "refs/heads/$BRANCH"')
      expect(cloneCmd).toContain('--single-branch --branch "$BRANCH"')
      expect(cloneCmd).toContain('git symbolic-ref --quiet --short HEAD')
      expect(cloneCmd).toContain('[ "$CURRENT_BRANCH" != "$BRANCH" ]')
      expect(cloneCmd).not.toContain('checkout -b')
      expect(cloneOpts.envs.BRANCH).toBe('feature/existing')
      expect(cloneOpts.envs.GITHUB_TOKEN).toBe('ghp_secret')

      const [piCmd, piOpts] = mockRun.mock.calls[1]
      expect(piCmd).toContain('pi -p')
      expect(piOpts.envs.ANTHROPIC_API_KEY).toBe('sk-byok')
      expect(piOpts.envs.GITHUB_TOKEN).toBeUndefined()

      const [prepareCmd, prepareOpts] = mockRun.mock.calls[2]
      expect(prepareCmd).toContain('commit -F /workspace/pi-commit.txt')
      expect(prepareOpts.envs.GITHUB_TOKEN).toBeUndefined()

      const [pushCmd, pushOpts] = mockRun.mock.calls[3]
      expect(pushCmd).toContain('"HEAD:refs/heads/$BRANCH"')
      expect(pushCmd).not.toContain('--force')
      expect(pushOpts.envs.BRANCH).toBe('feature/existing')
      expect(pushOpts.envs.GITHUB_TOKEN).toBe('ghp_secret')

      expect(mockWriteFile).toHaveBeenCalledWith('/workspace/pi-commit.txt', 'Pi: continue it')
      expect(mockExecuteTool).toHaveBeenCalledWith(
        'github_create_pr',
        expect.objectContaining({
          head: 'feature/existing',
          base: 'main',
          draft: true,
        }),
        { signal: undefined }
      )
      expect(result).toEqual(
        expect.objectContaining({
          prUrl: 'https://github.com/octo/demo/pull/1',
          branch: 'feature/existing',
          changedFiles: ['src/x.ts'],
          diff: 'diff content',
        })
      )
    })

    it('creates the missing PR without pushing when there are no code changes', async () => {
      mockRun.mockImplementation((command: string) => {
        if (command.includes('git clone')) {
          return Promise.resolve({ stdout: '__BASE_SHA__=abc', stderr: '', exitCode: 0 })
        }
        if (command.includes('pi -p')) {
          return Promise.resolve({ stdout: '', stderr: '', exitCode: 0 })
        }
        return Promise.resolve({ stdout: '__NO_CHANGES__=1', stderr: '', exitCode: 0 })
      })

      const result = await runCloudBranchPi(branchParams(), { onEvent: vi.fn() })

      expect(result.branch).toBe('feature/existing')
      expect(result.prUrl).toBe('https://github.com/octo/demo/pull/1')
      expect(mockRun.mock.calls.some(([cmd]: [string]) => cmd.includes('push'))).toBe(false)
      expect(mockExecuteTool).toHaveBeenCalledWith(
        'github_create_pr',
        expect.objectContaining({ head: 'feature/existing', draft: true }),
        { signal: undefined }
      )
    })

    it('updates a PR created while the branch is being authored instead of creating a duplicate', async () => {
      let listCalls = 0
      mockExecuteTool.mockImplementation((tool: string) => {
        if (tool === 'github_list_prs_v2') {
          listCalls += 1
          return Promise.resolve({
            success: true,
            output:
              listCalls === 1 ? { items: [], count: 0 } : { items: [{ number: 7 }], count: 1 },
          })
        }
        if (tool === 'github_pr_v2') {
          return Promise.resolve(existingPullRequestOutput())
        }
        if (tool === 'github_create_pr') {
          throw new Error('must not create a duplicate PR')
        }
        return Promise.resolve({ success: true, output: {} })
      })

      const result = await runCloudBranchPi(branchParams(), { onEvent: vi.fn() })

      expect(listCalls).toBe(2)
      expect(
        mockExecuteTool.mock.calls.some(([tool]: [string]) => tool === 'github_create_pr')
      ).toBe(false)
      expect(result.prUrl).toBe('https://github.com/octo/demo/pull/7')
    })

    it('fails when a second PR for the branch appears during authoring', async () => {
      mockExistingBranchPullRequest()
      mockExecuteTool.mockResolvedValueOnce({
        success: true,
        output: { items: [{ number: 7 }, { number: 8 }], count: 2 },
      })

      await expect(runCloudBranchPi(branchParams(), { onEvent: vi.fn() })).rejects.toThrow(
        /multiple open pull requests/
      )
      expect(
        mockExecuteTool.mock.calls.some(([tool]: [string]) => tool === 'github_update_pr')
      ).toBe(false)
      expect(mockRunBabysit).not.toHaveBeenCalled()
    })

    it('does not claim a push happened when no-op authoring is followed by a PR error', async () => {
      mockRun.mockImplementation((command: string) => {
        if (command.includes('git clone')) {
          return Promise.resolve({ stdout: '__BASE_SHA__=abc', stderr: '', exitCode: 0 })
        }
        if (command.includes('pi -p')) {
          return Promise.resolve({ stdout: '', stderr: '', exitCode: 0 })
        }
        return Promise.resolve({ stdout: '__NO_CHANGES__=1', stderr: '', exitCode: 0 })
      })
      mockExecuteTool.mockImplementation((tool: string) => {
        if (tool === 'github_list_prs_v2') {
          return Promise.resolve({ success: true, output: { items: [], count: 0 } })
        }
        if (tool === 'github_repo_info_v2') {
          return Promise.resolve({ success: true, output: { default_branch: 'main' } })
        }
        return Promise.resolve({ success: false, error: 'permission denied' })
      })

      const error = (await runCloudBranchPi(branchParams(), {
        onEvent: vi.fn(),
      }).catch((caught) => caught)) as Error

      expect(error.message).toContain(
        'PR creation failed for branch feature/existing: permission denied'
      )
      expect(error.message).not.toContain('pushed')
      expect(mockRun.mock.calls.some(([command]: [string]) => command.includes('push'))).toBe(false)
    })

    it('uses neutral wording when a no-op run cannot update its existing PR', async () => {
      mockExistingBranchPullRequest()
      mockRun.mockImplementation((command: string) => {
        if (command.includes('git clone')) {
          return Promise.resolve({ stdout: '__BASE_SHA__=abc', stderr: '', exitCode: 0 })
        }
        if (command.includes('pi -p')) {
          return Promise.resolve({ stdout: '', stderr: '', exitCode: 0 })
        }
        return Promise.resolve({ stdout: '__NO_CHANGES__=1', stderr: '', exitCode: 0 })
      })
      mockExecuteTool.mockImplementation((tool: string) => {
        if (tool === 'github_list_prs_v2') {
          return Promise.resolve({
            success: true,
            output: { items: [{ number: 7 }], count: 1 },
          })
        }
        if (tool === 'github_pr_v2') {
          return Promise.resolve(existingPullRequestOutput())
        }
        if (tool === 'github_update_pr') {
          return Promise.resolve({ success: false, error: 'permission denied' })
        }
        return Promise.resolve({ success: true, output: {} })
      })

      const error = (await runCloudBranchPi(branchParams({ prTitle: 'New title' }), {
        onEvent: vi.fn(),
      }).catch((caught) => caught)) as Error

      expect(error.message).toContain(
        'PR update failed for branch feature/existing: permission denied'
      )
      expect(error.message).not.toContain('pushed')
      expect(mockRun.mock.calls.some(([command]: [string]) => command.includes('push'))).toBe(false)
    })

    it('updates explicit metadata and draft state on the exact existing PR', async () => {
      mockExistingBranchPullRequest()
      const mockFetch = vi
        .fn()
        .mockResolvedValueOnce(
          new Response(
            JSON.stringify({
              data: {
                repository: {
                  pullRequest: { id: 'PR_kwDOExample', isDraft: false },
                },
              },
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } }
          )
        )
        .mockResolvedValueOnce(
          new Response(
            JSON.stringify({
              data: {
                convertPullRequestToDraft: {
                  pullRequest: { id: 'PR_kwDOExample', isDraft: true },
                },
              },
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } }
          )
        )
      vi.stubGlobal('fetch', mockFetch)

      const result = await runCloudBranchPi(
        branchParams({
          baseBranch: 'release',
          prTitle: 'New title',
          prBody: 'New body',
          prState: 'draft',
        }),
        { onEvent: vi.fn() }
      )

      expect(mockExecuteTool).toHaveBeenCalledWith(
        'github_update_pr',
        {
          owner: 'octo',
          repo: 'demo',
          pullNumber: 7,
          title: 'New title',
          body: 'New body',
          base: 'release',
          apiKey: 'ghp_secret',
        },
        { signal: undefined }
      )
      expect(mockFetch).toHaveBeenCalledTimes(2)
      expect((mockFetch.mock.calls[1][1] as RequestInit).body).toContain(
        'convertPullRequestToDraft'
      )
      expect(result.prUrl).toBe('https://github.com/octo/demo/pull/7')
    })

    it('preserves unspecified metadata and state on an existing PR', async () => {
      mockExistingBranchPullRequest()

      const result = await runCloudBranchPi(branchParams(), { onEvent: vi.fn() })

      expect(
        mockExecuteTool.mock.calls.some(([tool]: [string]) => tool === 'github_update_pr')
      ).toBe(false)
      expect(vi.mocked(fetch)).not.toHaveBeenCalled()
      expect(result.prUrl).toBe('https://github.com/octo/demo/pull/7')
    })

    it('discovers the exact existing PR, pushes first, and reuses the Babysit continuation', async () => {
      mockExistingBranchPullRequest()

      const result = await runCloudBranchPi(
        branchParams({
          skills: [{ name: 'style', content: 'Be concise.' }],
          initialMessages: [{ role: 'user', content: 'authoring memory only' }],
          babysit: {
            maxRounds: 4,
            reviewMentions: ['@greptile'],
            executionId: 'execution-2',
          },
        }),
        { onEvent: vi.fn() }
      )

      expect(mockExecuteTool).toHaveBeenNthCalledWith(
        1,
        'github_list_prs_v2',
        expect.objectContaining({
          head: 'octo:feature/existing',
          state: 'open',
          per_page: 2,
        }),
        { signal: undefined }
      )
      expect(mockRunBabysit).toHaveBeenCalledTimes(1)
      expect(mockRunBabysit.mock.calls[0][0]).toMatchObject({
        pullNumber: 7,
        skills: [{ name: 'style', content: 'Be concise.' }],
        initialMessages: [],
        maxRounds: 4,
        reviewMentions: ['@greptile'],
        executionId: 'execution-2',
      })
      const pushCall = mockRun.mock.calls.find(([command]: [string]) => command.includes('push'))
      expect(pushCall).toBeDefined()
      expect(mockRun.mock.invocationCallOrder.at(-1)).toBeLessThan(
        mockRunBabysit.mock.invocationCallOrder[0]
      )
      expect(result).toMatchObject({
        memoryText: 'done',
        prUrl: 'https://github.com/octo/demo/pull/7',
        branch: 'feature/existing',
        changedFiles: ['src/x.ts', 'src/y.ts'],
        diff: 'diff content\nbabysit diff',
        rounds: 1,
        threadsClean: true,
        checksGreen: true,
        commitsPushed: 1,
        stopReason: 'clean',
      })
      expect(result.totals.finalText).toBe('Update PR:\ndone\n\nBabysit:\nBabysit stopped: clean.')
    })

    it('still babysits the existing PR when authoring makes no changes', async () => {
      mockExistingBranchPullRequest()
      mockRun.mockImplementation((command: string) => {
        if (command.includes('git clone')) {
          return Promise.resolve({ stdout: '__BASE_SHA__=abc', stderr: '', exitCode: 0 })
        }
        if (command.includes('pi -p')) {
          return Promise.resolve({ stdout: '', stderr: '', exitCode: 0 })
        }
        return Promise.resolve({ stdout: '__NO_CHANGES__=1', stderr: '', exitCode: 0 })
      })

      const result = await runCloudBranchPi(
        branchParams({ babysit: { maxRounds: 3, reviewMentions: ['@greptile'] } }),
        { onEvent: vi.fn() }
      )

      expect(mockRun.mock.calls.some(([command]: [string]) => command.includes('push'))).toBe(false)
      expect(mockRunBabysit).toHaveBeenCalledWith(
        expect.objectContaining({ pullNumber: 7 }),
        expect.anything()
      )
      expect(result).toMatchObject({
        prUrl: 'https://github.com/octo/demo/pull/7',
        branch: 'feature/existing',
        stopReason: 'clean',
      })
    })

    it('creates a ready PR and then starts Babysit when the branch has no PR', async () => {
      mockExecuteTool.mockResolvedValueOnce({
        success: true,
        output: { items: [], count: 0 },
      })

      const result = await runCloudBranchPi(
        branchParams({ babysit: { maxRounds: 3, reviewMentions: ['@greptile'] } }),
        { onEvent: vi.fn() }
      )

      expect(mockExecuteTool).toHaveBeenCalledWith(
        'github_create_pr',
        expect.objectContaining({ head: 'feature/existing', draft: false }),
        { signal: undefined }
      )
      expect(mockRunBabysit).toHaveBeenCalledWith(
        expect.objectContaining({ pullNumber: 1 }),
        expect.anything()
      )
      expect(result).toMatchObject({
        prUrl: 'https://github.com/octo/demo/pull/1',
        stopReason: 'clean',
      })
    })

    it('scrubs every sandbox credential from PR discovery errors', async () => {
      mockExecuteTool.mockResolvedValueOnce({
        success: false,
        error: 'denied ghp_secret sk-byok sk-search',
      })

      const error = (await runCloudBranchPi(
        branchParams({
          search: {
            provider: 'exa',
            apiKey: 'sk-search',
            keySource: 'block',
          },
          babysit: { maxRounds: 3, reviewMentions: ['@greptile'] },
        }),
        { onEvent: vi.fn() }
      ).catch((caught) => caught)) as Error

      expect(error.message).toContain('Failed to find an open PR')
      expect(error.message).not.toContain('ghp_secret')
      expect(error.message).not.toContain('sk-byok')
      expect(error.message).not.toContain('sk-search')
      expect(mockWithPiSandbox).not.toHaveBeenCalled()
      expect(mockRunBabysit).not.toHaveBeenCalled()
    })

    it('fails before Pi runs when the target branch cannot be cloned', async () => {
      mockRun.mockResolvedValueOnce({
        stdout: '',
        stderr: 'fatal: Remote branch feature/missing not found in upstream origin',
        exitCode: 128,
      })

      await expect(
        runCloudBranchPi(branchParams({ targetBranch: 'feature/missing' }), { onEvent: vi.fn() })
      ).rejects.toThrow(/Remote branch feature\/missing not found/)
      expect(mockRun).toHaveBeenCalledTimes(1)
      expect(mockExecuteTool).toHaveBeenCalledTimes(1)
    })

    it('rejects a tag-only target instead of creating a branch from it', async () => {
      mockRun.mockResolvedValueOnce({
        stdout: '',
        stderr: 'Target v1.0.0 is not an existing branch',
        exitCode: 1,
      })

      await expect(
        runCloudBranchPi(branchParams({ targetBranch: 'v1.0.0' }), { onEvent: vi.fn() })
      ).rejects.toThrow(/not an existing branch/)
      expect(mockRun).toHaveBeenCalledTimes(1)
      expect(mockRun.mock.calls[0][0]).toContain('git symbolic-ref --quiet --short HEAD')
      expect(mockExecuteTool).toHaveBeenCalledTimes(1)
    })

    it('surfaces a non-fast-forward rejection without retrying or force-pushing', async () => {
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
      mockReadFile.mockResolvedValue(
        '! [rejected] feature/existing -> feature/existing (non-fast-forward)'
      )

      await expect(runCloudBranchPi(branchParams(), { onEvent: vi.fn() })).rejects.toThrow(
        /non-fast-forward/
      )
      const pushCalls = mockRun.mock.calls.filter(([cmd]: [string]) => cmd.includes('push'))
      expect(pushCalls).toHaveLength(1)
      expect(pushCalls[0][0]).not.toContain('--force')
      expect(mockExecuteTool).toHaveBeenCalledTimes(1)
    })

    it('does not start Babysit after the initial branch push is rejected', async () => {
      mockExistingBranchPullRequest()
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
      mockReadFile.mockResolvedValue(
        '! [rejected] feature/existing -> feature/existing (non-fast-forward)'
      )

      await expect(
        runCloudBranchPi(
          branchParams({ babysit: { maxRounds: 3, reviewMentions: ['@greptile'] } }),
          { onEvent: vi.fn() }
        )
      ).rejects.toThrow(/non-fast-forward/)
      expect(mockRunBabysit).not.toHaveBeenCalled()
    })

    it('aborts without reaching the Pi or push steps', async () => {
      const controller = new AbortController()
      controller.abort()

      await expect(
        runCloudBranchPi(branchParams(), {
          onEvent: vi.fn(),
          signal: controller.signal,
        })
      ).rejects.toThrow(/aborted/)
      expect(mockRun.mock.calls.some(([cmd]: [string]) => cmd.includes('pi -p'))).toBe(false)
      expect(mockRun.mock.calls.some(([cmd]: [string]) => cmd.includes('push'))).toBe(false)
    })
  })
})
