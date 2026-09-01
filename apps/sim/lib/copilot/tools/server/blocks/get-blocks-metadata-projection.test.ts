/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Pins that the agent's block metadata still resolves tool params, outputs, and
 * the hosted-key note after the projection moved to the shared catalog layer and
 * off `@/tools/registry`.
 *
 * The sibling suite exercises this tool's gating against a mocked registry; this
 * one runs it against the real block registry and the real generated tool
 * metadata, because the thing worth proving is exactly that the metadata
 * artifacts can answer everything the executable registry used to.
 */
vi.unmock('@/blocks/registry')

const mocks = vi.hoisted(() => ({
  getUserPermissionConfig: vi.fn(),
  isDeploymentAvailable: vi.fn(() => true),
}))

vi.mock('@/lib/permission-groups/resolve.server', () => ({
  getUserPermissionConfig: mocks.getUserPermissionConfig,
}))

vi.mock('@/lib/integrations/availability.server', () => ({
  isIntegrationDeploymentAvailableForVisibility: mocks.isDeploymentAvailable,
}))

import { getBlocksMetadataServerTool } from '@/lib/copilot/tools/server/blocks/get-blocks-metadata-tool'

/**
 * The projection under test reads real tool params and outputs, which the global
 * `@/tools/metadata` and `@/tools/metadata-outputs` mocks in vitest.setup.ts empty.
 */
vi.unmock('@/tools/metadata')
vi.unmock('@/tools/metadata-outputs')

interface AgentBlockMetadata {
  blockType: string
  name: string
  description: string
  operations?: Record<
    string,
    { name: string; description?: string; inputs: { required: unknown[]; optional: unknown[] } }
  >
  inputs?: { required: unknown[]; optional: unknown[] }
}

describe('get_blocks_metadata against the real registries', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.getUserPermissionConfig.mockResolvedValue({ allowedIntegrations: null })
    mocks.isDeploymentAvailable.mockReturnValue(true)
  })

  it('resolves an integration block’s operations and their tool-derived inputs', async () => {
    const result = await getBlocksMetadataServerTool.execute(
      { blockIds: ['slack_v2'] },
      { userId: 'user-1', workspaceId: 'workspace-1' }
    )

    const slack = result.metadata.slack_v2 as AgentBlockMetadata
    expect(slack.blockType).toBe('slack_v2')
    expect(slack.name).toBe('Slack')

    const operations = slack.operations ?? {}
    expect(Object.keys(operations).length).toBeGreaterThan(0)
    for (const [operationId, operation] of Object.entries(operations)) {
      expect(operation.name, operationId).toBeTruthy()
      expect(operation.inputs, operationId).toBeDefined()
    }

    /**
     * The point of the rewrite: these inputs come from the generated tool
     * metadata. An empty set everywhere means the tool params stopped being
     * resolved, which is what reaching for the executable registry used to buy.
     */
    const parameterCount = Object.values(operations).reduce(
      (total, operation) =>
        total + operation.inputs.required.length + operation.inputs.optional.length,
      0
    )
    expect(parameterCount).toBeGreaterThan(0)
  })

  it('still describes the control-flow blocks it defines itself', async () => {
    const result = await getBlocksMetadataServerTool.execute(
      { blockIds: ['loop'] },
      { userId: 'user-1', workspaceId: 'workspace-1' }
    )

    const loop = result.metadata.loop as AgentBlockMetadata
    expect(loop.blockType).toBe('loop')
    expect(loop.inputs?.required.length).toBeGreaterThan(0)
  })
})
