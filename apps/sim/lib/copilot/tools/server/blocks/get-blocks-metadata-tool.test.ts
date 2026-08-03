/**
 * @vitest-environment node
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockGetUserPermissionConfig, mockIsIntegrationDeploymentAvailable } = vi.hoisted(() => ({
  mockGetUserPermissionConfig: vi.fn(),
  mockIsIntegrationDeploymentAvailable: vi.fn(() => true),
}))

vi.mock('@/ee/access-control/utils/permission-check', () => ({
  getUserPermissionConfig: mockGetUserPermissionConfig,
}))

vi.mock('@/lib/integrations/availability.server', () => ({
  isIntegrationDeploymentAvailableForVisibility: mockIsIntegrationDeploymentAvailable,
}))

import {
  computeBlockLevelInputs,
  getBlocksMetadataServerTool,
} from '@/lib/copilot/tools/server/blocks/get-blocks-metadata-tool'
import { MothershipBlock } from '@/blocks/blocks/mothership'

describe('get blocks metadata', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetUserPermissionConfig.mockResolvedValue({ allowedIntegrations: ['slack'] })
    mockIsIntegrationDeploymentAvailable.mockReturnValue(true)
  })

  it('omits server-only Mothership policy inputs from block metadata definitions', () => {
    const definitions = computeBlockLevelInputs(MothershipBlock)

    expect(definitions).not.toHaveProperty('secretScope')
    expect(definitions).not.toHaveProperty('mountedSecrets')
  })

  it('keeps access-control-exempt and special blocks under a restrictive allowlist', async () => {
    const result = await getBlocksMetadataServerTool.execute(
      { blockIds: ['start_trigger', 'loop', 'slack', 'notion'] },
      { userId: 'user-1', workspaceId: 'workspace-1' }
    )

    expect(result.metadata).toHaveProperty('start_trigger')
    expect(result.metadata).toHaveProperty('loop')
    expect(result.metadata).toHaveProperty('slack')
    expect(result.metadata).not.toHaveProperty('notion')
  })
})
