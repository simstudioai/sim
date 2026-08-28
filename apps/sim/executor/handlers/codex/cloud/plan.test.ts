/**
 * @vitest-environment node
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/execution/remote-sandbox/codex-lifetime', () => ({
  resolveCodexRunLifetimeMs: () => 40 * 60 * 1000,
  resolveCodexSandboxLifetimeMs: () => 40 * 60 * 1000,
}))

import type { ManagedCodingAgentSandboxRunner } from '@/lib/execution/remote-sandbox'
import { runCloudPlanCodex } from '@/executor/handlers/codex/cloud/plan'
import { PLAN_CLONE_SCRIPT } from '@/executor/handlers/codex/cloud/shared'
import type { CodexCloudPlanRunParams } from '@/executor/handlers/codex/core/backend'
import type { CodexAgentSession } from '@/executor/handlers/codex/core/session'

const SUCCESS_JSONL = [
  '{"type":"thread.started","thread_id":"thread-1"}',
  '{"type":"turn.started"}',
  '{"type":"item.completed","item":{"id":"message-1","type":"agent_message","text":"Plan ready"}}',
  '{"type":"turn.completed","usage":{"input_tokens":10,"cached_input_tokens":2,"cache_write_input_tokens":0,"output_tokens":4,"reasoning_output_tokens":1}}',
  '',
].join('\n')

function params(task: string): CodexCloudPlanRunParams {
  return {
    mode: 'cloud_plan',
    agentId: 'planner',
    model: 'gpt-5.6-sol',
    apiKey: 'sk-openai',
    task,
    reasoningEffort: 'medium',
    networkAccess: false,
    owner: 'simstudioai',
    repo: 'sim',
    githubToken: 'ghp-github',
    baseBranch: 'main',
  }
}

describe('runCloudPlanCodex', () => {
  const run = vi.fn()
  const writeFile = vi.fn()
  const runner: ManagedCodingAgentSandboxRunner = {
    sandboxId: 'sandbox-1',
    run,
    readFile: vi.fn(),
    writeFile,
    close: vi.fn(),
  }
  const session: CodexAgentSession = {
    spec: {
      agentId: 'planner',
      mode: 'cloud_plan',
      model: 'gpt-5.6-sol',
      owner: 'simstudioai',
      repo: 'sim',
      baseBranch: 'main',
    },
    runner,
    turnCount: 0,
    planInitialized: false,
    authoring: { initialized: false },
  }

  beforeEach(() => {
    vi.clearAllMocks()
    session.threadId = undefined
    session.planInitialized = false
    run.mockImplementation(
      async (
        command: string,
        options: { onStdout?: (chunk: string) => void }
      ): Promise<{ stdout: string; stderr: string; exitCode: number }> => {
        if (command === PLAN_CLONE_SCRIPT) return { stdout: '', stderr: '', exitCode: 0 }
        if (command.includes('codex exec')) {
          options.onStdout?.(SUCCESS_JSONL)
          return { stdout: SUCCESS_JSONL, stderr: '', exitCode: 0 }
        }
        throw new Error(`Unexpected command: ${command}`)
      }
    )
    writeFile.mockResolvedValue(undefined)
  })

  it('retains the checkout and resumes the native thread on a later turn', async () => {
    await runCloudPlanCodex(params('Inspect the architecture'), { onEvent: () => {}, session })
    await runCloudPlanCodex(params('Refine the test plan'), { onEvent: () => {}, session })

    const cloneCalls = run.mock.calls.filter(([command]) => command === PLAN_CLONE_SCRIPT)
    const codexCalls = run.mock.calls.filter(([command]) =>
      (command as string).includes('codex exec')
    )
    expect(cloneCalls).toHaveLength(1)
    expect(codexCalls).toHaveLength(2)
    expect(codexCalls[0][1].envs).not.toHaveProperty('CODEX_THREAD_ID')
    expect(codexCalls[1][1].envs.CODEX_THREAD_ID).toBe('thread-1')
    expect(codexCalls[0][1].envs).not.toHaveProperty('GITHUB_TOKEN')
    expect(codexCalls[1][1].envs).not.toHaveProperty('GITHUB_TOKEN')
    expect(session.threadId).toBe('thread-1')
  })
})
