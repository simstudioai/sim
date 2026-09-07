/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  extractResourcesFromToolResult: vi.fn(),
  persistChatResources: vi.fn(() => Promise.resolve()),
  setAttributes: vi.fn(),
  changeStoredChatResources: vi.fn().mockResolvedValue([]),
}))

vi.mock('@/lib/mothership/resources/store', () => ({
  changeStoredChatResources: mocks.changeStoredChatResources,
}))

vi.mock('@/lib/mothership/request/otel', () => ({
  withCopilotSpan: (
    _name: string,
    _attributes: Record<string, unknown>,
    run: (span: { setAttributes: typeof mocks.setAttributes }) => Promise<void>
  ) => run({ setAttributes: mocks.setAttributes }),
}))

vi.mock('@/lib/mothership/resources/persistence', () => ({
  extractDeletedResourcesFromToolResult: vi.fn(() => []),
  extractResourcesFromToolResult: mocks.extractResourcesFromToolResult,
  hasDeleteCapability: vi.fn(() => false),
  isResourceToolName: vi.fn(() => true),
  persistChatResources: mocks.persistChatResources,
  removeChatResources: vi.fn(() => Promise.resolve()),
}))

import { MothershipStreamV1EventType } from '@/lib/mothership/generated/mothership-stream-v1'
import { handleResourceSideEffects } from '@/lib/mothership/request/tools/resources'
import type { MothershipResource } from '@/lib/mothership/resources/types'

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

    expect(mocks.changeStoredChatResources).toHaveBeenCalledWith('chat-1', {
      kind: 'clear-view',
      tableId: 'tbl-1',
      viewId: 'view-1',
    })
    expect(onEvent).toHaveBeenCalledWith({
      type: MothershipStreamV1EventType.resource,
      payload: {
        op: 'clear_view',
        resource: {
          type: 'table',
          id: 'tbl-1',
          viewId: 'view-1',
        },
      },
    })
  })
  it.each([
    { type: 'table', id: 'table', title: 'Contacts', viewId: 'active-view' },
    { type: 'file', id: 'file', title: 'Report', path: 'files/Reports/report.md' },
    { type: 'log', id: 'log-row', title: 'Run', executionId: 'workflow-run' },
  ] satisfies MothershipResource[])(
    'retains $type metadata while keeping the canonical resource identity',
    async (resource) => {
      const onEvent = vi.fn()
      await handleResourceSideEffects(
        'open_resource',
        undefined,
        { success: true, output: {}, resources: [resource] },
        { success: true, output: {}, resources: [{ ...resource, id: 'projected-id' }] },
        'chat',
        onEvent,
        () => false
      )
      expect(mocks.persistChatResources).toHaveBeenCalledWith('chat', [resource])
      expect(onEvent).toHaveBeenCalledWith({
        type: 'resource',
        payload: { op: 'upsert', resource },
      })
    }
  )
})
