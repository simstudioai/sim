import { flushMacrotask } from '@sim/testing/helpers/async'
import { createDeferred } from '@sim/testing/helpers/deferred'
import { QueryClient, QueryObserver } from '@tanstack/react-query'
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
import {
  createStreamLoopContext,
  type StreamLoopContext,
} from '@/app/workspace/[workspaceId]/home/hooks/stream/stream-context'
import {
  makeStreamLoopDeps,
  ref,
} from '@/app/workspace/[workspaceId]/home/hooks/stream/stream-test-helpers'
import type { MothershipResource } from '@/app/workspace/[workspaceId]/home/types'
import { type MothershipChatHistory, mothershipChatKeys } from '@/hooks/queries/mothership-chats'
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

    expect(deps.removeResource).toHaveBeenCalledWith({
      type: 'workflow',
      id: 'wf-1',
      title: 'wf-1',
    })
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

describe('live resource effects', () => {
  const detailKey = mothershipChatKeys.detail('chat-1')
  const kept: MothershipResource = { type: 'file', id: 'kept', title: 'kept.md' }
  const dropped: MothershipResource = { type: 'file', id: 'dropped', title: 'dropped.md' }
  const created: MothershipResource = { type: 'table', id: 'tbl-new', title: 'Leads' }

  /** A server whose stored resources the effects below have already changed. */
  function serverChat() {
    let stored = [kept, dropped]
    const reads = vi.fn(
      async (): Promise<MothershipChatHistory> => ({
        id: 'chat-1',
        title: null,
        messages: [],
        activeStreamId: 'stream-1',
        resources: stored,
      })
    )
    return { reads, persistEffects: () => (stored = [kept, created]) }
  }

  function effect(op: 'upsert' | 'remove', resource: MothershipResource): ResourceEvent {
    return {
      ...removeEvent('file', resource.id),
      payload: { op, effectId: `effect:${resource.id}`, resource },
    } as ResourceEvent
  }

  function applyEffects(queryClient: QueryClient) {
    const deps = makeStreamLoopDeps({ queryClient, chatIdRef: ref<string | undefined>('chat-1') })
    handleResourceEvent({ deps } as StreamLoopContext, effect('upsert', created))
    handleResourceEvent({ deps } as StreamLoopContext, effect('remove', dropped))
  }

  it('records effects in the cached chat without reloading its transcript', async () => {
    const queryClient = new QueryClient()
    const server = serverChat()
    queryClient.setQueryData(detailKey, await server.reads())
    server.reads.mockClear()
    const unsubscribe = new QueryObserver(queryClient, {
      queryKey: detailKey,
      queryFn: server.reads,
      staleTime: Number.POSITIVE_INFINITY,
    }).subscribe(() => {})

    server.persistEffects()
    applyEffects(queryClient)
    await queryClient.refetchQueries({ queryKey: detailKey, stale: true })

    expect(queryClient.getQueryData<MothershipChatHistory>(detailKey)?.resources).toEqual([
      kept,
      created,
    ])
    expect(server.reads).not.toHaveBeenCalled()
    unsubscribe()
  })

  it.each([
    { cached: true, label: 'a cached chat' },
    { cached: false, label: 'a chat loading for the first time' },
  ])(
    'restarts a transcript read of $label that began before the effects were stored',
    async ({ cached }) => {
      const queryClient = new QueryClient()
      const server = serverChat()
      if (cached) queryClient.setQueryData(detailKey, await server.reads())
      const staleRead = queryClient.fetchQuery({ queryKey: detailKey, queryFn: server.reads })

      server.persistEffects()
      applyEffects(queryClient)
      await staleRead.catch(() => undefined)

      await vi.waitFor(() => {
        expect(queryClient.isFetching({ queryKey: detailKey })).toBe(0)
        expect(queryClient.getQueryData<MothershipChatHistory>(detailKey)?.resources).toEqual([
          kept,
          created,
        ])
      })
    }
  )
})

describe('recovered resource events', () => {
  const detailKey = mothershipChatKeys.detail('chat-1')
  const tables = ['tbl-1', 'tbl-2', 'tbl-3'].map(
    (id): MothershipResource => ({ type: 'table', id, title: id })
  )

  function replayed(resource: MothershipResource, seq: number): ResourceEvent {
    return {
      ...removeEvent('file', resource.id),
      seq,
      payload: { op: 'upsert', replay: true, resource },
    } as ResourceEvent
  }

  /** A mounted chat whose every read returns the resources stored when the read began. */
  function mountedChat(queryClient: QueryClient, { cached = true, hangFirstRead = false } = {}) {
    const server = { stored: [] as MothershipResource[] }
    const reads = vi.fn(
      async (): Promise<MothershipChatHistory> => ({
        id: 'chat-1',
        title: null,
        messages: [],
        activeStreamId: 'stream-1',
        resources: [...server.stored],
      })
    )
    if (hangFirstRead) reads.mockImplementationOnce(() => new Promise(() => {}))
    if (cached) {
      queryClient.setQueryData(detailKey, {
        id: 'chat-1',
        title: null,
        messages: [],
        activeStreamId: 'stream-1',
        resources: [],
      } satisfies MothershipChatHistory)
    }
    const unsubscribe = new QueryObserver(queryClient, {
      queryKey: detailKey,
      queryFn: reads,
      staleTime: Number.POSITIVE_INFINITY,
    }).subscribe(() => {})
    return { server, reads, unsubscribe }
  }

  async function settledResources(queryClient: QueryClient) {
    await vi.waitFor(() => expect(queryClient.isFetching({ queryKey: detailKey })).toBe(0))
    return queryClient.getQueryData<MothershipChatHistory>(detailKey)?.resources
  }

  it('reloads the transcript once for a whole batch replay, after its terminal flush', async () => {
    const queryClient = new QueryClient()
    const { server, reads, unsubscribe } = mountedChat(queryClient)
    const ctx = createStreamLoopContext(
      makeStreamLoopDeps({
        queryClient,
        chatIdRef: ref<string | undefined>('chat-1'),
        options: { deferFlushes: true },
      })
    )
    server.stored = tables

    tables.forEach((table, index) => handleResourceEvent(ctx, replayed(table, index + 1)))
    expect(reads).not.toHaveBeenCalled()
    ctx.ops.forceFlush()

    expect(await settledResources(queryClient)).toEqual(tables)
    expect(reads).toHaveBeenCalledOnce()
    unsubscribe()
  })

  it('coalesces a reconnected tail burst into one read plus one trailing read that sees the last change', async () => {
    const queryClient = new QueryClient()
    const { server, reads, unsubscribe } = mountedChat(queryClient)
    const deps = makeStreamLoopDeps({ queryClient, chatIdRef: ref<string | undefined>('chat-1') })
    const ctx = createStreamLoopContext(deps)
    const firstReadReleased = createDeferred<void>()
    reads.mockImplementationOnce(async () => {
      const resources = [...server.stored]
      await firstReadReleased.promise
      return { id: 'chat-1', title: null, messages: [], activeStreamId: 'stream-1', resources }
    })

    server.stored = tables.slice(0, 1)
    handleResourceEvent(ctx, replayed(tables[0], 1))
    server.stored = tables
    handleResourceEvent(ctx, replayed(tables[1], 2))
    handleResourceEvent(ctx, replayed(tables[2], 3))
    firstReadReleased.resolve()

    await vi.waitFor(() => expect(reads).toHaveBeenCalledTimes(2))
    expect(await settledResources(queryClient)).toEqual(tables)
    expect(reads).toHaveBeenCalledTimes(2)
    unsubscribe()
  })

  it.each([
    { name: 'a loaded transcript', cached: true },
    { name: 'a transcript still on its first load', cached: false },
  ])(
    'stops holding reloads of $name behind one that never settles once 30 seconds pass',
    async ({ cached }) => {
      const queryClient = new QueryClient()
      const { server, reads, unsubscribe } = mountedChat(queryClient, {
        cached,
        hangFirstRead: true,
      })
      const ctx = createStreamLoopContext(
        makeStreamLoopDeps({ queryClient, chatIdRef: ref<string | undefined>('chat-1') })
      )
      vi.useFakeTimers({ toFake: ['Date'] })
      try {
        handleResourceEvent(ctx, replayed(tables[0], 1))
        await vi.waitFor(() => expect(reads).toHaveBeenCalledOnce())
        handleResourceEvent(ctx, replayed(tables[1], 2))
        expect(reads).toHaveBeenCalledOnce()

        server.stored = tables
        vi.setSystemTime(Date.now() + 30_000)
        handleResourceEvent(ctx, replayed(tables[2], 3))

        await vi.waitFor(() => expect(reads).toHaveBeenCalledTimes(2))
        expect(await settledResources(queryClient)).toEqual(tables)
        expect(reads).toHaveBeenCalledTimes(2)
      } finally {
        vi.useRealTimers()
        unsubscribe()
      }
    }
  )

  it.each([
    { name: 'a loaded transcript', cached: true },
    { name: 'a transcript still on its first load', cached: false },
  ])(
    'doubles the hold after replacing a stuck read of $name, so a slow replacement finishes and is read again',
    async ({ cached }) => {
      const queryClient = new QueryClient()
      const { server, reads, unsubscribe } = mountedChat(queryClient, {
        cached,
        hangFirstRead: true,
      })
      const slowReadReleased = createDeferred<void>()
      reads.mockImplementationOnce(async () => {
        const resources = [...server.stored]
        await slowReadReleased.promise
        return { id: 'chat-1', title: null, messages: [], activeStreamId: 'stream-1', resources }
      })
      const ctx = createStreamLoopContext(
        makeStreamLoopDeps({ queryClient, chatIdRef: ref<string | undefined>('chat-1') })
      )
      vi.useFakeTimers({ toFake: ['Date'] })
      try {
        handleResourceEvent(ctx, replayed(tables[0], 1))
        await vi.waitFor(() => expect(reads).toHaveBeenCalledOnce())

        vi.setSystemTime(Date.now() + 30_000)
        handleResourceEvent(ctx, replayed(tables[1], 2))
        await vi.waitFor(() => expect(reads).toHaveBeenCalledTimes(2))

        server.stored = tables
        vi.setSystemTime(Date.now() + 30_000)
        handleResourceEvent(ctx, replayed(tables[2], 3))
        await flushMacrotask()
        expect(reads).toHaveBeenCalledTimes(2)

        slowReadReleased.resolve()
        await vi.waitFor(() => expect(reads).toHaveBeenCalledTimes(3))
        expect(await settledResources(queryClient)).toEqual(tables)
        expect(reads).toHaveBeenCalledTimes(3)
      } finally {
        vi.useRealTimers()
        unsubscribe()
      }
    }
  )

  it.each([
    { name: 'a loaded transcript', cached: true },
    { name: 'a transcript still on its first load', cached: false },
  ])(
    'still replaces a second stuck read of $name once its doubled hold passes',
    async ({ cached }) => {
      const queryClient = new QueryClient()
      const { server, reads, unsubscribe } = mountedChat(queryClient, {
        cached,
        hangFirstRead: true,
      })
      reads.mockImplementationOnce(() => new Promise(() => {}))
      const ctx = createStreamLoopContext(
        makeStreamLoopDeps({ queryClient, chatIdRef: ref<string | undefined>('chat-1') })
      )
      vi.useFakeTimers({ toFake: ['Date'] })
      try {
        handleResourceEvent(ctx, replayed(tables[0], 1))
        await vi.waitFor(() => expect(reads).toHaveBeenCalledOnce())

        vi.setSystemTime(Date.now() + 30_000)
        handleResourceEvent(ctx, replayed(tables[1], 2))
        await vi.waitFor(() => expect(reads).toHaveBeenCalledTimes(2))

        vi.setSystemTime(Date.now() + 30_000)
        handleResourceEvent(ctx, replayed(tables[1], 3))
        await flushMacrotask()
        expect(reads).toHaveBeenCalledTimes(2)

        server.stored = tables
        vi.setSystemTime(Date.now() + 30_000)
        handleResourceEvent(ctx, replayed(tables[2], 4))

        await vi.waitFor(() => expect(reads).toHaveBeenCalledTimes(3))
        expect(await settledResources(queryClient)).toEqual(tables)
        expect(reads).toHaveBeenCalledTimes(3)
      } finally {
        vi.useRealTimers()
        unsubscribe()
      }
    }
  )
})

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

  it('opens a Project file tab, which names no workspace, in an organization chat', () => {
    const org = makeStreamLoopDeps({ workspaceId: undefined })
    const projectFile = {
      type: 'file' as const,
      id: 'file-1',
      title: 'context.md',
      owner: { entityType: 'project' as const, entityId: 'project-1' },
    }
    handleResourceEvent({ deps: org } as StreamLoopContext, {
      ...removeEvent('file', 'file-1'),
      payload: { op: 'upsert', resource: projectFile },
    })
    expect(org.addResource).toHaveBeenCalledWith(projectFile)
    expect(mocks.invalidateResourceQueries).not.toHaveBeenCalled()
  })
})

describe('owner-addressed effects on a legacy tab', () => {
  const legacyTab: MothershipResource = { type: 'file', id: 'f', title: 'notes' }
  const owner = { entityType: 'workspace' as const, entityId: 'ws' }

  function applyOwnerEffect(op: 'upsert' | 'remove') {
    const deps = makeStreamLoopDeps({ workspaceId: 'ws', resourcesRef: ref([legacyTab]) })
    handleResourceEvent(
      { deps } as StreamLoopContext,
      {
        ...removeEvent('file', 'f'),
        payload: { op, effectId: `effect:${op}`, resource: { type: 'file', id: 'f', owner } },
      } as ResourceEvent
    )
    const updater = (deps.setResources as ReturnType<typeof vi.fn>).mock.calls[0][0] as (
      current: MothershipResource[]
    ) => MothershipResource[]
    return updater([legacyTab])
  }

  it('closes the tab when the removal names its workspace owner', () => {
    expect(applyOwnerEffect('remove')).toEqual([])
  })

  it('updates the tab in place instead of opening a duplicate', () => {
    expect(applyOwnerEffect('upsert')).toHaveLength(1)
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
