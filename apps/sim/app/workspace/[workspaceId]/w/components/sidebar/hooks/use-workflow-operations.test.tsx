/**
 * @vitest-environment jsdom
 */
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { mockClearDiff, mockCreateWorkflow, mockMarkWorkflowCreating, mockPush } = vi.hoisted(
  () => ({
    mockClearDiff: vi.fn(),
    mockCreateWorkflow: vi.fn(),
    mockMarkWorkflowCreating: vi.fn(),
    mockPush: vi.fn(),
  })
)

vi.mock('@sim/utils/id', () => ({
  generateId: () => 'workflow-1',
}))

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush }),
}))

vi.mock('@/hooks/queries/workflows', () => ({
  useCreateWorkflow: () => ({ mutate: mockCreateWorkflow, isPending: false }),
  useWorkflowMap: () => ({ data: {}, isLoading: false }),
}))

vi.mock('@/stores/workflow-diff/store', () => ({
  useWorkflowDiffStore: {
    getState: () => ({ clearDiff: mockClearDiff }),
  },
}))

vi.mock('@/stores/workflows/registry/store', () => ({
  useWorkflowRegistry: {
    getState: () => ({ markWorkflowCreating: mockMarkWorkflowCreating }),
  },
}))

vi.mock('@/stores/workflows/registry/utils', () => ({
  generateCreativeWorkflowName: () => 'bolt-ivy',
}))

import { useWorkflowOperations } from '@/app/workspace/[workspaceId]/w/components/sidebar/hooks/use-workflow-operations'

let operations: ReturnType<typeof useWorkflowOperations> | null = null

function Harness() {
  operations = useWorkflowOperations({ workspaceId: 'workspace-1' })
  return null
}

describe('useWorkflowOperations', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
    operations = null
    vi.clearAllMocks()
  })

  it('requests server-side deduplication for a generated workflow name', async () => {
    act(() => root.render(<Harness />))
    if (!operations) throw new Error('Workflow operations did not render')

    await act(async () => {
      await operations?.handleCreateWorkflow()
    })

    expect(mockCreateWorkflow).toHaveBeenCalledWith({
      workspaceId: 'workspace-1',
      name: 'bolt-ivy',
      id: 'workflow-1',
      deduplicate: true,
    })
  })
})
