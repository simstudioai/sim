/**
 * @vitest-environment node
 */

import { describe, expect, it, vi } from 'vitest'
import {
  CLONE_TIMEOUT_MS,
  FINALIZE_TIMEOUT_MS,
  GIT_CONFIG_VERIFY_TIMEOUT_MS,
  raceCodexAbort,
  resolveCodexTimeoutMs,
  runCodexTurn,
  validateCodexBranchName,
  validateGitHubRepositoryPart,
} from '@/executor/handlers/codex/cloud/shared'

const SUCCESS = [
  '{"type":"thread.started","thread_id":"thread-1"}',
  '{"type":"item.completed","item":{"id":"m1","type":"agent_message","text":"done"}}',
  '{"type":"turn.completed","usage":{"input_tokens":1,"cached_input_tokens":0,"cache_write_input_tokens":0,"output_tokens":2,"reasoning_output_tokens":1}}',
  '',
].join('\n')

describe('runCodexTurn', () => {
  it('delivers the prompt by file and validates the terminal event', async () => {
    const writeFile = vi.fn().mockResolvedValue(undefined)
    const run = vi.fn().mockImplementation(async (_command, options) => {
      options.onStdout?.(SUCCESS)
      return { stdout: SUCCESS, stderr: '', exitCode: 0 }
    })

    const result = await runCodexTurn({
      runner: { run, writeFile, readFile: vi.fn() },
      prompt: 'Task containing sk-secret and ghp-secret',
      model: 'gpt-5.6-sol',
      reasoningEffort: 'medium',
      networkAccess: false,
      apiKey: 'sk-secret',
      secrets: ['sk-secret', 'ghp-secret'],
      timeoutMs: 60_000,
      onEvent: () => {},
    })

    expect(writeFile.mock.calls[0][1]).toBe('Task containing *** and ***')
    expect(run.mock.calls[0][0]).not.toContain('Task containing')
    expect(run.mock.calls[0][0]).not.toContain('sk-secret')
    expect(run.mock.calls[0][1].envs).toMatchObject({ OPENAI_API_KEY: 'sk-secret' })
    expect(run.mock.calls[0][1].envs).not.toHaveProperty('GITHUB_TOKEN')
    expect(result).toMatchObject({ finalText: 'done', turnCompleted: true })
  })

  it('rejects a clean process exit without turn.completed', async () => {
    const output =
      '{"type":"item.completed","item":{"id":"m1","type":"agent_message","text":"partial"}}\n'
    const run = vi.fn().mockResolvedValue({ stdout: output, stderr: '', exitCode: 0 })

    await expect(
      runCodexTurn({
        runner: { run, writeFile: vi.fn(), readFile: vi.fn() },
        prompt: 'Task',
        model: 'gpt-5.6-sol',
        reasoningEffort: 'medium',
        networkAccess: false,
        apiKey: 'sk-secret',
        secrets: ['sk-secret'],
        timeoutMs: 60_000,
        onEvent: () => {},
      })
    ).rejects.toThrow('without a turn.completed event')
  })
})

describe('Codex cloud input validation', () => {
  it('accepts ordinary GitHub slugs and branch names', () => {
    expect(validateGitHubRepositoryPart('simstudioai', 'owner')).toBe('simstudioai')
    expect(validateGitHubRepositoryPart('sim.js', 'repository name')).toBe('sim.js')
    expect(validateCodexBranchName('feature/codex-v1')).toBe('feature/codex-v1')
  })

  it.each(['-bad', 'bad..name', 'bad//name', 'bad.lock', 'bad name', 'bad@{name'])(
    'rejects unsafe branch name %s',
    (branch) => expect(() => validateCodexBranchName(branch)).toThrow('Invalid Codex branch name')
  )

  it('rejects cancellation promptly', async () => {
    const controller = new AbortController()
    controller.abort()
    await expect(raceCodexAbort(Promise.resolve('late'), controller.signal)).rejects.toThrow(
      'Codex run aborted'
    )
  })
})

describe('resolveCodexTimeoutMs', () => {
  it('reserves clone, config verification, and both authoring finalize phases', () => {
    const lifetimeMs = 40 * 60 * 1000
    expect(resolveCodexTimeoutMs(lifetimeMs)).toBe(
      lifetimeMs - CLONE_TIMEOUT_MS - GIT_CONFIG_VERIFY_TIMEOUT_MS - 2 * FINALIZE_TIMEOUT_MS
    )
  })

  it('reserves only clone time for Plan', () => {
    const lifetimeMs = 40 * 60 * 1000
    expect(resolveCodexTimeoutMs(lifetimeMs, { finalizePhases: 0 })).toBe(
      lifetimeMs - CLONE_TIMEOUT_MS
    )
  })
})
