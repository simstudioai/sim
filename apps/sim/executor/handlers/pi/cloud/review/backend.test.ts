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
  mockCreatePiModelRuntime,
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
  mockCreatePiModelRuntime: vi.fn(),
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
  SettingsManager: { inMemory: vi.fn(() => ({})) },
  SessionManager: { inMemory: vi.fn(() => ({})) },
  createAgentSession: mockCreateAgentSession,
  defineTool: vi.fn((tool) => tool),
}
const mockModelRuntime = {
  setRuntimeApiKey: mockSetRuntimeApiKey,
  removeRuntimeApiKey: mockRemoveRuntimeApiKey,
}

vi.mock('@/lib/execution/remote-sandbox', () => ({
  withPiSandbox: (_options: unknown, fn: (runner: unknown) => unknown) =>
    fn({ run: mockRun, writeFile: mockWriteFile }),
}))
vi.mock('@/tools', () => ({ executeTool: mockExecuteTool }))
vi.mock('@/executor/handlers/pi/core/keys', () => ({ mapThinkingLevel: () => 'medium' }))
vi.mock('@/executor/handlers/pi/core/context', () => ({
  buildPiPrompt: ({ task, guidance }: { task: string; guidance: string }) => `${guidance}\n${task}`,
}))
vi.mock('@/executor/handlers/pi/cloud/review/tools', () => ({
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
// `toPiTool` stays real so the search tool's scrubbing boundary is the one shipped, not a stub.
vi.mock('@/executor/handlers/pi/core/pi-sdk', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/executor/handlers/pi/core/pi-sdk')>()),
  loadPiSdk: () => Promise.resolve(mockSdk),
  createPiModelRuntime: mockCreatePiModelRuntime,
  resolvePiSdkModel: () => ({ id: 'claude', provider: 'anthropic' }),
  createSealedPiResourceLoader: mockCreateSealedResourceLoader,
}))

import { runCloudReviewPi } from '@/executor/handlers/pi/cloud/review/backend'
import type { PiCloudReviewRunParams } from '@/executor/handlers/pi/core/backend'

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
    merged: false,
    mergeable: true,
    head: { sha: HEAD_SHA, ref: 'feature', repo_full_name: 'octo/demo' },
    base: { sha: BASE_SHA, ref: 'staging', repo_full_name: 'octo/demo' },
    ...overrides,
  }
}

describe('runCloudReviewPi', () => {
  beforeEach(() => {
    sessionEventListener = undefined
    mockPrompt.mockReset()
    mockPrompt.mockResolvedValue(undefined)
    mockAgentSession.dispose.mockReset()
    mockCreateSealedResourceLoader.mockReturnValue(sealedResourceLoader)
    mockCreatePiModelRuntime.mockResolvedValue(mockModelRuntime)
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
    expect(mockPrompt).toHaveBeenCalledWith(
      expect.stringContaining('Use LEFT only for deleted lines')
    )
    expect(mockPrompt).not.toHaveBeenCalledWith(expect.stringContaining('diff --git'))
    expect(result).toMatchObject({
      reviewUrl: 'https://github.com/octo/demo/pull/7#pullrequestreview-9',
      commentsPosted: 1,
      totals: { finalText: 'Overall review.' },
    })
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
          output: snapshot(
            metadataFetches === 2
              ? {
                  head: {
                    sha: 'c'.repeat(40),
                    ref: 'feature',
                    repo_full_name: 'octo/demo',
                  },
                }
              : {}
          ),
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

  it('scrubs hosted credentials from emitted and thrown provider errors', async () => {
    const onEvent = vi.fn()
    mockPrompt.mockImplementation(async () => {
      sessionEventListener?.({
        type: 'error',
        error: 'provider rejected sk-hosted%2Fsecret and sk-hosted/secret',
      })
    })

    const error = (await runCloudReviewPi(
      baseParams({ isBYOK: false, apiKey: 'sk-hosted/secret' }),
      { onEvent }
    ).catch((caught) => caught)) as Error

    expect(error.message).toContain('provider rejected *** and ***')
    expect(error.message).not.toContain('sk-hosted')
    expect(onEvent).toHaveBeenCalledWith({
      type: 'error',
      message: 'provider rejected *** and ***',
    })
    expect(JSON.stringify(onEvent.mock.calls)).not.toContain('sk-hosted')
  })

  describe('optional web search', () => {
    function searchParams() {
      return baseParams({
        search: {
          provider: 'exa',
          apiKey: 'sk-search',
          tool: {
            name: 'web_search',
            description: 'Search the web',
            parameters: { type: 'object', properties: {} },
            execute: async () => ({ text: 'saw sk-search', isError: false }),
          },
        },
      })
    }

    it('keeps the search key out of the sandbox without rewriting successful tool content', async () => {
      const params = searchParams()
      const result = await runCloudReviewPi(params, { onEvent: vi.fn() })

      const searchTool = mockCreateAgentSession.mock.calls[0][0].customTools.at(-1)
      const toolResult = await searchTool.execute('call-1', {}, undefined, undefined, {})

      expect(toolResult.content).toEqual([{ type: 'text', text: 'saw sk-search' }])
      expect(
        mockRun.mock.calls.some(([, options]) => JSON.stringify(options.envs).includes('sk-search'))
      ).toBe(false)
      expect(result.commentsPosted).toBe(1)
    })
  })

  it('refuses a PR that is no longer open, before creating a sandbox', async () => {
    mockExecuteTool.mockResolvedValue({ success: true, output: snapshot({ state: 'closed' }) })

    await expect(runCloudReviewPi(baseParams(), { onEvent: vi.fn() })).rejects.toThrow(
      /only open PRs are supported/
    )
    expect(mockRun).not.toHaveBeenCalled()
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
})
