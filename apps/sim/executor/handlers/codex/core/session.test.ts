/**
 * @vitest-environment node
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockCreateCodexSandbox } = vi.hoisted(() => ({
  mockCreateCodexSandbox: vi.fn(),
}))

vi.mock('@/lib/execution/remote-sandbox', () => ({
  createCodexSandbox: mockCreateCodexSandbox,
}))
vi.mock('@/lib/execution/remote-sandbox/codex-lifetime', () => ({
  resolveCodexRunLifetimeMs: () => 30 * 60 * 1000,
}))

import type { ManagedCodingAgentSandboxRunner } from '@/lib/execution/remote-sandbox'
import {
  type CodexAgentSessionSpec,
  parseCodexAgentId,
  withCodexAgentTurn,
} from '@/executor/handlers/codex/core/session'
import type { ExecutionContext } from '@/executor/types'

function runner(id: string): ManagedCodingAgentSandboxRunner {
  return {
    sandboxId: id,
    run: vi.fn(),
    readFile: vi.fn(),
    writeFile: vi.fn(),
    close: vi.fn(),
  }
}

function context(): ExecutionContext {
  return {
    workflowId: 'workflow-1',
    executionId: 'execution-1',
    runtimeResources: { values: new Map(), cleanupCallbacks: new Set() },
  } as ExecutionContext
}

function spec(overrides: Partial<CodexAgentSessionSpec> = {}): CodexAgentSessionSpec {
  return {
    agentId: 'planner',
    mode: 'cloud_plan',
    model: 'gpt-5.6-sol',
    owner: 'simstudioai',
    repo: 'sim',
    baseBranch: 'main',
    ...overrides,
  }
}

describe('Codex agent sessions', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    let sandboxNumber = 0
    mockCreateCodexSandbox.mockImplementation(async () => {
      sandboxNumber += 1
      return runner(`sandbox-${sandboxNumber}`)
    })
  })

  it('reuses one native session for later turns with the same agent id', async () => {
    const ctx = context()
    const seen: Array<{ sandboxId: string; reused: boolean; turn: number }> = []

    await withCodexAgentTurn(ctx, spec(), async ({ session, sessionReused, turnNumber }) => {
      seen.push({ sandboxId: session.runner.sandboxId, reused: sessionReused, turn: turnNumber })
    })
    await withCodexAgentTurn(ctx, spec(), async ({ session, sessionReused, turnNumber }) => {
      seen.push({ sandboxId: session.runner.sandboxId, reused: sessionReused, turn: turnNumber })
    })

    expect(mockCreateCodexSandbox).toHaveBeenCalledTimes(1)
    expect(seen).toEqual([
      { sandboxId: 'sandbox-1', reused: false, turn: 1 },
      { sandboxId: 'sandbox-1', reused: true, turn: 2 },
    ])
  })

  it('uses isolated sandboxes for different agent ids', async () => {
    const ctx = context()
    const ids = await Promise.all([
      withCodexAgentTurn(ctx, spec({ agentId: 'planner' }), async ({ session }) =>
        Promise.resolve(session.runner.sandboxId)
      ),
      withCodexAgentTurn(ctx, spec({ agentId: 'reviewer' }), async ({ session }) =>
        Promise.resolve(session.runner.sandboxId)
      ),
    ])

    expect(ids).toEqual(['sandbox-1', 'sandbox-2'])
    expect(mockCreateCodexSandbox).toHaveBeenCalledTimes(2)
  })

  it('serializes overlapping turns for the same agent', async () => {
    const ctx = context()
    const order: string[] = []
    let releaseFirst = () => {}
    let markFirstStarted = () => {}
    const firstStarted = new Promise<void>((resolve) => {
      markFirstStarted = resolve
    })
    const firstBlocked = new Promise<void>((resolve) => {
      releaseFirst = resolve
    })

    const first = withCodexAgentTurn(ctx, spec(), async () => {
      order.push('first-start')
      markFirstStarted()
      await firstBlocked
      order.push('first-end')
    })
    await firstStarted
    const second = withCodexAgentTurn(ctx, spec(), async () => {
      order.push('second')
    })
    await Promise.resolve()

    expect(order).toEqual(['first-start'])
    releaseFirst()
    await Promise.all([first, second])
    expect(order).toEqual(['first-start', 'first-end', 'second'])
  })

  it('rejects an incompatible repository configuration under the same agent id', async () => {
    const ctx = context()
    await withCodexAgentTurn(ctx, spec(), async () => {})

    await expect(withCodexAgentTurn(ctx, spec({ repo: 'other' }), async () => {})).rejects.toThrow(
      'different repo'
    )
    expect(mockCreateCodexSandbox).toHaveBeenCalledTimes(1)
  })

  it('closes every agent sandbox through execution cleanup', async () => {
    const ctx = context()
    const sessions: ManagedCodingAgentSandboxRunner[] = []
    await withCodexAgentTurn(ctx, spec(), async ({ session }) => {
      sessions.push(session.runner)
    })
    await withCodexAgentTurn(ctx, spec({ agentId: 'reviewer' }), async ({ session }) => {
      sessions.push(session.runner)
    })

    for (const cleanup of ctx.runtimeResources?.cleanupCallbacks ?? []) await cleanup()

    expect(sessions).toHaveLength(2)
    expect(sessions[0].close).toHaveBeenCalledOnce()
    expect(sessions[1].close).toHaveBeenCalledOnce()
  })
})

describe('parseCodexAgentId', () => {
  it('defaults to the block id and accepts a shared logical id', () => {
    expect(parseCodexAgentId(undefined, 'block-1')).toBe('block-1')
    expect(parseCodexAgentId(' reviewer ', 'block-1')).toBe('reviewer')
  })

  it.each(['bad id', '/root', '', 'x'.repeat(65)])('rejects invalid configured id %j', (value) => {
    const fallback = value === '' ? 'bad fallback' : 'block-1'
    expect(() => parseCodexAgentId(value, fallback)).toThrow('Agent ID must be')
  })
})
