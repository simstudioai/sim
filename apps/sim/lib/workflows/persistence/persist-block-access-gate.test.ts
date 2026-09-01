/**
 * @vitest-environment node
 *
 * The gate lives on the shared write rather than at each door, so this is where
 * it is proved: `saveWorkflowToNormalizedTables` is the one primitive every
 * normalized-table write funnels through, and the assertions below are about
 * the primitive, not about any caller that happens to reach it.
 */
import {
  dbChainMock,
  permissionGroupScopeMock,
  permissionGroupScopeMockFns,
  resetDbChainMock,
  resetPermissionGroupScopeMock,
} from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  saveRaw: vi.fn(),
  lock: vi.fn(),
}))

vi.mock('@/lib/permission-groups/config-scope.server', () => permissionGroupScopeMock)
vi.mock('@sim/workflow-persistence/save', () => ({
  saveWorkflowToNormalizedTables: mocks.saveRaw,
}))

import { OrchestrationError } from '@/lib/core/orchestration/types'
import { saveWorkflowToNormalizedTables } from '@/lib/workflows/persistence/utils'
import type { WorkflowState } from '@/stores/workflows/workflow/types'

function stateWith(type: string): WorkflowState {
  return {
    blocks: {
      'block-1': {
        id: 'block-1',
        type,
        name: 'Block',
        position: { x: 0, y: 0 },
        subBlocks: {},
        outputs: {},
        enabled: true,
      },
    },
    edges: [],
    loops: {},
    parallels: {},
  } as unknown as WorkflowState
}

const GOVERNED = { workspaceId: 'workspace-1', subjectUserId: 'user-1' }

describe('saveWorkflowToNormalizedTables permission-group gate', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetDbChainMock()
    resetPermissionGroupScopeMock()
    mocks.saveRaw.mockResolvedValue({ success: true })
  })

  it('refuses a block type the governed subject’s allowlist withholds, before any write', async () => {
    permissionGroupScopeMockFns.mockResolvePermissionGroupConfig.mockResolvedValue({
      allowedIntegrations: ['slack'],
    })

    await expect(
      saveWorkflowToNormalizedTables('workflow-1', stateWith('gmail'), GOVERNED)
    ).rejects.toMatchObject({
      name: 'OrchestrationError',
      code: 'forbidden',
      message: expect.stringContaining('gmail'),
    })
    expect(mocks.saveRaw).not.toHaveBeenCalled()
  })

  it('writes a block type the allowlist names', async () => {
    permissionGroupScopeMockFns.mockResolvePermissionGroupConfig.mockResolvedValue({
      allowedIntegrations: ['slack'],
    })

    await expect(
      saveWorkflowToNormalizedTables('workflow-1', stateWith('slack'), GOVERNED, dbChainMock.db)
    ).resolves.toMatchObject({ success: true })
    expect(mocks.saveRaw).toHaveBeenCalled()
  })

  /**
   * The executor exemption. A run — or a revert, or a fork copy — persists a
   * graph the workspace already holds, and blocking it on the triggering
   * member's group would fail a run for a block the deployment was authorized
   * with. Every such caller states that by passing a `null` subject.
   */
  it('writes for an actorless caller even when the workspace withholds the block type', async () => {
    permissionGroupScopeMockFns.mockResolvePermissionGroupConfig.mockResolvedValue({
      allowedIntegrations: ['slack'],
    })

    await expect(
      saveWorkflowToNormalizedTables(
        'workflow-1',
        stateWith('gmail'),
        { workspaceId: 'workspace-1', subjectUserId: null },
        dbChainMock.db
      )
    ).resolves.toMatchObject({ success: true })
    expect(mocks.saveRaw).toHaveBeenCalled()
    expect(permissionGroupScopeMockFns.mockResolvePermissionGroupConfig).not.toHaveBeenCalled()
  })

  it('writes when no workspace, and therefore no permission group, scopes the workflow', async () => {
    permissionGroupScopeMockFns.mockResolvePermissionGroupConfig.mockResolvedValue({
      allowedIntegrations: ['slack'],
    })

    await expect(
      saveWorkflowToNormalizedTables(
        'workflow-1',
        stateWith('gmail'),
        { workspaceId: null, subjectUserId: 'user-1' },
        dbChainMock.db
      )
    ).resolves.toMatchObject({ success: true })
    expect(mocks.saveRaw).toHaveBeenCalled()
  })

  /**
   * The refusal must not be folded into the `{ success: false }` union: every
   * caller renders that as a 500, and this one is a 403.
   */
  it('throws the refusal rather than returning it, on the external-transaction path too', async () => {
    permissionGroupScopeMockFns.mockResolvePermissionGroupConfig.mockResolvedValue({
      allowedIntegrations: ['slack'],
    })

    const thrown = await saveWorkflowToNormalizedTables(
      'workflow-1',
      stateWith('gmail'),
      GOVERNED,
      dbChainMock.db
    ).catch((error: unknown) => error)

    expect(thrown).toBeInstanceOf(OrchestrationError)
    expect(mocks.saveRaw).not.toHaveBeenCalled()
  })
})
