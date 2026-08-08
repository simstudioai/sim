/**
 * @vitest-environment node
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  deleteCustomTool,
  deleteWorkspaceCustomTool,
  getCustomToolById,
  getWorkspaceCustomTool,
  listCustomTools,
  listWorkspaceCustomTools,
  updateWorkspaceCustomTool,
  upsertCustomTools,
} = vi.hoisted(() => ({
  deleteCustomTool: vi.fn(),
  deleteWorkspaceCustomTool: vi.fn(),
  getCustomToolById: vi.fn(),
  getWorkspaceCustomTool: vi.fn(),
  listCustomTools: vi.fn(),
  listWorkspaceCustomTools: vi.fn(),
  updateWorkspaceCustomTool: vi.fn(),
  upsertCustomTools: vi.fn(),
}))

vi.mock('@sim/audit', () => ({
  AuditAction: {
    CUSTOM_TOOL_CREATED: 'created',
    CUSTOM_TOOL_UPDATED: 'updated',
    CUSTOM_TOOL_DELETED: 'deleted',
  },
  AuditResourceType: { CUSTOM_TOOL: 'custom_tool' },
  recordAudit: vi.fn(),
}))
vi.mock('@/lib/posthog/server', () => ({ captureServerEvent: vi.fn() }))
vi.mock('@/lib/copilot/tools/permissions', () => ({
  copilotToolCanWrite: vi.fn(() => true),
  copilotWriteDeniedMessage: vi.fn(),
}))
vi.mock('@/lib/workflows/custom-tools/operations', () => ({
  deleteCustomTool,
  deleteWorkspaceCustomTool,
  getCustomToolById,
  getWorkspaceCustomTool,
  listCustomTools,
  listWorkspaceCustomTools,
  updateWorkspaceCustomTool,
  upsertCustomTools,
}))

import { executeManageCustomTool } from './manage-custom-tool'

const CREDENTIALLESS_CONTEXT = {
  userId: 'key-owner',
  workflowId: '',
  workspaceId: 'ws-1',
  userPermission: 'admin',
  secretActorUserId: null,
}

describe('manage_custom_tool credentialless workspace scope', () => {
  beforeEach(() => vi.clearAllMocks())

  it('lists workspace tools without including legacy personal tools', async () => {
    listWorkspaceCustomTools.mockResolvedValue([{ id: 'tool-1', title: 'Shared tool' }])

    const result = await executeManageCustomTool({ operation: 'list' }, CREDENTIALLESS_CONTEXT)

    expect(result.success).toBe(true)
    expect(listWorkspaceCustomTools).toHaveBeenCalledWith({ workspaceId: 'ws-1' })
    expect(listCustomTools).not.toHaveBeenCalled()
  })

  it('edits and deletes through workspace-scoped operations', async () => {
    const existing = {
      id: 'tool-1',
      title: 'Shared tool',
      schema: { type: 'function', function: { name: 'shared_tool', parameters: {} } },
      code: 'return 1',
    }
    getWorkspaceCustomTool.mockResolvedValue(existing)
    updateWorkspaceCustomTool.mockResolvedValue(existing)
    deleteWorkspaceCustomTool.mockResolvedValue(true)

    const edit = await executeManageCustomTool(
      { operation: 'edit', toolId: 'tool-1', code: 'return 2' },
      CREDENTIALLESS_CONTEXT
    )
    const remove = await executeManageCustomTool(
      { operation: 'delete', toolId: 'tool-1' },
      CREDENTIALLESS_CONTEXT
    )

    expect(edit.success).toBe(true)
    expect(remove.success).toBe(true)
    expect(getWorkspaceCustomTool).toHaveBeenCalledWith({
      toolId: 'tool-1',
      workspaceId: 'ws-1',
    })
    expect(updateWorkspaceCustomTool).toHaveBeenCalledWith(
      expect.objectContaining({ toolId: 'tool-1', workspaceId: 'ws-1', code: 'return 2' })
    )
    expect(deleteWorkspaceCustomTool).toHaveBeenCalledWith({
      toolId: 'tool-1',
      workspaceId: 'ws-1',
    })
    expect(getCustomToolById).not.toHaveBeenCalled()
    expect(deleteCustomTool).not.toHaveBeenCalled()
  })
})
