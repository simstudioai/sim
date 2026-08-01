/**
 * @vitest-environment jsdom
 */
import { act } from 'react'
import { WorkflowEdgeView, type WorkflowEdgeViewProps } from '@sim/workflow-renderer'
import { createRoot, type Root } from 'react-dom/client'
import { Position } from 'reactflow'
import { afterEach, describe, expect, it } from 'vitest'

const mountedHosts = new Set<HTMLDivElement>()
const mountedRoots = new Set<Root>()

function renderEdge(overrides: Partial<WorkflowEdgeViewProps> = {}) {
  const host = document.createElement('div')
  document.body.appendChild(host)
  mountedHosts.add(host)

  const root = createRoot(host)
  mountedRoots.add(root)
  act(() => {
    root.render(
      <WorkflowEdgeView
        id='start-to-next'
        source='start'
        target='next'
        sourceX={0}
        sourceY={40}
        targetX={160}
        targetY={40}
        sourcePosition={Position.Right}
        targetPosition={Position.Left}
        sourceHandle='source'
        diffStatus={null}
        runStatus={undefined}
        isPreviewRun={false}
        {...overrides}
      />
    )
  })

  return {
    path: host.querySelector<SVGPathElement>('.react-flow__edge-path'),
  }
}

afterEach(() => {
  act(() => {
    for (const root of mountedRoots) root.unmount()
  })
  mountedRoots.clear()
  for (const host of mountedHosts) {
    host.remove()
  }
  mountedHosts.clear()
})

describe('WorkflowEdgeView', () => {
  it('matches active block silhouettes while the workflow is running', () => {
    const { path } = renderEdge({ runStatus: 'success', isWorkflowRunning: true })

    expect(path?.style.stroke).toBe('var(--text-secondary)')
  })

  it('restores the canvas success color after execution stops', () => {
    const { path } = renderEdge({ runStatus: 'success', isWorkflowRunning: false })

    expect(path?.style.stroke).toBe('var(--border-success)')
  })

  it('keeps execution errors distinct during an active run', () => {
    const { path } = renderEdge({ runStatus: 'error', isWorkflowRunning: true })

    expect(path?.style.stroke).toBe('var(--text-error)')
  })
})
