/**
 * @vitest-environment jsdom
 */
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { SerializableExecutionState } from '@/executor/execution/types'

vi.mock('@/stores/workflows/registry/store', () => ({
  useWorkflowRegistry: Object.assign(
    vi.fn(() => null),
    {
      getState: vi.fn(() => ({ activeWorkflowId: null })),
    }
  ),
}))

vi.unmock('@/stores/execution/store')
vi.unmock('@/stores/execution/types')

import { useExecutionStore, useLastExecutionSnapshot } from '@/stores/execution/store'

describe('useLastExecutionSnapshot', () => {
  beforeEach(() => {
    useExecutionStore.getState().reset()
  })

  it('updates consumers when the workflow snapshot changes', () => {
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    const container = document.createElement('div')
    const root: Root = createRoot(container)
    let latest: SerializableExecutionState | undefined

    function Probe() {
      latest = useLastExecutionSnapshot('workflow-1')
      return null
    }

    act(() => root.render(<Probe />))
    expect(latest).toBeUndefined()

    const snapshot: SerializableExecutionState = {
      blockStates: {},
      executedBlocks: ['trigger'],
      blockLogs: [],
      decisions: { router: {}, condition: {} },
      completedLoops: [],
      activeExecutionPath: ['trigger'],
    }

    act(() => useExecutionStore.getState().setLastExecutionSnapshot('workflow-1', snapshot))
    expect(latest).toBe(snapshot)

    act(() => root.unmount())
  })
})
