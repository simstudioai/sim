/**
 * @vitest-environment node
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockLimit, mockSelect } = vi.hoisted(() => ({
  mockLimit: vi.fn(),
  mockSelect: vi.fn(),
}))

vi.mock('@sim/db', () => ({ db: { select: mockSelect } }))

import {
  getFrozenCodexLayers,
  resolveExecutionCodexConfig,
} from '@/executor/handlers/codex/core/config'
import type { ExecutionContext } from '@/executor/types'

function context(): ExecutionContext {
  return {
    workflowId: 'workflow-1',
    runtimeResources: { values: new Map(), cleanupCallbacks: new Set() },
  } as ExecutionContext
}

describe('run-frozen Codex configuration', () => {
  beforeEach(() => {
    mockLimit.mockReset()
    mockSelect.mockReset()
    const builder = {
      from: vi.fn(),
      leftJoin: vi.fn(),
      where: vi.fn(),
      limit: mockLimit,
    }
    builder.from.mockReturnValue(builder)
    builder.leftJoin.mockReturnValue(builder)
    builder.where.mockReturnValue(builder)
    mockSelect.mockReturnValue(builder)
    mockLimit.mockResolvedValue([
      {
        workspaceConfig: { owner: 'workspace-owner', repo: 'workspace-repo' },
        workflowConfig: {
          version: 1,
          defaults: { model: 'gpt-5.5', reasoningEffort: 'high' },
          agents: { reviewer: { mode: 'cloud', networkAccess: true } },
        },
      },
    ])
  })

  it('deduplicates parallel loads and retains the first snapshot for the run', async () => {
    const ctx = context()
    const [first, second] = await Promise.all([
      getFrozenCodexLayers(ctx),
      getFrozenCodexLayers(ctx),
    ])

    expect(mockSelect).toHaveBeenCalledOnce()
    expect(second).toBe(first)

    mockLimit.mockResolvedValueOnce([])
    expect(await getFrozenCodexLayers(ctx)).toBe(first)
    expect(mockSelect).toHaveBeenCalledOnce()
  })

  it('applies shared layers above legacy values and a step reasoning override last', async () => {
    const result = await resolveExecutionCodexConfig(context(), {
      agentId: 'reviewer',
      legacyStep: { owner: 'legacy-owner', model: 'gpt-5.2' },
      step: { reasoningEffort: 'xhigh' },
    })

    expect(result.config).toMatchObject({
      mode: 'cloud',
      model: 'gpt-5.5',
      owner: 'workspace-owner',
      repo: 'workspace-repo',
      reasoningEffort: 'xhigh',
      networkAccess: true,
    })
    expect(result.provenance).toMatchObject({
      owner: 'workspace',
      model: 'workflow',
      mode: 'agent',
      reasoningEffort: 'step',
    })
  })
})
