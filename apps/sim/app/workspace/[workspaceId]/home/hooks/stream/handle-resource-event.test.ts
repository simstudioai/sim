/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { resourceScopeKey } from '@/lib/core/resource-scope'
import { knowledgeKeys } from '@/hooks/queries/utils/knowledge-keys'

const mocks = vi.hoisted(() => ({
  invalidateResourceQueries: vi.fn(),
  removeWorkflowFromActiveCache: vi.fn(),
  notifyWorkflowExternalUpdate: vi.fn(),
}))
vi.mock('@/lib/workflows/external-update', () => ({
  notifyWorkflowExternalUpdate: mocks.notifyWorkflowExternalUpdate,
}))

vi.mock(
  '@/app/workspace/[workspaceId]/home/components/mothership-view/components/resource-registry',
  () => ({ invalidateResourceQueries: mocks.invalidateResourceQueries })
)
vi.mock('@/hooks/queries/utils/workflow-cache', () => ({
  removeWorkflowFromActiveCache: mocks.removeWorkflowFromActiveCache,
}))

import type { PersistedStreamEventEnvelope } from '@/lib/mothership/request/session/contract'
import { toStreamBatchEvent } from '@/lib/mothership/request/session/types'
import { handleResourceEvent } from '@/app/workspace/[workspaceId]/home/hooks/stream/handle-resource-event'
import type { StreamLoopContext } from '@/app/workspace/[workspaceId]/home/hooks/stream/stream-context'
import { makeStreamLoopDeps } from '@/app/workspace/[workspaceId]/home/hooks/stream/stream-test-helpers'
import type { MothershipResource } from '@/app/workspace/[workspaceId]/home/types'
import { useTableViewPinStore } from '@/stores/table/view-pin/store'

type ResourceEvent = Extract<PersistedStreamEventEnvelope, { type: 'resource' }>

function removeEvent(type: 'workflow' | 'file', id: string): ResourceEvent {
  return {
    type: 'resource',
    v: 1,
    seq: 1,
    ts: '',
    stream: { streamId: 's', cursor: '1' },
    payload: { op: 'remove', resource: { type, id, title: id } },
  }
}

function browserUpsertEvent(id: string, title: string): ResourceEvent {
  return {
    type: 'resource',
    v: 1,
    seq: 1,
    ts: '',
    stream: { streamId: 's', cursor: '1' },
    payload: { op: 'upsert', resource: { type: 'browser', id, title } },
  }
}

function terminalUpsertEvent(id: string, title: string): PersistedStreamEventEnvelope {
  return {
    type: 'resource',
    v: 1,
    seq: 1,
    ts: '',
    stream: { streamId: 's', cursor: '1' },
    payload: { op: 'upsert', resource: { type: 'terminal', id, title } },
  } as PersistedStreamEventEnvelope
}

describe('handleResourceEvent removal', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('refreshes a collection without fabricating a tab or changing focus', () => {
    const deps = makeStreamLoopDeps()
    const event: ResourceEvent = {
      ...removeEvent('file', 'unused'),
      payload: { op: 'refresh', resource: { type: 'file' } },
    }
    handleResourceEvent({ deps } as StreamLoopContext, event)
    expect(mocks.invalidateResourceQueries).toHaveBeenCalledWith(
      deps.queryClient,
      'ws-1',
      'file',
      undefined
    )
    expect(deps.setResources).not.toHaveBeenCalled()
    expect(deps.addResource).not.toHaveBeenCalled()
    expect(deps.setActiveResourceId).not.toHaveBeenCalled()
  })

  it('shows a committed table/view immediately without a second persistence request', () => {
    const onResourceEvent = vi.fn()
    const deps = makeStreamLoopDeps({ onResourceEventRef: { current: onResourceEvent } })
    const event: ResourceEvent = {
      ...removeEvent('file', 'unused'),
      payload: {
        op: 'upsert',
        effectId: 'run:tool:0',
        resource: { type: 'table', id: 'table', title: 'Contacts', viewId: 'active' },
      },
    }
    handleResourceEvent({ deps } as StreamLoopContext, event)
    expect(deps.addResource).not.toHaveBeenCalled()
    expect(deps.setResources).toHaveBeenCalled()
    expect(onResourceEvent).toHaveBeenCalledWith('table', { tableViewId: 'active' })
  })

  it.each(['workflow', 'table', 'file', 'knowledgebase', 'log'] as const)(
    'opens an authorized %s read without invalidating or reconciling editable content',
    (type) => {
      const onResourceEvent = vi.fn()
      const deps = makeStreamLoopDeps({ onResourceEventRef: { current: onResourceEvent } })
      handleResourceEvent({ deps } as StreamLoopContext, {
        ...removeEvent('file', 'unused'),
        scope: { parentToolCallId: 'child', agentId: 'agent' },
        payload: {
          op: 'upsert',
          readOnly: true,
          effectId: 'read:0',
          resource: { type, id: 'addressed', title: 'Addressed resource' },
        },
      })
      expect(onResourceEvent).toHaveBeenCalledWith('addressed')
      expect(deps.setResources).toHaveBeenCalled()
      expect(deps.addResource).not.toHaveBeenCalled()
      expect(mocks.invalidateResourceQueries).not.toHaveBeenCalled()
      expect(mocks.notifyWorkflowExternalUpdate).not.toHaveBeenCalled()
      expect(deps.ensureWorkflowInRegistry).not.toHaveBeenCalled()
    }
  )

  it('keeps replayed reads focus-free without disturbing a dirty workflow', () => {
    const onResourceEvent = vi.fn()
    const deps = makeStreamLoopDeps({
      chatIdRef: { current: 'chat' },
      onResourceEventRef: { current: onResourceEvent },
    })
    handleResourceEvent({ deps } as StreamLoopContext, {
      ...removeEvent('workflow', 'wf'),
      payload: {
        op: 'upsert',
        readOnly: true,
        replay: true,
        resource: { type: 'workflow', id: 'wf' },
      },
    })
    expect(onResourceEvent).not.toHaveBeenCalled()
    expect(deps.setResources).not.toHaveBeenCalled()
    expect(mocks.invalidateResourceQueries).not.toHaveBeenCalled()
    expect(mocks.notifyWorkflowExternalUpdate).not.toHaveBeenCalled()
    expect(deps.queryClient.invalidateQueries).toHaveBeenCalledWith({
      queryKey: ['mothership-chats', 'detail', 'chat'],
    })
  })

  it('still reconciles a committed workflow edit after opening it for a read', () => {
    const deps = makeStreamLoopDeps()
    const event = removeEvent('workflow', 'wf')
    handleResourceEvent(
      { deps } as StreamLoopContext,
      {
        ...event,
        payload: { op: 'upsert', readOnly: true, resource: event.payload.resource },
      } as ResourceEvent
    )
    handleResourceEvent(
      { deps } as StreamLoopContext,
      { ...event, payload: { op: 'upsert', resource: event.payload.resource } } as ResourceEvent
    )
    expect(mocks.invalidateResourceQueries).toHaveBeenCalledTimes(1)
    expect(mocks.notifyWorkflowExternalUpdate).toHaveBeenCalledExactlyOnceWith('wf')
  })

  it.each([
    { op: 'upsert', effectId: 's:tool:0' },
    { op: 'remove', effectId: 's:tool:0' },
    { op: 'upsert', effectId: undefined },
    { op: 'remove', effectId: undefined },
  ] as const)(
    'replayed $op (worker receipt: $effectId) refreshes saved panels without mutating user choices',
    ({ op, effectId }) => {
      const onResourceEvent = vi.fn()
      const deps = makeStreamLoopDeps({
        chatIdRef: { current: 'chat' },
        onResourceEventRef: { current: onResourceEvent },
      })
      const ctx = { deps } as StreamLoopContext
      const event: Extract<PersistedStreamEventEnvelope, { type: 'resource' }> = {
        type: 'resource',
        v: 1,
        seq: 1,
        ts: '',
        stream: { streamId: 's' },
        payload: {
          op,
          effectId,
          resource: { type: 'workflow', id: 'wf', title: 'Workflow' },
        },
      }
      const replay = toStreamBatchEvent(event).event
      if (replay.type !== 'resource') throw new Error('Expected resource replay')
      handleResourceEvent(ctx, replay)
      expect(deps.addResource).not.toHaveBeenCalled()
      expect(deps.removeResource).not.toHaveBeenCalled()
      expect(onResourceEvent).not.toHaveBeenCalled()
      expect(mocks.removeWorkflowFromActiveCache).not.toHaveBeenCalled()
      expect(deps.queryClient.invalidateQueries).toHaveBeenCalledWith({
        queryKey: ['mothership-chats', 'detail', 'chat'],
      })
    }
  )

  it('closes a deleted workflow tab and removes it from the established workflow cache', () => {
    const deps = makeStreamLoopDeps()
    const ctx = { deps } as StreamLoopContext

    handleResourceEvent(ctx, removeEvent('workflow', 'wf-1'))

    expect(deps.removeResource).toHaveBeenCalledWith('workflow', 'wf-1')
    expect(mocks.removeWorkflowFromActiveCache).toHaveBeenCalledWith(
      deps.queryClient,
      'ws-1',
      'wf-1'
    )
    expect(mocks.invalidateResourceQueries).toHaveBeenCalledWith(
      deps.queryClient,
      'ws-1',
      'workflow',
      'wf-1'
    )
  })

  it('closes other resource tabs through the same remove event path', () => {
    const deps = makeStreamLoopDeps()
    const ctx = { deps } as StreamLoopContext

    handleResourceEvent(ctx, removeEvent('file', 'file-1'))

    expect(deps.removeResource).toHaveBeenCalledWith('file', 'file-1')
    expect(mocks.removeWorkflowFromActiveCache).not.toHaveBeenCalled()
    expect(mocks.invalidateResourceQueries).toHaveBeenCalledWith(
      deps.queryClient,
      'ws-1',
      'file',
      'file-1'
    )
  })

  it('ignores browser events because browser tabs come from the desktop tab list', () => {
    const onResourceEvent = vi.fn()
    const deps = makeStreamLoopDeps({
      onResourceEventRef: { current: onResourceEvent },
    })
    const ctx = { deps } as StreamLoopContext

    handleResourceEvent(
      ctx,
      browserUpsertEvent('browser-session:slack-tab', 'mship-todo (Channel) - sim - Slack')
    )

    expect(deps.addResource).not.toHaveBeenCalled()
    expect(deps.setActiveResourceId).not.toHaveBeenCalled()
    expect(onResourceEvent).not.toHaveBeenCalled()
  })
  it('ignores terminal events because terminal tabs come from the desktop tab list', () => {
    const onResourceEvent = vi.fn()
    const deps = makeStreamLoopDeps({
      onResourceEventRef: { current: onResourceEvent },
    })
    const ctx = { deps } as StreamLoopContext

    handleResourceEvent(ctx, terminalUpsertEvent('terminal-session', 'Terminal'))

    expect(deps.addResource).not.toHaveBeenCalled()
    expect(deps.setActiveResourceId).not.toHaveBeenCalled()
    expect(onResourceEvent).not.toHaveBeenCalled()
  })
})

function tableUpsertEvent(id: string, viewId?: string): PersistedStreamEventEnvelope {
  return {
    type: 'resource',
    v: 1,
    seq: 1,
    ts: '',
    stream: { streamId: 's', cursor: '1' },
    payload: {
      op: 'upsert',
      resource: {
        type: 'table',
        id,
        title: 'Invoices',
        ...(viewId ? { viewId } : {}),
      },
    },
  } as PersistedStreamEventEnvelope
}

describe('handleResourceEvent saved-view pins', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useTableViewPinStore.getState().reset()
  })

  it.each(['deleted-view', 'newer-view'])(
    'clears only the matching pending pin when the current pin is %s',
    (viewId) => {
      useTableViewPinStore.getState().pin('tbl-1', viewId)
      const deps = makeStreamLoopDeps()
      const event: ResourceEvent = {
        ...removeEvent('file', 'unused'),
        payload: {
          op: 'clear_view',
          resource: { type: 'table', id: 'tbl-1', viewId: 'deleted-view' },
        },
      }

      handleResourceEvent({ deps } as StreamLoopContext, event)

      expect(useTableViewPinStore.getState().pins['tbl-1']?.viewId).toBe(
        viewId === 'deleted-view' ? undefined : 'newer-view'
      )
      expect(deps.addResource).not.toHaveBeenCalled()
    }
  )

  it('opens a closed table on the view and leaves a pin for the table to consume', () => {
    const onResourceEvent = vi.fn()
    const deps = makeStreamLoopDeps({ onResourceEventRef: { current: onResourceEvent } })
    const ctx = { deps } as StreamLoopContext

    handleResourceEvent(ctx, tableUpsertEvent('tbl-1', 'view-1'))

    expect(deps.addResource).toHaveBeenCalledWith({
      type: 'table',
      id: 'tbl-1',
      title: 'Invoices',
      viewId: 'view-1',
    })
    // The pin merge always runs; on a list that lacks the table it is a no-op.
    const updater = (deps.setResources as ReturnType<typeof vi.fn>).mock.calls[0][0] as (
      current: MothershipResource[]
    ) => MothershipResource[]
    const others: MothershipResource[] = [{ type: 'file', id: 'file-1', title: 'notes.md' }]
    expect(updater(others)).toBe(others)
    expect(useTableViewPinStore.getState().pins['tbl-1']?.viewId).toBe('view-1')
    expect(mocks.invalidateResourceQueries).toHaveBeenCalledWith(
      deps.queryClient,
      'ws-1',
      'table',
      'tbl-1'
    )
    expect(onResourceEvent).toHaveBeenCalledWith('tbl-1', { tableViewId: 'view-1' })
  })

  it('moves the pin on an already-open table so a remount and the live grid both follow', () => {
    const open: MothershipResource = {
      type: 'table',
      id: 'tbl-1',
      title: 'Invoices',
      viewId: 'view-1',
    }
    const deps = makeStreamLoopDeps({
      addResource: vi.fn(() => false),
      resourcesRef: { current: [open] },
    })
    const ctx = { deps } as StreamLoopContext

    handleResourceEvent(ctx, tableUpsertEvent('tbl-1', 'view-2'))

    const updater = (deps.setResources as ReturnType<typeof vi.fn>).mock.calls[0][0] as (
      current: MothershipResource[]
    ) => MothershipResource[]
    expect(updater([open])).toEqual([{ ...open, viewId: 'view-2' }])
    expect(useTableViewPinStore.getState().pins['tbl-1']?.viewId).toBe('view-2')
  })

  it('ignores a pin on anything but a table and leaves unpinned tables alone', () => {
    const deps = makeStreamLoopDeps({ addResource: vi.fn(() => false) })
    const ctx = { deps } as StreamLoopContext

    handleResourceEvent(ctx, tableUpsertEvent('tbl-1'))

    expect(deps.setResources).not.toHaveBeenCalled()
    expect(useTableViewPinStore.getState().pins['tbl-1']).toBeUndefined()
  })

  it('keeps a newer pending view when an older view is deleted', () => {
    const open: MothershipResource = {
      type: 'table',
      id: 'tbl-1',
      title: 'Invoices',
      viewId: 'view-2',
    }
    useTableViewPinStore.getState().pin('tbl-1', 'view-2')
    const deps = makeStreamLoopDeps({ resourcesRef: { current: [open] } })
    handleResourceEvent(
      { deps } as StreamLoopContext,
      {
        ...tableUpsertEvent('tbl-1'),
        payload: { op: 'clear_view', resource: { type: 'table', id: 'tbl-1', viewId: 'view-1' } },
      } as ResourceEvent
    )
    const updater = (deps.setResources as ReturnType<typeof vi.fn>).mock.calls[0][0] as (
      current: MothershipResource[]
    ) => MothershipResource[]
    expect(updater([open])).toEqual([open])
    expect(useTableViewPinStore.getState().pins['tbl-1']?.viewId).toBe('view-2')
    expect(deps.addResource).not.toHaveBeenCalled()
  })

  it('clears the stored and pending pin when the agent deletes a saved view', () => {
    const open: MothershipResource = {
      type: 'table',
      id: 'tbl-1',
      title: 'Invoices',
      viewId: 'view-1',
    }
    useTableViewPinStore.getState().pin('tbl-1', 'view-1')
    const deps = makeStreamLoopDeps({
      addResource: vi.fn(() => false),
      resourcesRef: { current: [open] },
    })
    const ctx = { deps } as StreamLoopContext

    handleResourceEvent(ctx, {
      ...tableUpsertEvent('tbl-1'),
      payload: { op: 'clear_view', resource: { type: 'table', id: 'tbl-1', viewId: 'view-1' } },
    } as ResourceEvent)

    expect(deps.addResource).not.toHaveBeenCalled()
    const updater = (deps.setResources as ReturnType<typeof vi.fn>).mock.calls[0][0] as (
      current: MothershipResource[]
    ) => MothershipResource[]
    expect(updater([open])).toEqual([{ type: 'table', id: 'tbl-1', title: 'Invoices' }])
    expect(useTableViewPinStore.getState().pins['tbl-1']).toBeUndefined()
  })
})

describe('organization resource stream', () => {
  beforeEach(() => vi.clearAllMocks())
  it('routes an edit to its owner without an active workspace and retains the panel address', () => {
    const deps = makeStreamLoopDeps({ workspaceId: undefined })
    const event: ResourceEvent = {
      ...removeEvent('workflow', 'wf'),
      payload: {
        op: 'upsert',
        resource: { type: 'workflow', id: 'wf', title: 'Build', workspaceId: 'owner' },
      },
    }
    handleResourceEvent({ deps } as StreamLoopContext, event)
    expect(mocks.invalidateResourceQueries).toHaveBeenCalledWith(
      deps.queryClient,
      'owner',
      'workflow',
      'wf'
    )
    expect(deps.addResource).toHaveBeenCalledWith(
      expect.objectContaining({ workspaceId: 'owner', id: 'wf' })
    )
    expect(deps.ensureWorkflowInRegistry).toHaveBeenCalledWith('wf', 'Build', 'owner')
  })
  it('never guesses a workspace for an unscoped org event or a mismatched workspace event', () => {
    const org = makeStreamLoopDeps({ workspaceId: undefined })
    handleResourceEvent({ deps: org } as StreamLoopContext, removeEvent('file', 'x'))
    const workspace = makeStreamLoopDeps()
    handleResourceEvent({ deps: workspace } as StreamLoopContext, {
      ...removeEvent('file', 'x'),
      payload: { op: 'remove', resource: { type: 'file', id: 'x', workspaceId: 'other' } },
    })
    expect(org.removeResource).not.toHaveBeenCalled()
    expect(workspace.removeResource).not.toHaveBeenCalled()
    expect(mocks.invalidateResourceQueries).not.toHaveBeenCalled()
  })
})

it('opens an organization Search tab and retains its address without requiring a workspace', () => {
  const callback = vi.fn()
  const deps = makeStreamLoopDeps({
    workspaceId: undefined,
    organizationId: 'org',
    onResourceEventRef: { current: callback },
  })
  const resource = {
    type: 'search' as const,
    id: 'search:organization:org',
    title: 'Search results',
    search: {
      query: 'policy',
      scope: { kind: 'organization' as const, organizationId: 'org' },
      filters: { source: 'gmail' },
      topK: 8,
    },
  }
  const event: ResourceEvent = {
    ...removeEvent('file', 'unused'),
    payload: { op: 'upsert', resource },
  }
  handleResourceEvent({ deps } as StreamLoopContext, event)
  expect(deps.addResource).toHaveBeenCalledWith(resource)
  expect(callback).toHaveBeenCalledWith(resource.id)
  handleResourceEvent({ deps } as StreamLoopContext, event)
  const exactQuery = {
    queryKey: knowledgeKeys.search(
      resourceScopeKey(resource.search.scope),
      resource.search.query,
      resource.search.filters,
      resource.search.topK
    ),
  }
  expect(deps.queryClient.invalidateQueries).toHaveBeenCalledTimes(2)
  expect(deps.queryClient.invalidateQueries).toHaveBeenNthCalledWith(1, exactQuery)
  expect(deps.queryClient.invalidateQueries).toHaveBeenNthCalledWith(2, exactQuery)

  vi.mocked(deps.addResource).mockClear()
  handleResourceEvent({ deps } as StreamLoopContext, {
    ...event,
    payload: {
      op: 'upsert',
      resource: {
        ...resource,
        search: { ...resource.search, scope: { kind: 'organization', organizationId: 'foreign' } },
      },
    },
  })
  expect(deps.addResource).not.toHaveBeenCalled()
})

it('seeds only fresh matching search effects and never seeds replayed or foreign evidence', () => {
  const deps = makeStreamLoopDeps({
    workspaceId: undefined,
    organizationId: 'org',
    viewerId: 'reader',
  })
  const resource = {
    type: 'search' as const,
    id: 'search:organization:org',
    title: 'Search results',
    search: {
      query: 'policy',
      scope: { kind: 'organization' as const, organizationId: 'org' },
      topK: 8,
    },
  }
  const data = {
    query: 'policy',
    results: [],
    retrieval: { status: 'complete' as const, timedOutLegs: [] },
  }
  const searchResult = { actorUserId: 'reader', data }
  const event: ResourceEvent = {
    ...removeEvent('file', 'unused'),
    payload: { op: 'upsert', resource, searchResult },
  }
  const key = knowledgeKeys.search(
    resourceScopeKey(resource.search.scope),
    'policy',
    undefined,
    8,
    'reader'
  )
  handleResourceEvent({ deps } as StreamLoopContext, event)
  expect(deps.queryClient.setQueryData).toHaveBeenCalledWith(key, data)
  expect(deps.queryClient.cancelQueries).toHaveBeenCalledWith(
    { queryKey: key, exact: true },
    { revert: false }
  )
  expect(deps.queryClient.invalidateQueries).not.toHaveBeenCalled()
  vi.mocked(deps.queryClient.setQueryData).mockClear()
  handleResourceEvent({ deps } as StreamLoopContext, {
    ...event,
    payload: { ...event.payload, replay: true },
  })
  expect(deps.queryClient.setQueryData).not.toHaveBeenCalled()
  expect(deps.queryClient.invalidateQueries).toHaveBeenCalledWith({ queryKey: key })
  handleResourceEvent({ deps } as StreamLoopContext, {
    ...event,
    payload: {
      op: 'upsert',
      resource,
      searchResult: { actorUserId: 'reader', data: { ...data, query: 'different' } },
    },
  })
  expect(deps.queryClient.setQueryData).not.toHaveBeenCalled()
  handleResourceEvent({ deps: { ...deps, viewerId: 'other-viewer' } } as StreamLoopContext, event)
  expect(deps.queryClient.setQueryData).not.toHaveBeenCalled()
  handleResourceEvent({ deps: { ...deps, organizationId: 'other' } } as StreamLoopContext, event)
  expect(deps.queryClient.setQueryData).not.toHaveBeenCalled()
})
