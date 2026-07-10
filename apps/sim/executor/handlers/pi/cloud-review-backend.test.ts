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

import type { PiCloudReviewRunParams } from '@/executor/handlers/pi/backend'
import { runCloudReviewPi } from '@/executor/handlers/pi/cloud-review-backend'

function baseParams(overrides: Partial<PiCloudReviewRunParams> = {}): PiCloudReviewRunParams {
  return {
    mode: 'cloud_review',
    model: 'claude',
    providerId: 'anthropic',
    apiKey: 'sk-byok',
    isBYOK: true,
    task: 'review this PR',
    skills: [],
    initialMessages: [],
    owner: 'octo',
    repo: 'demo',
    githubToken: 'ghp_secret',
    pullNumber: 7,
    reviewEvent: 'COMMENT',
    ...overrides,
  }
}

const reviewJson = JSON.stringify({
  body: 'Overall looks solid.',
  comments: [{ path: 'src/x.ts', body: 'Consider a null check', line: 12, side: 'RIGHT' }],
})

describe('runCloudReviewPi', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockProviderEnvVar.mockReturnValue('ANTHROPIC_API_KEY')
    mockReadFile.mockResolvedValue(reviewJson)
    mockExecuteTool.mockImplementation((toolId: string) => {
      if (toolId === 'github_pr_v2') {
        return Promise.resolve({
          success: true,
          output: {
            title: 'Add feature',
            body: 'Does the thing',
            html_url: 'https://github.com/octo/demo/pull/7',
            head: { sha: 'deadbeef' },
            files: [
              {
                filename: 'src/x.ts',
                status: 'modified',
                additions: 3,
                deletions: 1,
                patch: '@@ -1 +1 @@\n+hello',
              },
            ],
          },
        })
      }
      return Promise.resolve({
        success: true,
        output: {
          metadata: { html_url: 'https://github.com/octo/demo/pull/7#pullrequestreview-9' },
        },
      })
    })
    mockRun.mockImplementation(
      (command: string, options: { onStdout?: (chunk: string) => void }) => {
        if (command.includes('git clone') || command.includes('git fetch')) {
          return Promise.resolve({
            stdout: '__HEAD_SHA__=deadbeef',
            stderr: '',
            exitCode: 0,
          })
        }
        if (command.includes('pi -p')) {
          options.onStdout?.(
            '{"type":"message_update","assistantMessageEvent":{"type":"text_delta","delta":"reviewing"}}\n'
          )
          return Promise.resolve({ stdout: '', stderr: '', exitCode: 0 })
        }
        return Promise.resolve({ stdout: '', stderr: '', exitCode: 0 })
      }
    )
  })

  it('isolates secrets: token only in clone, model key only in the Pi loop, no push', async () => {
    const onEvent = vi.fn()
    await runCloudReviewPi(baseParams(), { onEvent })

    expect(mockRun).toHaveBeenCalledTimes(2)
    const [cloneCmd, cloneOpts] = mockRun.mock.calls[0]
    const [piCmd, piOpts] = mockRun.mock.calls[1]

    expect(cloneCmd).toContain('pull/$PULL_NUMBER/head')
    expect(cloneOpts.envs.GITHUB_TOKEN).toBe('ghp_secret')
    expect(cloneOpts.envs.ANTHROPIC_API_KEY).toBeUndefined()
    expect(cloneOpts.envs.PULL_NUMBER).toBe('7')

    expect(piCmd).toContain('pi -p')
    expect(piOpts.envs.ANTHROPIC_API_KEY).toBe('sk-byok')
    expect(piOpts.envs.GITHUB_TOKEN).toBeUndefined()

    expect(mockRun.mock.calls.some(([cmd]: [string]) => cmd.includes('push'))).toBe(false)
    expect(onEvent).toHaveBeenCalledWith({ type: 'text', text: 'reviewing' })
  })

  it('writes prompt and PR context via files, then posts a review with comments', async () => {
    const result = await runCloudReviewPi(baseParams(), { onEvent: vi.fn() })

    expect(mockWriteFile).toHaveBeenCalledWith('/workspace/pi-prompt.txt', 'PROMPT')
    expect(mockWriteFile).toHaveBeenCalledWith(
      '/workspace/pi-pr-context.md',
      expect.stringContaining('Pull request #7')
    )

    expect(mockExecuteTool).toHaveBeenCalledWith(
      'github_pr_v2',
      expect.objectContaining({
        owner: 'octo',
        repo: 'demo',
        pullNumber: 7,
        apiKey: 'ghp_secret',
      })
    )
    expect(mockExecuteTool).toHaveBeenCalledWith(
      'github_create_pr_review',
      expect.objectContaining({
        owner: 'octo',
        repo: 'demo',
        pullNumber: 7,
        event: 'COMMENT',
        body: 'Overall looks solid.',
        commit_id: 'deadbeef',
        comments: [{ path: 'src/x.ts', body: 'Consider a null check', line: 12, side: 'RIGHT' }],
        apiKey: 'ghp_secret',
      })
    )
    expect(result.reviewUrl).toBe('https://github.com/octo/demo/pull/7#pullrequestreview-9')
    expect(result.commentsPosted).toBe(1)
    expect(result.prUrl).toBeUndefined()
  })

  it('submits against the checked-out SHA when the API head moved', async () => {
    mockRun.mockImplementation((command: string) => {
      if (command.includes('git clone') || command.includes('git fetch')) {
        return Promise.resolve({
          stdout: '__HEAD_SHA__=clonedsha99',
          stderr: '',
          exitCode: 0,
        })
      }
      if (command.includes('pi -p')) {
        return Promise.resolve({ stdout: '', stderr: '', exitCode: 0 })
      }
      return Promise.resolve({ stdout: '', stderr: '', exitCode: 0 })
    })

    await runCloudReviewPi(baseParams(), { onEvent: vi.fn() })

    expect(mockExecuteTool).toHaveBeenCalledWith(
      'github_create_pr_review',
      expect.objectContaining({ commit_id: 'clonedsha99' })
    )
  })

  it('treats null comments as empty and drops invalid inline comments', async () => {
    mockReadFile.mockResolvedValue(
      JSON.stringify({
        body: 'Summary only',
        comments: [
          null,
          { path: 'a.ts', body: 'missing line' },
          { path: 'b.ts', body: 'bad line', line: 0 },
          { path: 'c.ts', body: 'ok', line: 4, side: 'RIGHT' },
        ],
      })
    )

    const result = await runCloudReviewPi(baseParams(), { onEvent: vi.fn() })

    expect(mockExecuteTool).toHaveBeenCalledWith(
      'github_create_pr_review',
      expect.objectContaining({
        body: 'Summary only',
        comments: [{ path: 'c.ts', body: 'ok', line: 4, side: 'RIGHT' }],
      })
    )
    expect(result.commentsPosted).toBe(1)
  })

  it('allows comments: null without aborting the review', async () => {
    mockReadFile.mockResolvedValue(JSON.stringify({ body: 'No inline notes', comments: null }))

    const result = await runCloudReviewPi(baseParams(), { onEvent: vi.fn() })

    expect(mockExecuteTool).toHaveBeenCalledWith(
      'github_create_pr_review',
      expect.objectContaining({
        body: 'No inline notes',
        comments: [],
      })
    )
    expect(result.commentsPosted).toBe(0)
  })

  it('rejects a non-BYOK key', async () => {
    await expect(
      runCloudReviewPi(baseParams({ isBYOK: false }), { onEvent: vi.fn() })
    ).rejects.toThrow(/BYOK/)
  })

  it('fails when review JSON is missing or invalid', async () => {
    mockReadFile.mockResolvedValue('not-json')
    await expect(runCloudReviewPi(baseParams(), { onEvent: vi.fn() })).rejects.toThrow(
      /not valid JSON/
    )
    expect(
      mockExecuteTool.mock.calls.some(([toolId]: [string]) => toolId === 'github_create_pr_review')
    ).toBe(false)
  })

  it('scrubs the token from clone failures', async () => {
    // Avoid embedding a basic-auth URL (GitGuardian); scrubbing still covers bare tokens.
    mockRun.mockResolvedValue({
      stdout: '',
      stderr: 'fatal: Authentication failed for token ghp_secret',
      exitCode: 1,
    })

    const error = (await runCloudReviewPi(baseParams(), { onEvent: vi.fn() }).catch(
      (e) => e
    )) as Error
    expect(error.message).toMatch(/git clone\/fetch PR failed/)
    expect(error.message).not.toContain('ghp_secret')
  })
})
