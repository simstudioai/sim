/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockBuildPrompt,
  mockCleanup,
  mockProviderEnvVar,
  mockRun,
  mockWithPiSandbox,
  mockWriteFile,
} = vi.hoisted(() => ({
  mockBuildPrompt: vi.fn(),
  mockCleanup: vi.fn(),
  mockProviderEnvVar: vi.fn(),
  mockRun: vi.fn(),
  mockWithPiSandbox: vi.fn(),
  mockWriteFile: vi.fn(),
}))

vi.mock('@/lib/execution/remote-sandbox', () => ({ withPiSandbox: mockWithPiSandbox }))
vi.mock('@/lib/execution/remote-sandbox/pi-lifetime', () => ({
  resolvePiRunLifetimeMs: () => 40 * 60 * 1000,
  resolvePiSandboxLifetimeMs: () => 40 * 60 * 1000,
}))
vi.mock('@/executor/handlers/pi/core/context', () => ({ buildPiPrompt: mockBuildPrompt }))
vi.mock('@/executor/handlers/pi/core/keys', () => ({
  providerApiKeyEnvVar: mockProviderEnvVar,
  mapThinkingLevel: () => 'high',
}))

import {
  PI_EVENT_FILTER_PATH,
  PI_EVENT_FILTER_SOURCE,
} from '@/executor/handlers/pi/cloud/event-filter-source'
import { runCloudPlanPi } from '@/executor/handlers/pi/cloud/plan/backend'
import type { PiCloudPlanRunParams } from '@/executor/handlers/pi/core/backend'
import {
  PI_SEARCH_API_KEY_ENV_VAR,
  PI_SEARCH_EXTENSION_PATH,
  PI_SEARCH_PROVIDER_ENV_VAR,
} from '@/executor/handlers/pi/search/extension-source'

function params(overrides: Partial<PiCloudPlanRunParams> = {}): PiCloudPlanRunParams {
  return {
    mode: 'cloud_plan',
    model: 'claude',
    piModel: 'claude-sonnet-4-6',
    providerId: 'anthropic',
    apiKey: 'sk-model-secret',
    isBYOK: true,
    task: 'Plan the feature',
    skills: [{ name: 'style', content: 'Prefer small changes.' }],
    initialMessages: [{ role: 'user', content: 'Earlier context' }],
    owner: 'octo',
    repo: 'demo',
    githubToken: 'ghp_clone_secret',
    ...overrides,
  }
}

describe('runCloudPlanPi', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockBuildPrompt.mockReturnValue('PLAN PROMPT')
    mockProviderEnvVar.mockReturnValue('ANTHROPIC_API_KEY')
    mockWithPiSandbox.mockImplementation(async (_options, callback) => {
      try {
        return await callback({ run: mockRun, writeFile: mockWriteFile })
      } finally {
        mockCleanup()
      }
    })
    mockRun.mockImplementation(
      (command: string, options: { onStdout?: (chunk: string) => void }) => {
        if (command.includes('git clone')) {
          return Promise.resolve({ stdout: '', stderr: '', exitCode: 0 })
        }
        options.onStdout?.(
          '{"type":"message_update","assistantMessageEvent":{"type":"text_delta","delta":"# Plan\\nDo it"}}\n'
        )
        return Promise.resolve({ stdout: '', stderr: '', exitCode: 0 })
      }
    )
  })

  it('clones the selected branch, removes the remote, and runs Pi without GitHub credentials', async () => {
    const onEvent = vi.fn()
    const result = await runCloudPlanPi(params({ baseBranch: 'staging' }), { onEvent })

    expect(mockRun).toHaveBeenCalledTimes(2)
    const [cloneCommand, cloneOptions] = mockRun.mock.calls[0]
    expect(cloneCommand).toContain('git clone --no-tags')
    expect(cloneCommand).toContain('git checkout --detach "origin/$BASE_BRANCH"')
    expect(cloneCommand.trim().endsWith('git remote remove origin')).toBe(true)
    expect(cloneCommand).not.toContain('git commit')
    expect(cloneCommand).not.toContain('git push')
    expect(cloneOptions.envs).toMatchObject({
      GITHUB_TOKEN: 'ghp_clone_secret',
      BASE_BRANCH: 'staging',
    })

    const [piCommand, piOptions] = mockRun.mock.calls[1]
    expect(piCommand).toContain('--no-extensions --no-prompt-templates --no-skills --no-approve')
    expect(piCommand).toContain(`| node ${PI_EVENT_FILTER_PATH}`)
    expect(piCommand).not.toContain('git commit')
    expect(piCommand).not.toContain('git push')
    expect(piOptions.envs.ANTHROPIC_API_KEY).toBe('sk-model-secret')
    expect(piOptions.envs.GITHUB_TOKEN).toBeUndefined()
    expect(piOptions.envs.PI_MODEL).toBe('claude-sonnet-4-6')
    expect(piOptions.envs.PI_THINKING).toBe('high')
    expect(piOptions.timeoutMs).toBe(30 * 60 * 1000)

    expect(mockBuildPrompt).toHaveBeenCalledWith(
      expect.objectContaining({
        skills: [{ name: 'style', content: 'Prefer small changes.' }],
        initialMessages: [{ role: 'user', content: 'Earlier context' }],
        task: 'Plan the feature',
        guidance: expect.stringMatching(/Markdown plan.*relevant files and symbols.*tests.*risks/i),
      })
    )
    expect(mockWriteFile).toHaveBeenCalledWith('/workspace/pi-prompt.txt', 'PLAN PROMPT')
    expect(mockWriteFile).toHaveBeenCalledWith(PI_EVENT_FILTER_PATH, PI_EVENT_FILTER_SOURCE)
    const filterWrites = mockWriteFile.mock.calls.filter(([path]) => path === PI_EVENT_FILTER_PATH)
    expect(filterWrites).toHaveLength(1)
    const filterWrite = mockWriteFile.mock.calls.findIndex(
      ([path]) => path === PI_EVENT_FILTER_PATH
    )
    expect(mockRun.mock.invocationCallOrder[0]).toBeLessThan(
      mockWriteFile.mock.invocationCallOrder[filterWrite]
    )
    expect(mockWriteFile.mock.invocationCallOrder[filterWrite]).toBeLessThan(
      mockRun.mock.invocationCallOrder[1]
    )
    expect(onEvent).toHaveBeenCalledWith({ type: 'text', text: '# Plan\nDo it' })
    expect(result.totals.finalText).toBe('# Plan\nDo it')
    expect(result).not.toHaveProperty('changedFiles')
    expect(result).not.toHaveProperty('diff')
  })

  it('uses the repository default branch when Base Branch is blank', async () => {
    await runCloudPlanPi(params({ baseBranch: '   ' }), { onEvent: vi.fn() })

    expect(mockRun.mock.calls[0][0]).toContain('git checkout --detach HEAD')
    expect(mockRun.mock.calls[0][1].envs.BASE_BRANCH).toBe('')
  })

  it('returns only the final assistant response while preserving live progress events', async () => {
    mockRun.mockImplementation(
      (command: string, options: { onStdout?: (chunk: string) => void }) => {
        if (command.includes('git clone')) {
          return Promise.resolve({ stdout: '', stderr: '', exitCode: 0 })
        }
        options.onStdout?.(
          `${[
            JSON.stringify({
              type: 'message_update',
              assistantMessageEvent: { type: 'text_delta', delta: 'Inspecting files...' },
            }),
            JSON.stringify({
              type: 'agent_end',
              messages: [
                {
                  role: 'assistant',
                  stopReason: 'stop',
                  content: [{ type: 'text', text: 'Inspecting files...' }],
                },
                {
                  role: 'assistant',
                  stopReason: 'stop',
                  content: [
                    { type: 'thinking', thinking: 'Hidden reasoning' },
                    { type: 'text', text: '# Final Plan\n\n1. Make the change.' },
                  ],
                },
              ],
            }),
          ].join('\n')}\n`
        )
        return Promise.resolve({ stdout: '', stderr: '', exitCode: 0 })
      }
    )
    const onEvent = vi.fn()

    const result = await runCloudPlanPi(params(), { onEvent })

    expect(onEvent).toHaveBeenCalledWith({ type: 'text', text: 'Inspecting files...' })
    expect(onEvent).toHaveBeenCalledWith({
      type: 'final',
      text: '# Final Plan\n\n1. Make the change.',
    })
    expect(result.totals.finalText).toBe('# Final Plan\n\n1. Make the change.')
  })

  it('loads only the Sim search extension and scopes its key to the Pi command', async () => {
    await runCloudPlanPi(params({ search: { provider: 'exa', apiKey: 'exa-secret' } }), {
      onEvent: vi.fn(),
    })

    expect(mockWriteFile).toHaveBeenCalledWith(
      PI_SEARCH_EXTENSION_PATH,
      expect.stringContaining('web_search')
    )
    const [piCommand, piOptions] = mockRun.mock.calls[1]
    expect(piCommand).toContain(`-e ${PI_SEARCH_EXTENSION_PATH}`)
    expect(piOptions.envs[PI_SEARCH_PROVIDER_ENV_VAR]).toBe('exa')
    expect(piOptions.envs[PI_SEARCH_API_KEY_ENV_VAR]).toBe('exa-secret')
    expect(mockRun.mock.calls[0][1].envs[PI_SEARCH_API_KEY_ENV_VAR]).toBeUndefined()
  })

  it('requires BYOK before creating a sandbox', async () => {
    await expect(runCloudPlanPi(params({ isBYOK: false }), { onEvent: vi.fn() })).rejects.toThrow(
      /Plan requires your own provider API key/
    )
    expect(mockWithPiSandbox).not.toHaveBeenCalled()
  })

  it('redacts clone credentials from failures and still releases the sandbox', async () => {
    const leakedCloneUrl = `fatal: https://x-access-token:${params().githubToken}@github.com/octo/demo.git`
    mockRun.mockResolvedValueOnce({
      stdout: '',
      stderr: leakedCloneUrl,
      exitCode: 1,
    })

    const error = await runCloudPlanPi(params(), { onEvent: vi.fn() }).catch((caught) => caught)

    expect(error).toBeInstanceOf(Error)
    expect(error.message).not.toContain('ghp_clone_secret')
    expect(error.message).toContain('***')
    expect(mockCleanup).toHaveBeenCalledOnce()
  })

  it('propagates cancellation and still releases the sandbox', async () => {
    const controller = new AbortController()
    controller.abort()

    await expect(
      runCloudPlanPi(params(), { onEvent: vi.fn(), signal: controller.signal })
    ).rejects.toThrow(/aborted/)
    expect(mockCleanup).toHaveBeenCalledOnce()
  })
})
