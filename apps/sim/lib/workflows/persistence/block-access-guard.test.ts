import {
  permissionGroupsResolveMock,
  permissionGroupsResolveMockFns,
} from '@sim/testing/mocks/permission-groups-resolve.mock'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/permission-groups/resolve.server', () => permissionGroupsResolveMock)

import { findWithheldBlockType } from '@/lib/workflows/persistence/block-access-guard'

const mockGetUserPermissionConfig = permissionGroupsResolveMockFns.mockGetUserPermissionConfig

const PARAMS = { userId: 'user-1', workspaceId: 'workspace-1' }

describe('findWithheldBlockType', () => {
  beforeEach(() => {
    mockGetUserPermissionConfig.mockResolvedValue(null)
  })

  it('permits every block type when no permission group governs the workspace', async () => {
    await expect(
      findWithheldBlockType({ ...PARAMS, blocks: [{ type: 'gmail' }, { type: 'slack' }] })
    ).resolves.toBeNull()
  })

  it('names the first block type the allowlist withholds', async () => {
    mockGetUserPermissionConfig.mockResolvedValue({ allowedIntegrations: ['slack'] })

    await expect(
      findWithheldBlockType({
        ...PARAMS,
        blocks: [{ type: 'slack' }, { type: 'gmail' }, { type: 'notion' }],
      })
    ).resolves.toBe('gmail')
  })

  /**
   * Containers resolve to no integration, so an allowlist naming every
   * permitted one would still withhold them — and a graph the editor happily
   * builds could never be written back.
   */
  it('does not withhold loop and parallel containers', async () => {
    mockGetUserPermissionConfig.mockResolvedValue({ allowedIntegrations: ['slack'] })

    await expect(
      findWithheldBlockType({
        ...PARAMS,
        blocks: [{ type: 'loop' }, { type: 'parallel' }, { type: 'slack' }],
      })
    ).resolves.toBeNull()
  })
})
