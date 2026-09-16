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
    {
      type: 'search',
      id: 'search:organization:org',
      title: 'Search results',
      search: {
        query: 'policy',
        scope: { kind: 'organization', organizationId: 'org' },
        filters: { source: 'slack' },
        topK: 7,
      },
    },
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
  it.each(['workspace-a', 'workspace-b'])(
    'addresses extracted exports to admitted %s',
    async (workspaceId) => {
      const resource = { type: 'file' as const, id: 'export', title: 'decisions.csv' }
      mocks.extractResourcesFromToolResult.mockReturnValue([resource])
      const onEvent = vi.fn()
      await handleResourceSideEffects(
        'run_function',
        undefined,
        { success: true, output: {} },
        { success: true, output: {} },
        'org-chat',
        onEvent,
        () => false,
        workspaceId
      )
      expect(mocks.persistChatResources).toHaveBeenCalledWith('org-chat', [
        { ...resource, workspaceId },
      ])
      expect(onEvent).toHaveBeenCalledWith({
        type: 'resource',
        payload: {
          op: 'upsert',
          resource: { ...resource, workspaceId },
        },
      })
    }
  )
})

it('emits authorized Search results beside the persisted address, never inside it', async () => {
  const resource: MothershipResource = {
    type: 'search',
    id: 'search:organization:org',
    title: 'Search results',
    search: { query: 'policy', scope: { kind: 'organization', organizationId: 'org' } },
  }
  const data = { query: 'policy', results: [], retrieval: { status: 'complete', timedOutLegs: [] } }
  const result = { success: true, output: { success: true, data }, resources: [resource] }
  const onEvent = vi.fn()
  await handleResourceSideEffects(
    'search_workspace',
    {},
    result,
    result,
    'chat',
    onEvent,
    () => false,
    undefined,
    'reader'
  )
  expect(mocks.persistChatResources).toHaveBeenLastCalledWith('chat', [resource])
  expect(onEvent).toHaveBeenCalledWith({
    type: 'resource',
    payload: { op: 'upsert', resource, searchResult: { actorUserId: 'reader', data } },
  })
})
