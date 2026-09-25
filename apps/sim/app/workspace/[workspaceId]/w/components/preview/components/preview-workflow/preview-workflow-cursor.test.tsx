/**
 * @vitest-environment jsdom
 */

import { readFileSync } from 'node:fs'
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
let cursorStyles: HTMLStyleElement | undefined

afterEach(() => {
  if (root) act(() => root?.unmount())
  host?.remove()
  cursorStyles?.remove()
  root = undefined
  host = undefined
  cursorStyles = undefined
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

  it('applies the production cursor CSS only within each mounted preview', () => {
    vi.stubGlobal(
      'ResizeObserver',
      class {
        observe() {}
        disconnect() {}
      }
    )

    // JSDOM computes stylesheet rules but cannot keep an element in :active after
    // a pointer event. Map that pseudo-class to an attribute for this CSS test.
    cursorStyles = document.createElement('style')
    cursorStyles.textContent = readFileSync(
      'app/workspace/[workspaceId]/w/components/preview/components/preview-workflow/preview-workflow.css',
      'utf8'
    ).replaceAll(':active', '[data-test-active]')
    document.head.appendChild(cursorStyles)

    host = document.createElement('div')
    document.body.appendChild(host)
    root = createRoot(host)

    const render = (first: 'grab' | 'default', second: 'grab' | 'pointer') =>
      act(() =>
        root?.render(
          <>
            <PreviewWorkflow workflowState={workflowState} cursorStyle={first} />
            <PreviewWorkflow
              workflowState={workflowState}
              cursorStyle={second}
              onNodeClick={() => {}}
            />
          </>
        )
      )

    render('grab', 'pointer')

    const previews = host.querySelectorAll<HTMLElement>('.preview-mode')
    expect(previews).toHaveLength(2)
    const panes = Array.from(
      previews,
      (preview) => preview.querySelector<HTMLElement>('.react-flow__pane')!
    )
    const nodes = Array.from(
      previews,
      (preview) => preview.querySelector<HTMLElement>('.react-flow__node')!
    )

    for (const element of [...panes, ...nodes]) element.setAttribute('data-test-active', '')

    expect(getComputedStyle(panes[0]).cursor).toBe('grabbing')
    expect(getComputedStyle(nodes[0]).cursor).toBe('grabbing')
    expect(getComputedStyle(panes[1]).cursor).toBe('var(--preview-cursor)')
    expect(getComputedStyle(nodes[1]).cursor).toBe('pointer')

    render('default', 'grab')

    expect(getComputedStyle(panes[0]).cursor).toBe('var(--preview-cursor)')
    expect(getComputedStyle(nodes[0]).cursor).not.toBe('grabbing')
    expect(getComputedStyle(panes[1]).cursor).toBe('grabbing')
    expect(getComputedStyle(nodes[1]).cursor).toBe('pointer')
  })
})
