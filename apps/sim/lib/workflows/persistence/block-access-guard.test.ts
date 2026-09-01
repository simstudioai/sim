/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getUserPermissionConfig: vi.fn(),
}))

vi.mock('@/lib/permission-groups/resolve.server', () => ({
  getUserPermissionConfig: mocks.getUserPermissionConfig,
}))

import { findWithheldBlockType } from '@/lib/workflows/persistence/block-access-guard'

const PARAMS = { userId: 'user-1', workspaceId: 'workspace-1' }

describe('findWithheldBlockType', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.getUserPermissionConfig.mockResolvedValue(null)
  })

  it('permits every block type when no permission group governs the workspace', async () => {
    await expect(
      findWithheldBlockType({ ...PARAMS, blocks: [{ type: 'gmail' }, { type: 'slack' }] })
    ).resolves.toBeNull()
  })

  it('permits every block type when the allowlist names every integration', async () => {
    mocks.getUserPermissionConfig.mockResolvedValue({ allowedIntegrations: null })

    await expect(
      findWithheldBlockType({ ...PARAMS, blocks: [{ type: 'gmail' }] })
    ).resolves.toBeNull()
  })

  it('names the first block type the allowlist withholds', async () => {
    mocks.getUserPermissionConfig.mockResolvedValue({ allowedIntegrations: ['slack'] })

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
    mocks.getUserPermissionConfig.mockResolvedValue({ allowedIntegrations: ['slack'] })

    await expect(
      findWithheldBlockType({
        ...PARAMS,
        blocks: [{ type: 'loop' }, { type: 'parallel' }, { type: 'slack' }],
      })
    ).resolves.toBeNull()
  })
})
