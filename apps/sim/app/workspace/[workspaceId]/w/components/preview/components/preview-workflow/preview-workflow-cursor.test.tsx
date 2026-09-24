/**
 * @vitest-environment jsdom
 */

import { act, type ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { WorkflowState } from '@/stores/workflows/workflow/types'

vi.mock('@xyflow/react', () => ({
  ConnectionLineType: { SmoothStep: 'smoothstep' },
  ReactFlowProvider: ({ children }: { children: ReactNode }) => children,
  ReactFlow: () => (
    <div className='react-flow'>
      <div className='react-flow__pane' />
      <div className='react-flow__selectionpane' />
      <div className='react-flow__renderer'>
        <div className='react-flow__node'>Node</div>
      </div>
    </div>
  ),
  useReactFlow: () => ({ fitView: vi.fn() }),
}))

vi.mock('next/navigation', () => ({ useParams: () => ({ workspaceId: 'workspace-1' }) }))
vi.mock('@/hooks/queries/workflows', () => ({
  useWorkflowMap: () => ({ data: {}, isSuccess: true, isPlaceholderData: false }),
}))
vi.mock('@sim/workflow-renderer', () => ({
  BLOCK_DIMENSIONS: { FIXED_WIDTH: 200, MIN_HEIGHT: 100 },
  BLOCK_Z_BASE: 1,
  CANVAS_Z_INDEX_MODE: 'manual',
  CONTAINER_CHILD_Z_BASE: 2,
  CONTAINER_DIMENSIONS: {
    MIN_WIDTH: 200,
    MIN_HEIGHT: 100,
    DEFAULT_WIDTH: 200,
    DEFAULT_HEIGHT: 100,
  },
  EDGE_Z_BASE: 0,
  EDGE_Z_MAX: 10,
  getEdgeZIndexForTarget: () => 0,
  sortNodesParentsFirst: (nodes: unknown[]) => nodes,
  useCanvasColorMode: () => 'light',
}))
vi.mock('@sim/workflow-types/workflow', () => ({
  normalizeWorkflowEdgeHandles: (edges: unknown[]) => edges,
}))
vi.mock(
  '@/app/workspace/[workspaceId]/w/[workflowId]/components/workflow-edge/workflow-edge',
  () => ({
    WorkflowEdge: () => null,
  })
)
vi.mock('@/app/workspace/[workspaceId]/w/[workflowId]/utils', () => ({
  estimateBlockDimensions: () => ({ width: 200, height: 100 }),
  SUBFLOW_CHILD_NODE_CLASS: 'subflow-child',
}))
vi.mock(
  '@/app/workspace/[workspaceId]/w/components/preview/components/preview-workflow/components/block',
  () => ({
    PreviewBlock: () => null,
  })
)
vi.mock(
  '@/app/workspace/[workspaceId]/w/components/preview/components/preview-workflow/components/subflow',
  () => ({
    PreviewSubflow: () => null,
  })
)

import { PreviewWorkflow } from '@/app/workspace/[workspaceId]/w/components/preview/components/preview-workflow/preview-workflow'

const workflowState = { blocks: {}, edges: [] } as WorkflowState
let host: HTMLDivElement | undefined
let root: ReturnType<typeof createRoot> | undefined

afterEach(() => {
  if (root) act(() => root?.unmount())
  host?.remove()
  root = undefined
  host = undefined
  vi.unstubAllGlobals()
})

describe('PreviewWorkflow cursors', () => {
  it('keeps two mounted previews independent when either cursor changes', () => {
    vi.stubGlobal(
      'ResizeObserver',
      class {
        observe() {}
        disconnect() {}
      }
    )
    host = document.createElement('div')
    document.body.appendChild(host)
    root = createRoot(host)

    act(() =>
      root?.render(
        <>
          <PreviewWorkflow workflowState={workflowState} cursorStyle='grab' />
          <PreviewWorkflow
            workflowState={workflowState}
            cursorStyle='pointer'
            onNodeClick={() => {}}
          />
        </>
      )
    )

    const previews = host.querySelectorAll<HTMLElement>('.preview-mode')
    expect(previews).toHaveLength(2)
    expect(previews[0].style.getPropertyValue('--preview-cursor')).toBe('grab')
    expect(previews[0]).toHaveAttribute('data-preview-grab')
    expect(previews[1].style.getPropertyValue('--preview-cursor')).toBe('pointer')
    expect(previews[1]).not.toHaveAttribute('data-preview-grab')
    expect(previews[1]).toHaveClass('interactive-nodes')

    act(() =>
      root?.render(
        <>
          <PreviewWorkflow workflowState={workflowState} cursorStyle='default' />
          <PreviewWorkflow
            workflowState={workflowState}
            cursorStyle='grab'
            onNodeClick={() => {}}
          />
        </>
      )
    )

    expect(previews[0].style.getPropertyValue('--preview-cursor')).toBe('default')
    expect(previews[0]).not.toHaveAttribute('data-preview-grab')
    expect(previews[1].style.getPropertyValue('--preview-cursor')).toBe('grab')
    expect(previews[1]).toHaveAttribute('data-preview-grab')
    expect(previews[1]).toHaveClass('interactive-nodes')
  })
})
