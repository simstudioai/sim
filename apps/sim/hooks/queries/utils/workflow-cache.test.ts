/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { getQueryDataMock } = vi.hoisted(() => ({
  getQueryDataMock: vi.fn(),
}))

vi.mock('@/app/_shell/providers/get-query-client', () => ({
  getQueryClient: vi.fn(() => ({
    getQueryData: getQueryDataMock,
  })),
}))

import { getWorkflowById, getWorkflows } from '@/hooks/queries/utils/workflow-cache'

describe('getWorkflows', () => {
  beforeEach(() => {
    vi.clearAllMocks()
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
