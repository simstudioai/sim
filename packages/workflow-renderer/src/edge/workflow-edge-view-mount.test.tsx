/**
 * @vitest-environment jsdom
 */
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { Position } from 'reactflow'
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { WorkflowEdgeView, type WorkflowEdgeViewProps } from '../index'

const mountedHosts = new Set<HTMLDivElement>()
const mountedRoots = new Set<Root>()

let prefersReducedMotion = false

beforeAll(() => {
  window.matchMedia = ((query: string) => ({
    matches: query.includes('prefers-reduced-motion') ? prefersReducedMotion : false,
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    onchange: null,
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia
})

beforeEach(() => {
  prefersReducedMotion = false
})

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
    host,
    path: host.querySelector<SVGPathElement>('.react-flow__edge-path'),
    pulseLayers: host.querySelectorAll<SVGPathElement>('[data-workflow-edge-pulse-layer]'),
    traversingPath: host.querySelector<SVGPathElement>('[data-workflow-edge-traversing]'),
    pulseGlow: host.querySelector<SVGPathElement>('[data-workflow-edge-pulse-glow]'),
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
  it('shows taken edges as a solid graphite path while the workflow is running', () => {
    const { path } = renderEdge({ runStatus: 'success', isWorkflowRunning: true })

    expect(path?.style.stroke).toBe('var(--text-secondary)')
    expect(path?.style.strokeWidth).toBe('2')
    expect(path?.style.opacity).toBe('1')
  })

  it('mutes edges that have not been taken during execution', () => {
    const { host, path } = renderEdge({ isWorkflowRunning: true })

    expect(path?.style.stroke).toBe('var(--workflow-edge)')
    expect(path?.style.strokeWidth).toBe('1.5')
    expect(path?.style.opacity).toBe('0.52')
    expect(host.querySelector('[data-workflow-edge-state="waiting"]')).not.toBeNull()
  })

  it('moves a signal toward the currently active target', () => {
    const { host, pulseLayers, traversingPath, pulseGlow } = renderEdge({
      runStatus: 'success',
      isWorkflowRunning: true,
      isTargetActive: true,
    })

    expect(host.querySelector('[data-workflow-edge-state="traversing"]')).not.toBeNull()
    expect(traversingPath).not.toBeNull()
    expect(pulseGlow).not.toBeNull()
    expect(pulseLayers).toHaveLength(4)
    expect(traversingPath?.getAttribute('stroke-dasharray')).toBe('0.07 2.13')
    expect(traversingPath?.getAttribute('stroke')).toBe('var(--white)')
    expect(pulseGlow?.getAttribute('stroke-dasharray')).toBe('0.32 1.88')
    expect(pulseGlow?.getAttribute('stroke-width')).toBe('6')
    expect(traversingPath?.querySelector('animate')?.getAttribute('repeatCount')).toBe('indefinite')
    expect(traversingPath?.querySelector('animate')?.getAttribute('from')).toBe('-0.125')
    expect(traversingPath?.querySelector('animate')?.getAttribute('to')).toBe('-2.325')
    expect(traversingPath?.querySelector('animate')?.getAttribute('dur')).toBe('1100ms')
    expect(
      Array.from(pulseLayers).map((layer) => [
        layer.getAttribute('data-workflow-edge-pulse-layer'),
        layer.getAttribute('stroke-dasharray'),
        layer.getAttribute('opacity'),
      ])
    ).toEqual([
      ['tail', '0.32 1.88', '0.22'],
      ['shoulder', '0.23 1.97', '0.32'],
      ['body', '0.15 2.05', '0.6'],
      ['core', '0.07 2.13', '1'],
    ])
  })

  it('renders no pulse under reduced motion, and still reports the edge as traversing', () => {
    /*
     * `motion-reduce:hidden` is `display: none`, which hides the four pulse
     * layers but leaves their SMIL timelines running. Not rendering them stops
     * the work; the edge must still read as traversing so its colour and width
     * are unchanged.
     */
    prefersReducedMotion = true
    const { host, pulseLayers, traversingPath, path } = renderEdge({
      runStatus: 'success',
      isWorkflowRunning: true,
      isTargetActive: true,
    })

    expect(host.querySelector('[data-workflow-edge-state="traversing"]')).not.toBeNull()
    expect(pulseLayers).toHaveLength(0)
    expect(traversingPath).toBeNull()
    expect(host.querySelector('filter')).toBeNull()
    expect(path?.style.stroke).toBe('var(--text-secondary)')
    expect(path?.style.strokeWidth).toBe('2')
  })

  it('sizes the glow filter in user space so a flat edge still renders it', () => {
    /*
     * The default `objectBoundingBox` units resolve against the path's bbox,
     * and a straight horizontal edge — what an auto-laid-out chain produces —
     * has zero height there, which zeroes the region and stops the referencing
     * element rendering entirely. This fixture's endpoints share a Y.
     */
    const { host } = renderEdge({
      runStatus: 'success',
      isWorkflowRunning: true,
      isTargetActive: true,
    })

    const filter = host.querySelector('filter')
    expect(filter?.getAttribute('filterUnits')).toBe('userSpaceOnUse')
    expect(Number(filter?.getAttribute('height'))).toBeGreaterThan(0)
    expect(Number(filter?.getAttribute('width'))).toBeGreaterThan(0)
  })

  it('settles a taken edge when its target is no longer active', () => {
    const { host, traversingPath } = renderEdge({
      runStatus: 'success',
      isWorkflowRunning: true,
      isTargetActive: false,
    })

    expect(host.querySelector('[data-workflow-edge-state="traversed"]')).not.toBeNull()
    expect(traversingPath).toBeNull()
  })

  it('restores the canvas success color after execution stops', () => {
    const { path } = renderEdge({ runStatus: 'success', isWorkflowRunning: false })

    expect(path?.style.stroke).toBe('var(--border-success)')
  })

  it('keeps execution errors distinct during an active run', () => {
    const { path } = renderEdge({ runStatus: 'error', isWorkflowRunning: true })

    expect(path?.style.stroke).toBe('var(--text-error)')
  })

  it('mutes an untaken error branch during execution', () => {
    const { path } = renderEdge({
      sourceHandle: 'error',
      isWorkflowRunning: true,
    })

    expect(path?.style.stroke).toBe('var(--workflow-edge)')
    expect(path?.style.opacity).toBe('0.52')
  })

  it('restores the error branch color after execution', () => {
    const { path } = renderEdge({
      sourceHandle: 'error',
      isWorkflowRunning: false,
    })

    expect(path?.style.stroke).toBe('var(--text-error)')
  })
})
