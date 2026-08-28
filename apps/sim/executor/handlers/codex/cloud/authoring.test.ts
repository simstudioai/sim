/**
 * @vitest-environment node
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockRun, mockReadFile, mockWriteFile, mockExecuteTool, runner } = vi.hoisted(() => {
  const run = vi.fn()
  const readFile = vi.fn()
  const writeFile = vi.fn()
  const close = vi.fn()
  return {
    mockRun: run,
    mockReadFile: readFile,
    mockWriteFile: writeFile,
    mockExecuteTool: vi.fn(),
    runner: { sandboxId: 'sandbox-1', run, readFile, writeFile, close },
  }
})

vi.mock('@/lib/execution/remote-sandbox/codex-lifetime', () => ({
  resolveCodexRunLifetimeMs: () => 40 * 60 * 1000,
  resolveCodexSandboxLifetimeMs: () => 40 * 60 * 1000,
}))
vi.mock('@/tools', () => ({ executeTool: mockExecuteTool }))

import { runCloudCodex } from '@/executor/handlers/codex/cloud/authoring'
import {
  CODEX_DIFF_PATH,
  CREATE_PR_CLONE_SCRIPT,
  PREPARE_CODEX_SCRIPT,
  PUSH_CODEX_SCRIPT,
  VERIFY_GIT_CONFIG_SCRIPT,
} from '@/executor/handlers/codex/cloud/shared'
import type { CodexCloudRunParams } from '@/executor/handlers/codex/core/backend'
import type { CodexAgentSession } from '@/executor/handlers/codex/core/session'

const SUCCESS_JSONL = [
  '{"type":"thread.started","thread_id":"thread-1"}',
  '{"type":"turn.started"}',
  '{"type":"item.completed","item":{"id":"message-1","type":"agent_message","text":"Implemented safely"}}',
  '{"type":"turn.completed","usage":{"input_tokens":10,"cached_input_tokens":2,"cache_write_input_tokens":0,"output_tokens":4,"reasoning_output_tokens":1}}',
  '',
].join('\n')

function params(overrides: Partial<CodexCloudRunParams> = {}): CodexCloudRunParams {
  return {
    mode: 'cloud',
    agentId: 'author',
    model: 'gpt-5.6-sol',
    apiKey: 'sk-openai',
    task: 'Implement the feature',
    reasoningEffort: 'medium',
    networkAccess: false,
    owner: 'simstudioai',
    repo: 'sim',
    githubToken: 'ghp-github',
    baseBranch: 'main',
    branchName: 'codex/feature',
    draft: true,
    ...overrides,
  }
}

function createSession(): CodexAgentSession {
  return {
    spec: {
      agentId: 'author',
      mode: 'cloud',
      model: 'gpt-5.6-sol',
      owner: 'simstudioai',
      repo: 'sim',
      baseBranch: 'main',
    },
    runner,
    turnCount: 1,
    planInitialized: false,
    authoring: { initialized: false },
  }
}

function runContext(session = createSession()) {
  return { onEvent: () => {}, session }
}

describe('runCloudCodex', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockRun.mockImplementation(
      async (
        command: string,
        options: { onStdout?: (chunk: string) => void }
      ): Promise<{ stdout: string; stderr: string; exitCode: number }> => {
        if (command === CREATE_PR_CLONE_SCRIPT) {
          return {
            stdout:
              '__BASE_SHA__=base-sha\n__DEFAULT_BRANCH__=main\n__GIT_CONFIG_DIGEST__=digest-1\n',
            stderr: '',
            exitCode: 0,
          }
        }
        if (command.includes('codex exec')) {
          options.onStdout?.(SUCCESS_JSONL)
          return { stdout: SUCCESS_JSONL, stderr: '', exitCode: 0 }
        }
        if (command === PREPARE_CODEX_SCRIPT) {
          return {
            stdout: '__HEAD_SHA__=head-sha-1\n__CHANGED__=src/a.ts\n__TURN_CHANGED__=1\n',
            stderr: '',
            exitCode: 0,
          }
        }
        if (command === VERIFY_GIT_CONFIG_SCRIPT) {
          return { stdout: '__GIT_CONFIG_DIGEST__=digest-1\n', stderr: '', exitCode: 0 }
        }
        if (command === PUSH_CODEX_SCRIPT) {
          return { stdout: '__PUSHED__=1\n', stderr: '', exitCode: 0 }
        }
        throw new Error(`Unexpected command: ${command}`)
      }
    )
    mockReadFile.mockImplementation(async (path: string) => {
      if (path === CODEX_DIFF_PATH) return 'diff --git a/src/a.ts b/src/a.ts'
      return ''
    })
    mockWriteFile.mockResolvedValue(undefined)
    mockExecuteTool.mockResolvedValue({
      success: true,
      output: { metadata: { html_url: 'https://github.com/simstudioai/sim/pull/1' } },
    })
  })

  it('keeps OpenAI and GitHub credentials in separate command phases', async () => {
    const result = await runCloudCodex(params(), runContext())

    expect(result).toMatchObject({
      status: 'completed',
      changedFiles: ['src/a.ts'],
      branch: 'codex/feature',
      prUrl: 'https://github.com/simstudioai/sim/pull/1',
    })
    expect(result.totals).toMatchObject({
      finalText: 'Implemented safely',
      threadId: 'thread-1',
      turnCompleted: true,
    })

    const cloneCall = mockRun.mock.calls.find(([command]) => command === CREATE_PR_CLONE_SCRIPT)
    const codexCall = mockRun.mock.calls.find(([command]) =>
      (command as string).includes('codex exec')
    )
    const configCheckCall = mockRun.mock.calls.find(
      ([command]) => command === VERIFY_GIT_CONFIG_SCRIPT
    )
    const prepareCall = mockRun.mock.calls.find(([command]) => command === PREPARE_CODEX_SCRIPT)
    const pushCall = mockRun.mock.calls.find(([command]) => command === PUSH_CODEX_SCRIPT)

    expect(cloneCall?.[1].envs).toMatchObject({ GITHUB_TOKEN: 'ghp-github' })
    expect(cloneCall?.[1].envs).not.toHaveProperty('OPENAI_API_KEY')
    expect(codexCall?.[1].envs).toMatchObject({ OPENAI_API_KEY: 'sk-openai' })
    expect(codexCall?.[1].envs).not.toHaveProperty('GITHUB_TOKEN')
    expect(configCheckCall?.[1].envs).toEqual({})
    expect(prepareCall?.[1].envs).not.toHaveProperty('OPENAI_API_KEY')
    expect(prepareCall?.[1].envs).not.toHaveProperty('GITHUB_TOKEN')
    expect(pushCall?.[1].envs).toMatchObject({ GITHUB_TOKEN: 'ghp-github' })
    expect(pushCall?.[1].envs).not.toHaveProperty('OPENAI_API_KEY')
  })

  it('scrubs exact credentials from the prompt and pull request payload', async () => {
    await runCloudCodex(
      params({ task: 'Do not echo sk-openai or ghp-github while implementing this' }),
      runContext()
    )

    const promptWrite = mockWriteFile.mock.calls.find(([path]) =>
      (path as string).endsWith('codex-prompt.txt')
    )
    expect(promptWrite?.[1]).not.toContain('sk-openai')
    expect(promptWrite?.[1]).not.toContain('ghp-github')
    const prPayload = mockExecuteTool.mock.calls[0][1]
    expect(prPayload.apiKey).toBe('ghp-github')
    expect(JSON.stringify({ title: prPayload.title, body: prPayload.body })).not.toContain(
      'sk-openai'
    )
    expect(JSON.stringify({ title: prPayload.title, body: prPayload.body })).not.toContain(
      'ghp-github'
    )
  })

  it('continues the same thread, branch, and pull request on a later turn', async () => {
    const session = createSession()
    await runCloudCodex(params(), runContext(session))

    mockRun.mockImplementation(
      async (
        command: string,
        options: { onStdout?: (chunk: string) => void }
      ): Promise<{ stdout: string; stderr: string; exitCode: number }> => {
        if (command === CREATE_PR_CLONE_SCRIPT) throw new Error('repository cloned twice')
        if (command.includes('codex exec')) {
          options.onStdout?.(SUCCESS_JSONL)
          return { stdout: SUCCESS_JSONL, stderr: '', exitCode: 0 }
        }
        if (command === VERIFY_GIT_CONFIG_SCRIPT) {
          return { stdout: '__GIT_CONFIG_DIGEST__=digest-1\n', stderr: '', exitCode: 0 }
        }
        if (command === PREPARE_CODEX_SCRIPT) {
          return {
            stdout:
              '__HEAD_SHA__=head-sha-2\n__CHANGED__=src/a.ts\n__CHANGED__=src/b.ts\n__TURN_CHANGED__=1\n',
            stderr: '',
            exitCode: 0,
          }
        }
        if (command === PUSH_CODEX_SCRIPT) {
          return { stdout: '__PUSHED__=1\n', stderr: '', exitCode: 0 }
        }
        throw new Error(`Unexpected command: ${command}`)
      }
    )

    const result = await runCloudCodex(
      params({ task: 'Now add the follow-up behavior' }),
      runContext(session)
    )

    const codexCall = mockRun.mock.calls
      .filter(([command]) => (command as string).includes('codex exec'))
      .at(-1)
    const prepareCall = mockRun.mock.calls
      .filter(([command]) => command === PREPARE_CODEX_SCRIPT)
      .at(-1)
    expect(codexCall?.[1].envs.CODEX_THREAD_ID).toBe('thread-1')
    expect(prepareCall?.[1].envs).toEqual({
      BASE_SHA: 'base-sha',
      TURN_BASE_SHA: 'head-sha-1',
    })
    expect(mockExecuteTool).toHaveBeenCalledTimes(1)
    expect(result).toMatchObject({
      changedFiles: ['src/a.ts', 'src/b.ts'],
      branch: 'codex/feature',
      prUrl: 'https://github.com/simstudioai/sim/pull/1',
    })
  })

  it('does not push or create a pull request when Codex made no changes', async () => {
    mockRun.mockImplementation(
      async (
        command: string,
        options: { onStdout?: (chunk: string) => void }
      ): Promise<{ stdout: string; stderr: string; exitCode: number }> => {
        if (command === CREATE_PR_CLONE_SCRIPT) {
          return {
            stdout:
              '__BASE_SHA__=base-sha\n__DEFAULT_BRANCH__=main\n__GIT_CONFIG_DIGEST__=digest-1\n',
            stderr: '',
            exitCode: 0,
          }
        }
        if (command.includes('codex exec')) {
          options.onStdout?.(SUCCESS_JSONL)
          return { stdout: SUCCESS_JSONL, stderr: '', exitCode: 0 }
        }
        if (command === VERIFY_GIT_CONFIG_SCRIPT) {
          return { stdout: '__GIT_CONFIG_DIGEST__=digest-1\n', stderr: '', exitCode: 0 }
        }
        if (command === PREPARE_CODEX_SCRIPT) {
          return {
            stdout: '__HEAD_SHA__=base-sha\n__NO_TURN_CHANGES__=1\n',
            stderr: '',
            exitCode: 0,
          }
        }
        throw new Error(`Unexpected command: ${command}`)
      }
    )

    const result = await runCloudCodex(params(), runContext())

    expect(result).toMatchObject({ status: 'completed', changedFiles: [] })
    expect(result).not.toHaveProperty('branch')
    expect(result).not.toHaveProperty('prUrl')
    expect(mockExecuteTool).not.toHaveBeenCalled()
    expect(mockRun.mock.calls.some(([command]) => command === PUSH_CODEX_SCRIPT)).toBe(false)
    const commands = mockRun.mock.calls.map(([command]) => command)
    expect(commands.indexOf(VERIFY_GIT_CONFIG_SCRIPT)).toBeLessThan(
      commands.indexOf(PREPARE_CODEX_SCRIPT)
    )
  })

  it('refuses to finalize when repository-local git config changed', async () => {
    mockRun.mockImplementation(
      async (
        command: string,
        options: { onStdout?: (chunk: string) => void }
      ): Promise<{ stdout: string; stderr: string; exitCode: number }> => {
        if (command === CREATE_PR_CLONE_SCRIPT) {
          return {
            stdout:
              '__BASE_SHA__=base-sha\n__DEFAULT_BRANCH__=main\n__GIT_CONFIG_DIGEST__=digest-1\n',
            stderr: '',
            exitCode: 0,
          }
        }
        if (command.includes('codex exec')) {
          options.onStdout?.(SUCCESS_JSONL)
          return { stdout: SUCCESS_JSONL, stderr: '', exitCode: 0 }
        }
        if (command === VERIFY_GIT_CONFIG_SCRIPT) {
          return { stdout: '__GIT_CONFIG_DIGEST__=changed\n', stderr: '', exitCode: 0 }
        }
        if (command === PREPARE_CODEX_SCRIPT) {
          return { stdout: '__NO_CHANGES__=1\n', stderr: '', exitCode: 0 }
        }
        throw new Error(`Unexpected command: ${command}`)
      }
    )

    await expect(runCloudCodex(params(), runContext())).rejects.toThrow(
      'Repository git config changed'
    )
    expect(mockRun.mock.calls.some(([command]) => command === PREPARE_CODEX_SCRIPT)).toBe(false)
    expect(mockWriteFile).toHaveBeenCalledTimes(1)
    expect(mockRun.mock.calls.some(([command]) => command === PUSH_CODEX_SCRIPT)).toBe(false)
    expect(mockExecuteTool).not.toHaveBeenCalled()
  })
})
