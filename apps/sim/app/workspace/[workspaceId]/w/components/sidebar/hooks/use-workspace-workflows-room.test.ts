/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { folderKeys } from '@/hooks/queries/utils/folder-keys'
import { selectorKeys } from '@/hooks/queries/utils/selector-keys'
import { workflowKeys } from '@/hooks/queries/utils/workflow-keys'

const { mockInvalidateQueries, mockUseWorkspaceInvalidationRoom } = vi.hoisted(() => ({
  mockInvalidateQueries: vi.fn().mockResolvedValue(undefined),
  mockUseWorkspaceInvalidationRoom: vi.fn(),
}))

vi.mock('@tanstack/react-query', () => ({
  useQueryClient: () => ({ invalidateQueries: mockInvalidateQueries }),
}))

vi.mock('@/app/workspace/[workspaceId]/hooks/use-workspace-invalidation-room', () => ({
  useWorkspaceInvalidationRoom: mockUseWorkspaceInvalidationRoom,
}))

import { useWorkspaceWorkflowsRoom } from './use-workspace-workflows-room'

describe('useWorkspaceWorkflowsRoom', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('invalidates workflow, selector, and workflow-folder caches for the current workspace', () => {
    useWorkspaceWorkflowsRoom('workspace-1')
    const onChanged = mockUseWorkspaceInvalidationRoom.mock.calls[0][2]

    onChanged()

    expect(mockInvalidateQueries.mock.calls.map(([options]) => options.queryKey)).toEqual(
      expect.arrayContaining([
        workflowKeys.list('workspace-1', 'active'),
        workflowKeys.list('workspace-1', 'archived'),
        workflowKeys.list('workspace-1', 'all'),
        selectorKeys.all,
        folderKeys.list('workspace-1', 'active', 'workflow'),
        folderKeys.list('workspace-1', 'archived', 'workflow'),
      ])
    )
    expect(mockInvalidateQueries).toHaveBeenCalledTimes(6)
  })
})
