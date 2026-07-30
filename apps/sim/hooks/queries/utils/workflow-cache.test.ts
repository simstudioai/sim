/**
 * @vitest-environment node
 */
import { QueryClient } from '@tanstack/react-query'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import * as getQueryClientModule from '@/app/_shell/providers/get-query-client'
import {
  getWorkflowById,
  getWorkflows,
  removeWorkflowFromActiveCache,
} from '@/hooks/queries/utils/workflow-cache'

const getQueryDataMock = vi.fn()

/**
 * Spy on the real module namespace instead of vi.mock: under `isolate: false`
 * `@/hooks/queries/utils/workflow-cache` may already be cached bound to the
 * real get-query-client module, so patching the shared namespace is the only
 * wiring that always applies.
 */
const getQueryClientSpy = vi
  .spyOn(getQueryClientModule, 'getQueryClient')
  .mockImplementation(() => ({ getQueryData: getQueryDataMock }) as unknown as QueryClient)

afterAll(() => {
  getQueryClientSpy.mockRestore()
})

import { workflowKeys } from '@/hooks/queries/utils/workflow-keys'
import type { WorkflowMetadata } from '@/stores/workflows/registry/types'

function workflow(id: string): WorkflowMetadata {
  return {
    id,
    name: id,
    lastModified: new Date(0),
    createdAt: new Date(0),
    sortOrder: 0,
  }
}

describe('getWorkflows', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    getQueryClientSpy.mockImplementation(
      () => ({ getQueryData: getQueryDataMock }) as unknown as QueryClient
    )
  })

  it('reads the active workflow list from the cache', () => {
    const workflows = [{ id: 'wf-1', name: 'Workflow 1' }]
    getQueryDataMock.mockReturnValue(workflows)

    expect(getWorkflows('ws-1')).toBe(workflows)
    expect(getQueryDataMock).toHaveBeenCalledWith(['workflows', 'list', 'ws-1', 'active'])
  })

  it('supports alternate workflow scopes', () => {
    getQueryDataMock.mockReturnValue([])

    getWorkflows('ws-2', 'archived')

    expect(getQueryDataMock).toHaveBeenCalledWith(['workflows', 'list', 'ws-2', 'archived'])
  })

  it('reads a single workflow by id from the cache', () => {
    const workflows = [{ id: 'wf-1', name: 'Workflow 1' }]
    getQueryDataMock.mockReturnValue(workflows)

    expect(getWorkflowById('ws-1', 'wf-1')).toEqual(workflows[0])
    expect(getWorkflowById('ws-1', 'missing')).toBeUndefined()
  })
})

describe('removeWorkflowFromActiveCache', () => {
  it('removes the deleted workflow immediately and returns the rollback snapshot', () => {
    const queryClient = new QueryClient()
    const key = workflowKeys.list('ws-1', 'active')
    const initial = [workflow('wf-1'), workflow('wf-2')]
    queryClient.setQueryData(key, initial)

    const snapshot = removeWorkflowFromActiveCache(queryClient, 'ws-1', 'wf-1')

    expect(snapshot).toEqual(initial)
    expect(queryClient.getQueryData(key)).toEqual([workflow('wf-2')])
  })
})
