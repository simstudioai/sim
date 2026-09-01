/**
 * @vitest-environment node
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockGetAllBlocks,
  mockGetBlock,
  mockGetUserPermissionConfig,
  mockIsIntegrationDeploymentAvailable,
} = vi.hoisted(() => ({
  mockGetAllBlocks: vi.fn(),
  mockGetBlock: vi.fn(),
  mockGetUserPermissionConfig: vi.fn(),
  mockIsIntegrationDeploymentAvailable: vi.fn(() => true),
}))

vi.mock('@/blocks/registry', () => ({
  getAllBlocks: mockGetAllBlocks,
  getBlock: mockGetBlock,
}))

vi.mock('@/lib/permission-groups/resolve.server', () => ({
  getUserPermissionConfig: mockGetUserPermissionConfig,
}))

vi.mock('@/lib/integrations/availability.server', () => ({
  isIntegrationDeploymentAvailableForVisibility: mockIsIntegrationDeploymentAvailable,
}))

import { getTriggerBlocksServerTool } from '@/lib/copilot/tools/server/blocks/get-trigger-blocks'

describe('get trigger blocks', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    const blocks = [
      { type: 'start_trigger', category: 'triggers', subBlocks: [] },
      { type: 'slack', category: 'tools', triggerAllowed: true, subBlocks: [] },
      { type: 'notion', category: 'tools', triggerAllowed: true, subBlocks: [] },
    ]
    mockGetAllBlocks.mockReturnValue(blocks)
    mockGetBlock.mockImplementation((type: string) => blocks.find((block) => block.type === type))
    mockGetUserPermissionConfig.mockResolvedValue({ allowedIntegrations: ['slack'] })
    mockIsIntegrationDeploymentAvailable.mockReturnValue(true)
  })

  it('keeps the start trigger while filtering non-exempt integrations', async () => {
    const result = await getTriggerBlocksServerTool.execute(
      {},
      { userId: 'user-1', workspaceId: 'workspace-1' }
    )

    expect(result.triggerBlockIds).toEqual(['slack', 'start_trigger'])
  })
})
