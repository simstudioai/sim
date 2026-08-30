/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/blocks/registry-maps', () => ({
  BLOCK_REGISTRY: {
    slack: {
      type: 'slack',
      tools: {
        access: ['slack_message_v1', 'slack_canvas_v1'],
        config: {
          tool: ({ operation }: { operation?: string }) =>
            operation === 'canvas' ? 'slack_canvas_v1' : 'slack_message_v1',
        },
      },
      subBlocks: [
        {
          id: 'operation',
          type: 'dropdown',
          options: [
            { label: 'Send Message', id: 'send' },
            { label: 'Create Canvas', id: 'canvas' },
          ],
        },
      ],
    },
    gmail: {
      type: 'gmail',
      tools: { access: ['gmail_send_v1'] },
      subBlocks: [],
    },
    /**
     * Multi-tool block with no operation selector: its operation ids ARE its
     * tool ids, so there are no dropdown options to filter.
     */
    sqs: {
      type: 'sqs',
      tools: { access: ['sqs_send_v1', 'sqs_receive_v1'] },
      subBlocks: [],
    },
  },
}))

vi.mock('@/tools/registry', () => ({
  tools: {
    slack_message_v1: { name: 'Send Message' },
    slack_canvas_v1: { name: 'Create Canvas' },
    gmail_send_v1: { name: 'Send Email' },
    sqs_send_v1: { name: 'Send' },
    sqs_receive_v1: { name: 'Receive' },
  },
}))

vi.mock('@/lib/core/config/env-flags', () => ({
  getAllowedIntegrationsFromEnv: () => null,
}))

vi.mock('@/lib/integrations/availability.server', () => ({
  isIntegrationDeploymentAvailableForVisibility: () => true,
}))

import {
  projectIntegrationToolsForViewer,
  resolveDeniedBlockOperations,
} from '@/lib/mothership/integration-tool-projection'
import { resetExposedIntegrationToolsCache } from '@/lib/mothership/integration-tools'

function toolIds(config: Parameters<typeof projectIntegrationToolsForViewer>[1]): string[] {
  return projectIntegrationToolsForViewer(null, config)
    .tools.map((tool) => tool.toolId)
    .sort()
}

describe('projectIntegrationToolsForViewer', () => {
  beforeEach(() => {
    resetExposedIntegrationToolsCache()
  })

  it('exposes everything to a viewer with no permission group', () => {
    expect(toolIds(null)).toEqual([
      'gmail_send_v1',
      'slack_canvas_v1',
      'slack_message_v1',
      'sqs_receive_v1',
      'sqs_send_v1',
    ])
  })

  it('withholds a tool the group denies while keeping its siblings', () => {
    expect(toolIds({ allowedIntegrations: null, deniedTools: ['slack_canvas_v1'] })).toEqual([
      'gmail_send_v1',
      'slack_message_v1',
      'sqs_receive_v1',
      'sqs_send_v1',
    ])
  })

  it('applies the block allowlist and the tool denylist together', () => {
    expect(toolIds({ allowedIntegrations: ['slack'], deniedTools: ['slack_canvas_v1'] })).toEqual([
      'slack_message_v1',
    ])
  })

  it('reports the allowed block types and the tool gate it applied', () => {
    const projection = projectIntegrationToolsForViewer(null, {
      allowedIntegrations: ['Slack'],
      deniedTools: ['slack_canvas_v1'],
    })

    expect(projection.allowedBlockTypes).toEqual(new Set(['slack']))
    expect(projection.isToolAllowed('slack_canvas_v1')).toBe(false)
    expect(projection.isToolAllowed('slack_message_v1')).toBe(true)
  })

  it('leaves the gate unrestricted when the group denies nothing', () => {
    const projection = projectIntegrationToolsForViewer(null, {
      allowedIntegrations: null,
      deniedTools: [],
    })

    expect(projection.allowedBlockTypes).toBeNull()
    expect(projection.isToolAllowed('slack_canvas_v1')).toBe(true)
  })
})

describe('resolveDeniedBlockOperations', () => {
  const allow = (denied: string[]) => (toolId: string) => !denied.includes(toolId)

  it('does no work when the group denies nothing', () => {
    const resolved = resolveDeniedBlockOperations([], allow([]))

    expect(resolved.needsProjection.size).toBe(0)
    expect(resolved.fullyDenied.size).toBe(0)
  })

  it('reports the operation ids to withhold from a partly denied block', () => {
    const denied = ['slack_canvas_v1']
    const resolved = resolveDeniedBlockOperations(denied, allow(denied))

    expect(resolved.needsProjection.get('slack')).toEqual(new Set(['canvas']))
    expect(resolved.fullyDenied.has('slack')).toBe(false)
  })

  it('withholds a block whose every operation is denied', () => {
    const denied = ['slack_message_v1', 'slack_canvas_v1']
    const resolved = resolveDeniedBlockOperations(denied, allow(denied))

    expect(resolved.fullyDenied.has('slack')).toBe(true)
    expect(resolved.needsProjection.has('slack')).toBe(false)
  })

  it('withholds a single-tool block whose only tool is denied', () => {
    const denied = ['gmail_send_v1']
    const resolved = resolveDeniedBlockOperations(denied, allow(denied))

    expect(resolved.fullyDenied.has('gmail')).toBe(true)
  })

  it('reprojects a selector-less block so its tool list drops the denied id', () => {
    const denied = ['sqs_receive_v1']
    const resolved = resolveDeniedBlockOperations(denied, allow(denied))

    expect(resolved.needsProjection.get('sqs')).toEqual(new Set())
    expect(resolved.fullyDenied.has('sqs')).toBe(false)
  })

  it('ignores blocks that own no denied tool', () => {
    const denied = ['slack_canvas_v1']
    const resolved = resolveDeniedBlockOperations(denied, allow(denied))

    expect(resolved.needsProjection.has('gmail')).toBe(false)
    expect(resolved.needsProjection.has('sqs')).toBe(false)
  })
})
