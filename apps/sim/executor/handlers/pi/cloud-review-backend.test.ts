/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockRun,
  mockWriteFile,
  mockExecuteTool,
  mockInstallTools,
  mockPreflightCheckout,
  mockCreateTools,
  mockGetFindings,
  mockPrompt,
  mockCreateAgentSession,
  mockSetRuntimeApiKey,
  mockRemoveRuntimeApiKey,
  mockCreateSealedResourceLoader,
} = vi.hoisted(() => ({
  mockRun: vi.fn(),
  mockWriteFile: vi.fn(),
  mockExecuteTool: vi.fn(),
  mockInstallTools: vi.fn(),
  mockPreflightCheckout: vi.fn(),
  mockCreateTools: vi.fn(),
  mockGetFindings: vi.fn(),
  mockPrompt: vi.fn(),
  mockCreateAgentSession: vi.fn(),
  mockSetRuntimeApiKey: vi.fn(),
  mockRemoveRuntimeApiKey: vi.fn(),
  mockCreateSealedResourceLoader: vi.fn(),
}))

let sessionEventListener: ((raw: unknown) => void) | undefined
const mockSubscribe = vi.fn((listener: (raw: unknown) => void) => {
  sessionEventListener = listener
  return vi.fn()
})
const mockAgentSession = {
  subscribe: mockSubscribe,
  prompt: mockPrompt,
  abort: vi.fn(),
  dispose: vi.fn(),
  agent: { state: { errorMessage: undefined as string | undefined } },
}
const sealedResourceLoader = { kind: 'sealed' }

const mockSdk = {
  AuthStorage: {
    inMemory: vi.fn(() => ({
      setRuntimeApiKey: mockSetRuntimeApiKey,
      removeRuntimeApiKey: mockRemoveRuntimeApiKey,
    })),
  },
  ModelRegistry: { inMemory: vi.fn(() => ({})) },
  SettingsManager: { inMemory: vi.fn(() => ({})) },
  SessionManager: { inMemory: vi.fn(() => ({})) },
  createAgentSession: mockCreateAgentSession,
}

vi.mock('@/lib/execution/e2b', () => ({
  withPiSandbox: (fn: (runner: unknown) => unknown) =>
    fn({ run: mockRun, writeFile: mockWriteFile }),
}))
vi.mock('@/tools', () => ({ executeTool: mockExecuteTool }))
vi.mock('@/executor/handlers/pi/keys', () => ({ mapThinkingLevel: () => 'medium' }))
vi.mock('@/executor/handlers/pi/context', () => ({
  buildPiPrompt: ({ task, guidance }: { task: string; guidance: string }) => `${guidance}\n${task}`,
}))
vi.mock('@/executor/handlers/pi/cloud-review-tools', () => ({
  CLOUD_REVIEW_TOOL_NAMES: [
    'read_repo_file',
    'search_repo',
    'find_repo_files',
    'list_repo_directory',
    'list_changed_files',
    'read_file_diff',
    'submit_review',
  ],
  installCloudReviewTools: mockInstallTools,
  preflightCloudReviewCheckout: mockPreflightCheckout,
  createCloudReviewTools: mockCreateTools,
}))
vi.mock('@/executor/handlers/pi/pi-sdk', () => ({
  loadPiSdk: () => Promise.resolve(mockSdk),
  resolvePiSdkModel: () => ({ id: 'claude', provider: 'anthropic' }),
  createSealedPiResourceLoader: mockCreateSealedResourceLoader,
}))

import type { PiCloudReviewRunParams } from '@/executor/handlers/pi/backend'
import { runCloudReviewPi } from '@/executor/handlers/pi/cloud-review-backend'

const HEAD_SHA = 'a'.repeat(40)
const BASE_SHA = 'b'.repeat(40)
const REVIEW_TOOL_NAMES = [
  'read_repo_file',
  'search_repo',
  'find_repo_files',
  'list_repo_directory',
  'list_changed_files',
  'read_file_diff',
  'submit_review',
]

function baseParams(overrides: Partial<PiCloudReviewRunParams> = {}): PiCloudReviewRunParams {
  return {
    mode: 'cloud_review',
    model: 'claude',
    piModel: 'claude',
    providerId: 'anthropic',
    apiKey: 'sk-byok',
    isBYOK: true,
    task: 'review this PR',
    owner: 'octo',
    repo: 'demo',
    githubToken: 'ghp_secret',
    pullNumber: 7,
    reviewEvent: 'COMMENT',
    ...overrides,
  }
}

function snapshot(overrides: Record<string, unknown> = {}) {
  return {
    title: 'Add feature',
    body: 'Does the thing',
    html_url: 'https://github.com/octo/demo/pull/7',
    state: 'open',
    head: { sha: HEAD_SHA },
    base: { sha: BASE_SHA, ref: 'staging' },
    ...overrides,
  }
}

describe('runCloudReviewPi', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    sessionEventListener = undefined
    mockPrompt.mockReset()
    mockPrompt.mockResolvedValue(undefined)
    mockCreateSealedResourceLoader.mockReturnValue(sealedResourceLoader)
    mockAgentSession.agent.state.errorMessage = undefined
    mockCreateAgentSession.mockResolvedValue({ session: mockAgentSession })
    mockGetFindings.mockReturnValue({
      body: 'Overall review.',
      comments: [{ path: 'src/x.ts', body: 'Fix this', line: 12, side: 'RIGHT' }],
    })
    mockCreateTools.mockReturnValue({
      tools: REVIEW_TOOL_NAMES.map((name) => ({ name })),
      getFindings: mockGetFindings,
    })
    mockRun.mockImplementation((command: string) => {
      if (command.includes('git clone')) {
        return Promise.resolve({ stdout: '', stderr: '', exitCode: 0 })
      }
      if (command.includes('checkout --detach')) {
        return Promise.resolve({
          stdout: `__HEAD_SHA__=${HEAD_SHA}\n__BASE_SHA__=${BASE_SHA}`,
          stderr: '',
          exitCode: 0,
        })
      }
      throw new Error(`Unexpected sandbox command: ${command}`)
    })
    mockExecuteTool.mockImplementation((toolId: string) => {
      if (toolId === 'github_pr_v2') {
        return Promise.resolve({ success: true, output: snapshot() })
      }
      if (toolId === 'github_create_pr_review_v2') {
        return Promise.resolve({
          success: true,
          output: {
            html_url: 'https://github.com/octo/demo/pull/7#pullrequestreview-9',
            commit_id: HEAD_SHA,
          },
        })
      }
      throw new Error(`Unexpected tool: ${toolId}`)
    })
  })

  it('keeps the model key on the host and exposes only sealed read-only tools', async () => {
    const result = await runCloudReviewPi(baseParams(), { onEvent: vi.fn() })

    expect(mockRun).toHaveBeenCalledTimes(2)
    const [fetchCommand, fetchOptions] = mockRun.mock.calls[0]
    const [checkoutCommand, checkoutOptions] = mockRun.mock.calls[1]
    expect(fetchCommand).toContain('--no-checkout')
    expect(fetchOptions.envs.GITHUB_TOKEN).toBe('ghp_secret')
    expect(fetchOptions.envs).not.toHaveProperty('ANTHROPIC_API_KEY')
    expect(checkoutCommand).toContain('checkout --detach')
    expect(checkoutOptions.envs).not.toHaveProperty('GITHUB_TOKEN')
    expect(checkoutOptions.envs).not.toHaveProperty('ANTHROPIC_API_KEY')

    expect(mockSetRuntimeApiKey).toHaveBeenCalledWith('anthropic', 'sk-byok')
    expect(mockRemoveRuntimeApiKey).toHaveBeenCalledWith('anthropic')
    expect(mockCreateSealedResourceLoader).toHaveBeenCalledTimes(1)
    expect(mockCreateAgentSession).toHaveBeenCalledWith(
      expect.objectContaining({
        tools: REVIEW_TOOL_NAMES,
        customTools: REVIEW_TOOL_NAMES.map((name) => ({ name })),
        resourceLoader: sealedResourceLoader,
      })
    )
    expect(mockCreateAgentSession.mock.calls[0][0]).not.toHaveProperty('noTools')
    expect(mockPrompt).toHaveBeenCalledWith(
      expect.stringContaining('Start with list_changed_files')
    )
    expect(mockPrompt).not.toHaveBeenCalledWith(expect.stringContaining('diff --git'))
    expect(result).toMatchObject({
      reviewUrl: 'https://github.com/octo/demo/pull/7#pullrequestreview-9',
      commentsPosted: 1,
      totals: { finalText: 'Overall review.' },
    })
  })

  it('uses metadata-only fetches and one exact commit_id', async () => {
    const signal = new AbortController().signal
    await runCloudReviewPi(baseParams(), { onEvent: vi.fn(), signal })

    const metadataCalls = mockExecuteTool.mock.calls.filter(
      ([toolId]: [string]) => toolId === 'github_pr_v2'
    )
    expect(metadataCalls).toHaveLength(2)
    for (const [, input, options] of metadataCalls) {
      expect(input).toMatchObject({ includeFiles: false, pullNumber: 7 })
      expect(options).toEqual({ signal })
    }
    expect(mockExecuteTool).toHaveBeenCalledWith(
      'github_create_pr_review_v2',
      expect.objectContaining({
        commit_id: HEAD_SHA,
        body: 'Overall review.',
        comments: [{ path: 'src/x.ts', body: 'Fix this', line: 12, side: 'RIGHT' }],
      }),
      { signal }
    )
  })

  it('fails closed when checkout does not match the API snapshot', async () => {
    mockRun.mockImplementation((command: string) => {
      if (command.includes('git clone')) {
        return Promise.resolve({ stdout: '', stderr: '', exitCode: 0 })
      }
      return Promise.resolve({
        stdout: `__HEAD_SHA__=${'c'.repeat(40)}\n__BASE_SHA__=${BASE_SHA}`,
        stderr: '',
        exitCode: 0,
      })
    })

    await expect(runCloudReviewPi(baseParams(), { onEvent: vi.fn() })).rejects.toThrow(
      /did not match/
    )
    expect(mockCreateAgentSession).not.toHaveBeenCalled()
    expect(
      mockExecuteTool.mock.calls.some(
        ([toolId]: [string]) => toolId === 'github_create_pr_review_v2'
      )
    ).toBe(false)
  })

  it('does not post when the PR head changes during review', async () => {
    let metadataFetches = 0
    mockExecuteTool.mockImplementation((toolId: string) => {
      if (toolId === 'github_pr_v2') {
        metadataFetches += 1
        return Promise.resolve({
          success: true,
          output: snapshot(metadataFetches === 2 ? { head: { sha: 'c'.repeat(40) } } : {}),
        })
      }
      if (toolId === 'github_create_pr_review_v2') {
        throw new Error('review must not be submitted')
      }
      throw new Error(`Unexpected tool: ${toolId}`)
    })

    await expect(runCloudReviewPi(baseParams(), { onEvent: vi.fn() })).rejects.toThrow(
      /changed while the review was running/
    )
    expect(metadataFetches).toBe(2)
  })

  it('requires complete PR snapshot metadata before creating a sandbox', async () => {
    mockExecuteTool.mockResolvedValue({
      success: true,
      output: snapshot({ base: undefined }),
    })

    await expect(runCloudReviewPi(baseParams(), { onEvent: vi.fn() })).rejects.toThrow(
      /missing base/
    )
    expect(mockRun).not.toHaveBeenCalled()
  })

  it('does not post when the agent omits structured findings', async () => {
    mockGetFindings.mockReturnValue(undefined)

    await expect(runCloudReviewPi(baseParams(), { onEvent: vi.fn() })).rejects.toThrow(
      /without calling submit_review/
    )
    expect(
      mockExecuteTool.mock.calls.some(
        ([toolId]: [string]) => toolId === 'github_create_pr_review_v2'
      )
    ).toBe(false)
  })

  it('does not post when the agent emits an error event', async () => {
    mockPrompt.mockImplementation(async () => {
      sessionEventListener?.({ type: 'error', error: 'provider failed' })
    })

    await expect(runCloudReviewPi(baseParams(), { onEvent: vi.fn() })).rejects.toThrow(
      /Pi review agent failed: provider failed/
    )
    expect(
      mockExecuteTool.mock.calls.some(
        ([toolId]: [string]) => toolId === 'github_create_pr_review_v2'
      )
    ).toBe(false)
  })

  it('does not post after cancellation during the agent run', async () => {
    const abortController = new AbortController()
    mockPrompt.mockImplementation(async () => {
      abortController.abort()
    })

    await expect(
      runCloudReviewPi(baseParams(), {
        onEvent: vi.fn(),
        signal: abortController.signal,
      })
    ).rejects.toThrow(/aborted/)
    expect(mockAgentSession.abort).toHaveBeenCalled()
    expect(
      mockExecuteTool.mock.calls.some(
        ([toolId]: [string]) => toolId === 'github_create_pr_review_v2'
      )
    ).toBe(false)
  })

  it('supports hosted model credentials without sending them to the sandbox', async () => {
    await expect(
      runCloudReviewPi(baseParams({ isBYOK: false, apiKey: 'sk-hosted' }), { onEvent: vi.fn() })
    ).resolves.toMatchObject({ commentsPosted: 1 })
    expect(mockSetRuntimeApiKey).toHaveBeenCalledWith('anthropic', 'sk-hosted')
    expect(
      mockRun.mock.calls.some(([, options]) =>
        Object.values(options.envs).some((value) => value === 'sk-hosted')
      )
    ).toBe(false)
  })

  it('rejects malformed repository coordinates before making an authenticated request', async () => {
    await expect(
      runCloudReviewPi(baseParams({ owner: '../octo' }), { onEvent: vi.fn() })
    ).rejects.toThrow(/Invalid GitHub repository coordinates/)
    expect(mockExecuteTool).not.toHaveBeenCalled()
  })

  it('requires exact commit SHAs and review URLs from GitHub responses', async () => {
    mockExecuteTool.mockResolvedValueOnce({
      success: true,
      output: snapshot({ head: { sha: 'short' } }),
    })
    await expect(runCloudReviewPi(baseParams(), { onEvent: vi.fn() })).rejects.toThrow(
      /invalid sha/
    )

    vi.clearAllMocks()
    mockExecuteTool.mockResolvedValueOnce({
      success: true,
      output: snapshot({ html_url: undefined }),
    })
    await expect(runCloudReviewPi(baseParams(), { onEvent: vi.fn() })).rejects.toThrow(
      /missing html_url/
    )
  })

  it('fails closed when GitHub reports a different reviewed commit', async () => {
    mockExecuteTool.mockImplementation((toolId: string) => {
      if (toolId === 'github_pr_v2') {
        return Promise.resolve({ success: true, output: snapshot() })
      }
      if (toolId === 'github_create_pr_review_v2') {
        return Promise.resolve({
          success: true,
          output: {
            html_url: 'https://github.com/octo/demo/pull/7#pullrequestreview-9',
            commit_id: 'c'.repeat(40),
          },
        })
      }
      throw new Error(`Unexpected tool: ${toolId}`)
    })

    await expect(runCloudReviewPi(baseParams(), { onEvent: vi.fn() })).rejects.toThrow(
      /did not match the reviewed commit/
    )
  })

  it('scrubs the GitHub token from authenticated fetch failures', async () => {
    mockRun.mockResolvedValue({
      stdout: '',
      stderr: 'fatal: Authentication failed for token ghp_secret',
      exitCode: 1,
    })

    const error = (await runCloudReviewPi(baseParams(), { onEvent: vi.fn() }).catch(
      (caught) => caught
    )) as Error
    expect(error.message).toMatch(/git fetch PR failed/)
    expect(error.message).not.toContain('ghp_secret')
  })
})
