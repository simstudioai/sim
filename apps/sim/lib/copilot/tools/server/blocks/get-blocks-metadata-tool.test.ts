/**
 * @vitest-environment node
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockGetUserPermissionConfig, mockIsIntegrationDeploymentAvailable } = vi.hoisted(() => ({
  mockGetUserPermissionConfig: vi.fn(),
  mockIsIntegrationDeploymentAvailable: vi.fn(() => true),
}))

vi.mock('@/lib/permission-groups/resolve.server', () => ({
  getUserPermissionConfig: mockGetUserPermissionConfig,
}))

vi.mock('@/lib/integrations/availability.server', () => ({
  isIntegrationDeploymentAvailableForVisibility: mockIsIntegrationDeploymentAvailable,
}))

import { computeBlockLevelInputs } from '@/lib/catalog/projection/block-detail'
import { getBlocksMetadataServerTool } from '@/lib/copilot/tools/server/blocks/get-blocks-metadata-tool'
import { MothershipBlock } from '@/blocks/blocks/mothership'
import { getBlock } from '@/blocks/registry'
import type { BlockConfig } from '@/blocks/types'

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

  /**
   * A sub-block `condition` declared as a function is invoked during projection.
   * A throwing one is an authoring defect worth surfacing, but it must cost the
   * agent one block rather than every block it asked for — the projection call
   * used to sit outside the per-block guard, so one bad condition emptied the
   * whole response.
   */
  it('drops only the block whose projection throws', async () => {
    const healthy = {
      type: 'slack',
      name: 'Slack',
      description: 'Send messages.',
      category: 'tools',
      bgColor: '#000000',
      icon: () => null,
      subBlocks: [],
      tools: { access: [] },
      inputs: {},
      outputs: {},
    } as unknown as BlockConfig
    const poisoned = {
      ...healthy,
      type: 'slack_broken',
      name: 'Broken',
      subBlocks: [
        {
          id: 'text',
          type: 'long-input',
          condition: () => {
            throw new Error('condition dereferences values')
          },
        },
      ],
    } as unknown as BlockConfig

    mockGetUserPermissionConfig.mockResolvedValue({ allowedIntegrations: null })
    vi.mocked(getBlock).mockImplementation((type: string) =>
      type === 'slack_broken' ? poisoned : healthy
    )

    const result = await getBlocksMetadataServerTool.execute(
      { blockIds: ['slack_broken', 'slack'] },
      { userId: 'user-1', workspaceId: 'workspace-1' }
    )

    expect(result.metadata).not.toHaveProperty('slack_broken')
    expect(result.metadata).toHaveProperty('slack')
  })

  /**
   * A two-operation block standing in for a real integration: the projection
   * resolves each operation to a tool id through `tools.config.tool`, which is
   * what the group's denylist is written against.
   */
  const gatedBlock = {
    type: 'slack',
    name: 'Slack',
    description: 'Send messages.',
    category: 'tools',
    bgColor: '#000000',
    icon: () => null,
    subBlocks: [
      {
        id: 'operation',
        title: 'Operation',
        type: 'dropdown',
        options: [
          { label: 'Send Message', id: 'send' },
          { label: 'Create Canvas', id: 'canvas' },
        ],
      },
    ],
    tools: {
      access: ['slack_message', 'slack_canvas'],
      config: {
        tool: ({ operation }: { operation?: string }) =>
          operation === 'canvas' ? 'slack_canvas' : 'slack_message',
      },
    },
    inputs: {},
    outputs: {},
  } as unknown as BlockConfig

  it('withholds an operation whose tool the group denies', async () => {
    mockGetUserPermissionConfig.mockResolvedValue({
      allowedIntegrations: ['slack'],
      deniedTools: ['slack_canvas'],
    })
    vi.mocked(getBlock).mockReturnValue(gatedBlock)

    const result = await getBlocksMetadataServerTool.execute(
      { blockIds: ['slack'] },
      { userId: 'user-1', workspaceId: 'workspace-1' }
    )

    const slack = result.metadata.slack as { operations: Record<string, unknown> }

    expect(Object.keys(slack.operations)).toEqual(['send'])
  })

  it('leaves the projection untouched when the group denies nothing', async () => {
    mockGetUserPermissionConfig.mockResolvedValue({
      allowedIntegrations: ['slack'],
      deniedTools: [],
    })
    vi.mocked(getBlock).mockReturnValue(gatedBlock)

    const result = await getBlocksMetadataServerTool.execute(
      { blockIds: ['slack'] },
      { userId: 'user-1', workspaceId: 'workspace-1' }
    )

    const slack = result.metadata.slack as { operations: Record<string, unknown> }
    expect(Object.keys(slack.operations).sort()).toEqual(['canvas', 'send'])
  })

  /**
   * A block whose operation ids ARE its tool ids, declaring no
   * `tools.config.tool`. The catalog projection cannot fill `operation.toolId`
   * for it, so gating on that field alone would publish every denied operation.
   */
  const selectorlessBlock = {
    type: 'sqs',
    name: 'SQS',
    description: 'Queue.',
    category: 'tools',
    bgColor: '#000000',
    icon: () => null,
    subBlocks: [
      {
        id: 'operation',
        title: 'Operation',
        type: 'dropdown',
        options: [
          { label: 'Send', id: 'sqs_send' },
          { label: 'Receive', id: 'sqs_receive' },
        ],
      },
    ],
    tools: { access: ['sqs_send', 'sqs_receive'] },
    inputs: {},
    outputs: {},
  } as unknown as BlockConfig

  it('withholds a denied operation on a block that declares no tool selector', async () => {
    mockGetUserPermissionConfig.mockResolvedValue({
      allowedIntegrations: ['sqs'],
      deniedTools: ['sqs_receive'],
    })
    vi.mocked(getBlock).mockReturnValue(selectorlessBlock)

    const result = await getBlocksMetadataServerTool.execute(
      { blockIds: ['sqs'] },
      { userId: 'user-1', workspaceId: 'workspace-1' }
    )

    const sqs = result.metadata.sqs as { operations: Record<string, unknown> }
    expect(Object.keys(sqs.operations)).toEqual(['sqs_send'])
  })

  it('withholds a block whose every operation the group denies', async () => {
    mockGetUserPermissionConfig.mockResolvedValue({
      allowedIntegrations: ['slack'],
      deniedTools: ['slack_message', 'slack_canvas'],
    })
    vi.mocked(getBlock).mockReturnValue(gatedBlock)

    const result = await getBlocksMetadataServerTool.execute(
      { blockIds: ['slack'] },
      { userId: 'user-1', workspaceId: 'workspace-1' }
    )

    expect(result.metadata).not.toHaveProperty('slack')
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
