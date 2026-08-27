/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  invalidateResourceQueries: vi.fn(),
  removeWorkflowFromActiveCache: vi.fn(),
}))

vi.mock(
  '@/app/workspace/[workspaceId]/home/components/mothership-view/components/resource-registry',
  () => ({ invalidateResourceQueries: mocks.invalidateResourceQueries })
)
vi.mock('@/hooks/queries/utils/workflow-cache', () => ({
  removeWorkflowFromActiveCache: mocks.removeWorkflowFromActiveCache,
}))

import type { PersistedStreamEventEnvelope } from '@/lib/copilot/request/session/contract'
import { handleResourceEvent } from '@/app/workspace/[workspaceId]/home/hooks/stream/handle-resource-event'
import type { StreamLoopContext } from '@/app/workspace/[workspaceId]/home/hooks/stream/stream-context'
import { makeStreamLoopDeps } from '@/app/workspace/[workspaceId]/home/hooks/stream/stream-test-helpers'
import type { MothershipResource } from '@/app/workspace/[workspaceId]/home/types'
import { useTableViewPinStore } from '@/stores/table/view-pin/store'

function removeEvent(type: 'workflow' | 'file', id: string): PersistedStreamEventEnvelope {
  return {
    type: 'resource',
    v: 1,
    seq: 1,
    ts: '',
    stream: { streamId: 's', cursor: '1' },
    payload: { op: 'remove', resource: { type, id, title: id } },
  } as PersistedStreamEventEnvelope
}

function browserUpsertEvent(id: string, title: string): PersistedStreamEventEnvelope {
  return {
    type: 'resource',
    v: 1,
    seq: 1,
    ts: '',
    stream: { streamId: 's', cursor: '1' },
    payload: { op: 'upsert', resource: { type: 'browser', id, title } },
  } as PersistedStreamEventEnvelope
}

describe('handleResourceEvent removal', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

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

  it('normalizes a page-shaped browser event into the singleton Browser panel', () => {
    const onResourceEvent = vi.fn()
    const deps = makeStreamLoopDeps({
      onResourceEventRef: { current: onResourceEvent },
    })
    const ctx = { deps } as StreamLoopContext

    handleResourceEvent(
      ctx,
      browserUpsertEvent('browser-session:slack-tab', 'mship-todo (Channel) - sim - Slack')
    )

    expect(deps.addResource).toHaveBeenCalledWith({
      type: 'browser',
      id: 'browser-session',
      title: 'Browser',
    })
    expect(deps.setActiveResourceId).not.toHaveBeenCalled()
    expect(onResourceEvent).toHaveBeenCalledWith('browser-session')
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
      resource: { type: 'table', id, title: 'Invoices', ...(viewId ? { viewId } : {}) },
    },
  } as PersistedStreamEventEnvelope
}

describe('handleResourceEvent saved-view pins', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useTableViewPinStore.getState().reset()
  })

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
    expect(deps.setResources).not.toHaveBeenCalled()
    expect(useTableViewPinStore.getState().pins['tbl-1']?.viewId).toBe('view-1')
    expect(mocks.invalidateResourceQueries).toHaveBeenCalledWith(
      deps.queryClient,
      'ws-1',
      'table',
      'tbl-1'
    )
    expect(onResourceEvent).toHaveBeenCalledWith('tbl-1')
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
})
