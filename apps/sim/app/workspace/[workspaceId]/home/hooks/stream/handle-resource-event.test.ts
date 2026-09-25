import { beforeEach, describe, expect, it, vi } from 'vitest'
import { resourceScopeKey } from '@/lib/core/resource-scope'
import { knowledgeKeys } from '@/hooks/queries/utils/knowledge-keys'

const mocks = vi.hoisted(() => ({
  invalidateResourceQueries: vi.fn(),
  refreshGeneralSettings: vi.fn(),
  removeWorkflowFromActiveCache: vi.fn(),
  notifyWorkflowExternalUpdate: vi.fn(),
}))
vi.mock('@/hooks/queries/general-settings', () => ({
  refreshGeneralSettings: mocks.refreshGeneralSettings,
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

describe('handleResourceEvent removal', () => {
  it.each(['workflow', 'table', 'file', 'knowledgebase', 'log'] as const)(
    'ignores an authorized %s read without opening, saving or changing focus',
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
      expect(onResourceEvent).not.toHaveBeenCalled()
      expect(deps.setResources).not.toHaveBeenCalled()
      expect(deps.addResource).not.toHaveBeenCalled()
      expect(mocks.invalidateResourceQueries).not.toHaveBeenCalled()
      expect(mocks.notifyWorkflowExternalUpdate).not.toHaveBeenCalled()
      expect(deps.ensureWorkflowInRegistry).not.toHaveBeenCalled()
      expect(deps.queryClient.invalidateQueries).not.toHaveBeenCalled()
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
    useTableViewPinStore.getState().reset()
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
})

describe('organization resource stream', () => {
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
  const key = [
    ...knowledgeKeys.search(
      resourceScopeKey(resource.search.scope),
      'policy',
      undefined,
      8,
      'reader'
    ),
    'indexed',
  ]
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

it('refreshes organization policy and its server layout only within the owning organization', () => {
  const refreshRoute = vi.fn()
  const deps = makeStreamLoopDeps({ workspaceId: undefined, organizationId: 'org', refreshRoute })
  for (const organizationId of ['other', 'org']) {
    handleResourceEvent({ deps } as StreamLoopContext, {
      ...removeEvent('file', 'unused'),
      payload: {
        op: 'refresh',
        resource: { type: 'settings', scope: 'organization', organizationId, id: 'access-control' },
      },
    })
  }
  expect(refreshRoute).toHaveBeenCalledOnce()
  expect(deps.queryClient.invalidateQueries).toHaveBeenCalledOnce()
  expect(deps.addResource).not.toHaveBeenCalled()
})
