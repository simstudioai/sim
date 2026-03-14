/**
 * @vitest-environment node
 */
import { loggerMock } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockToolsChannel, mockWorkflowToolsChannel } = vi.hoisted(() => {
  const mockToolsChannel = {
    publish: vi.fn(),
    subscribe: vi.fn(() => vi.fn()),
    dispose: vi.fn(),
  }
  const mockWorkflowToolsChannel = {
    publish: vi.fn(),
    subscribe: vi.fn(() => vi.fn()),
    dispose: vi.fn(),
  }
  return { mockToolsChannel, mockWorkflowToolsChannel }
})

vi.mock('@sim/logger', () => loggerMock)
vi.mock('@/lib/events/pubsub', () => ({
  createPubSubChannel: vi.fn((config: { label: string }) => {
    if (config.label === 'mcp-tools') return mockToolsChannel
    if (config.label === 'mcp-workflow-tools') return mockWorkflowToolsChannel
    return null
  }),
}))

import { mcpPubSub } from '@/lib/mcp/pubsub'

beforeEach(() => {
  vi.clearAllMocks()
})

describe('RedisMcpPubSub', () => {
  it('delegates publishToolsChanged to the tools channel', () => {
    const event = {
      serverId: 'srv-1',
      serverName: 'Test',
      workspaceId: 'ws-1',
      timestamp: Date.now(),
    }

    mcpPubSub.publishToolsChanged(event)

    expect(mockToolsChannel.publish).toHaveBeenCalledWith(event)
  })

  it('delegates publishWorkflowToolsChanged to the workflow tools channel', () => {
    const event = {
      workflowId: 'wf-1',
      workspaceId: 'ws-1',
      timestamp: Date.now(),
    }

    mcpPubSub.publishWorkflowToolsChanged(event)

    expect(mockWorkflowToolsChannel.publish).toHaveBeenCalledWith(event)
  })

  it('delegates onToolsChanged to the tools channel subscribe', () => {
    const handler = vi.fn()
    const mockUnsub = vi.fn()
    mockToolsChannel.subscribe.mockReturnValueOnce(mockUnsub)

    const unsub = mcpPubSub.onToolsChanged(handler)

    expect(mockToolsChannel.subscribe).toHaveBeenCalledWith(handler)
    expect(unsub).toBe(mockUnsub)
  })

  it('delegates onWorkflowToolsChanged to the workflow tools channel subscribe', () => {
    const handler = vi.fn()
    const mockUnsub = vi.fn()
    mockWorkflowToolsChannel.subscribe.mockReturnValueOnce(mockUnsub)

    const unsub = mcpPubSub.onWorkflowToolsChanged(handler)

    expect(mockWorkflowToolsChannel.subscribe).toHaveBeenCalledWith(handler)
    expect(unsub).toBe(mockUnsub)
  })

  describe('dispose', () => {
    it('calls dispose on both channels', () => {
      mcpPubSub.dispose()

      expect(mockToolsChannel.dispose).toHaveBeenCalledTimes(1)
      expect(mockWorkflowToolsChannel.dispose).toHaveBeenCalledTimes(1)
    })
  })
})
