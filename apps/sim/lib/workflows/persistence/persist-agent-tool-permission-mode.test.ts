/**
 * @vitest-environment node
 */
import { createAgentBlock, dbChainMock, resetDbChainMock } from '@sim/testing'
import type { WorkflowState } from '@sim/workflow-types/workflow'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  isFeatureEnabled: vi.fn(),
  saveRaw: vi.fn(),
}))

vi.mock('@/lib/core/config/feature-flags', () => ({
  isFeatureEnabled: mocks.isFeatureEnabled,
}))
vi.mock('@sim/workflow-persistence/save', () => ({
  saveWorkflowToNormalizedTables: mocks.saveRaw,
}))

import { saveWorkflowToNormalizedTables } from '@/lib/workflows/persistence/utils'

function stateWithTool(
  tool: Record<string, unknown>,
  canonicalModes?: Record<string, 'basic' | 'advanced'>
): WorkflowState {
  return {
    blocks: {
      agent: createAgentBlock({
        id: 'agent',
        subBlocks: { tools: { id: 'tools', type: 'tool-input', value: [tool] } },
        data: { canonicalModes },
      }),
    },
    edges: [],
    loops: {},
    parallels: {},
    lastSaved: 0,
  }
}

const GOVERNANCE = { workspaceId: 'workspace-1', subjectUserId: null }

describe('agent tool Permission Mode write gate', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetDbChainMock()
    mocks.isFeatureEnabled.mockResolvedValue(false)
    mocks.saveRaw.mockResolvedValue({ success: true })
  })

  it.each(['<start.toolMode>', 'auto', ''])(
    'refuses expression %j while disabled',
    async (value) => {
      await expect(
        saveWorkflowToNormalizedTables(
          'workflow-1',
          stateWithTool({ type: 'function', usageControlExpression: value }),
          GOVERNANCE
        )
      ).rejects.toMatchObject({
        code: 'validation',
        message: 'Variable agent tool permission modes are disabled',
      })
      expect(mocks.saveRaw).not.toHaveBeenCalled()
      expect(dbChainMock.db.transaction).not.toHaveBeenCalled()
      expect(mocks.isFeatureEnabled).toHaveBeenCalledWith('agent-tool-permission-mode')
    }
  )

  it('refuses advanced mode without an expression, including inside a caller transaction', async () => {
    await expect(
      saveWorkflowToNormalizedTables(
        'workflow-1',
        stateWithTool({ type: 'function' }, { '0:agentToolUsageControl': 'advanced' }),
        GOVERNANCE,
        dbChainMock.db
      )
    ).rejects.toMatchObject({ code: 'validation' })
    expect(mocks.saveRaw).not.toHaveBeenCalled()
  })

  it('does not preserve an expression just because its selector mode is basic', async () => {
    await expect(
      saveWorkflowToNormalizedTables(
        'workflow-1',
        stateWithTool(
          { type: 'function', usageControl: 'auto', usageControlExpression: '<start.toolMode>' },
          { '0:agentToolUsageControl': 'basic' }
        ),
        GOVERNANCE
      )
    ).rejects.toMatchObject({ code: 'validation' })
    expect(mocks.saveRaw).not.toHaveBeenCalled()
  })

  it.each(['auto', 'force', 'none'])(
    'allows fixed %s without consulting the flag',
    async (value) => {
      const state = stateWithTool({ type: 'function', usageControl: value })
      await expect(
        saveWorkflowToNormalizedTables('workflow-1', state, GOVERNANCE, dbChainMock.db)
      ).resolves.toEqual({ success: true })
      expect(mocks.saveRaw).toHaveBeenCalledWith('workflow-1', state, dbChainMock.db)
      expect(mocks.isFeatureEnabled).not.toHaveBeenCalled()
    }
  )

  it('allows variable configurations when enabled', async () => {
    mocks.isFeatureEnabled.mockResolvedValue(true)
    const state = stateWithTool(
      { type: 'function', usageControlExpression: '<start.toolMode>' },
      { '0:agentToolUsageControl': 'advanced' }
    )
    await expect(
      saveWorkflowToNormalizedTables('workflow-1', state, GOVERNANCE, dbChainMock.db)
    ).resolves.toEqual({ success: true })
    expect(mocks.saveRaw).toHaveBeenCalledWith('workflow-1', state, dbChainMock.db)
  })

  it('leaves other canonical parameters and nested tool parameters available', async () => {
    const state = stateWithTool(
      { type: 'function', params: { usageControlExpression: '<start.value>' } },
      { '0:channel': 'advanced' }
    )
    await expect(
      saveWorkflowToNormalizedTables('workflow-1', state, GOVERNANCE, dbChainMock.db)
    ).resolves.toEqual({ success: true })
    expect(mocks.isFeatureEnabled).not.toHaveBeenCalled()
  })
})
