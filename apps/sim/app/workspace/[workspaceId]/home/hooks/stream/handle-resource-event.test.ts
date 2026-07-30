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
})
