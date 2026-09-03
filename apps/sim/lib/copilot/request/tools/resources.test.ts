/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  extractResourcesFromToolResult: vi.fn(),
  persistChatResources: vi.fn(() => Promise.resolve()),
  setAttributes: vi.fn(),
}))

vi.mock('@/lib/copilot/request/otel', () => ({
  withCopilotSpan: (
    _name: string,
    _attributes: Record<string, unknown>,
    run: (span: { setAttributes: typeof mocks.setAttributes }) => Promise<void>
  ) => run({ setAttributes: mocks.setAttributes }),
}))

vi.mock('@/lib/copilot/resources/persistence', () => ({
  extractDeletedResourcesFromToolResult: vi.fn(() => []),
  extractResourcesFromToolResult: mocks.extractResourcesFromToolResult,
  hasDeleteCapability: vi.fn(() => false),
  isResourceToolName: vi.fn(() => true),
  persistChatResources: mocks.persistChatResources,
  removeChatResources: vi.fn(() => Promise.resolve()),
}))

import {
  MothershipStreamV1EventType,
  MothershipStreamV1ResourceOp,
} from '@/lib/copilot/generated/mothership-stream-v1'
import { handleResourceSideEffects } from '@/lib/copilot/request/tools/resources'

describe('handleResourceSideEffects', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('persists and emits the explicit saved-view pin clear directive', async () => {
    mocks.extractResourcesFromToolResult.mockReturnValue([
      {
        type: 'table',
        id: 'tbl-1',
        title: 'Invoices',
        clearViewId: true,
      },
    ])
    const onEvent = vi.fn()

    await handleResourceSideEffects(
      'table_views',
      { operation: 'delete_view', args: { tableId: 'tbl-1', viewId: 'view-1' } },
      { success: true, output: {} },
      { success: true, output: {} },
      'chat-1',
      onEvent,
      () => false
    )

    expect(mocks.persistChatResources).toHaveBeenCalledWith('chat-1', [
      {
        type: 'table',
        id: 'tbl-1',
        title: 'Invoices',
        clearViewId: true,
      },
    ])
    expect(onEvent).toHaveBeenCalledWith({
      type: MothershipStreamV1EventType.resource,
      payload: {
        op: MothershipStreamV1ResourceOp.upsert,
        resource: {
          type: 'table',
          id: 'tbl-1',
          title: 'Invoices',
          clearViewId: true,
        },
      },
    })
  })
})
