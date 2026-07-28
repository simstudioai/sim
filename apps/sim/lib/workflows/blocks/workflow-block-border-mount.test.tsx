/**
 * @vitest-environment jsdom
 *
 * Mount smoke test for the border renderer. It lives in apps/sim because the
 * renderer package has no test runner. The coloured-port case exists because
 * a knob-paint bug once threw only when a card had a coloured knob — invisible
 * on an idle canvas, fatal on node creation.
 */
import { act } from 'react'
import {
  ERROR_SOURCE_HANDLE_POSITION,
  getCursorBranchSourceHandleId,
  getCursorSourceHandlePosition,
  getErrorBorderPort,
  getErrorSourceHandleStyle,
  getNearestBranchCursorHandleId,
  getWorkflowBorderFrameDeltaSeconds,
  HANDLE_POSITIONS,
  isActionMenuSwellReady,
  normalizeCursorSourceHandleId,
  WorkflowBlockBorder,
  type WorkflowBorderPort,
} from '@sim/workflow-renderer'
import {
  getHorizontalWorkflowHandleSide,
  normalizePositionedSourceHandleId,
  normalizePositionedTargetHandleId,
  POSITIONED_SOURCE_HANDLE_SIDES,
} from '@sim/workflow-types/workflow'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

beforeAll(() => {
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    onchange: null,
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia
})

const ports: WorkflowBorderPort[] = [
  { id: 'target', side: 'left', position: 'center', plateau: 33 },
  { id: 'source', side: 'right', position: 'center', plateau: 33 },
  {
    id: 'error',
    side: 'bottom',
    position: { fromEnd: HANDLE_POSITIONS.ERROR_RIGHT_OFFSET },
    plateau: 24,
    color: 'var(--text-secondary)',
  },
  {
    id: 'action-menu',
    side: 'top',
    position: { fromEnd: 24 + 82 },
    plateau: 164,
    restAmplitude: 7,
    hoverAmplitude: 7,
    magnetizable: false,
  },
]

const mountedRoots = new Set<Root>()
const mountedHosts = new Set<HTMLDivElement>()

function mount(element: React.ReactElement) {
  const host = document.createElement('div')
  document.body.appendChild(host)
  const root = createRoot(host)
  mountedRoots.add(root)
  mountedHosts.add(host)
  act(() => {
    root.render(element)
  })
  return { host, root }
}

afterEach(() => {
  act(() => {
    mountedRoots.forEach((root) => root.unmount())
  })
  mountedRoots.clear()
  mountedHosts.forEach((host) => host.remove())
  mountedHosts.clear()
  vi.unstubAllGlobals()
})

describe('WorkflowBlockBorder mount', () => {
  it('resolves every connection start to a horizontal source anchor', () => {
    expect(POSITIONED_SOURCE_HANDLE_SIDES).toEqual(['left', 'right'])
    expect(getHorizontalWorkflowHandleSide(20, 250)).toBe('left')
    expect(getHorizontalWorkflowHandleSide(124.9, 250)).toBe('left')
    expect(getHorizontalWorkflowHandleSide(125, 250)).toBe('right')
    expect(getHorizontalWorkflowHandleSide(230, 250)).toBe('right')
    /* Outputs always leave from the right, whichever edge the drag began on —
       anchoring one on the left would put an outgoing line on the input port. */
    expect(normalizeCursorSourceHandleId('source-cursor-left')).toBe('source-right')
    expect(normalizeCursorSourceHandleId('source-cursor-right')).toBe('source-right')
    expect(normalizeCursorSourceHandleId('source-cursor-top')).toBe('source-right')
    expect(normalizeCursorSourceHandleId('source-cursor-bottom')).toBe('source-right')
    /* Anything that already reached the graph collapses the same way. */
    expect(normalizePositionedSourceHandleId('source-left')).toBe('source-right')
    expect(normalizePositionedSourceHandleId('source-right')).toBe('source-right')
  })

  it('uses the grabbed edge only for the transient preview direction', () => {
    expect(getCursorSourceHandlePosition('top')).toBe('top')
    expect(getCursorSourceHandlePosition('bottom')).toBe('bottom')
    expect(getCursorSourceHandlePosition('left')).toBe('left')
    expect(getCursorSourceHandlePosition('right')).toBe('right')
  })

  it('keeps moving branch swells attached to a valid branch output', () => {
    const conditionRows = [{ id: 'if-id' }, { id: 'else-if-id' }, { id: 'else-id' }]

    expect(getNearestBranchCursorHandleId(conditionRows, 0, 60, 'condition')).toBe(
      getCursorBranchSourceHandleId('condition-if-id')
    )
    expect(getNearestBranchCursorHandleId(conditionRows, 90, 60, 'condition')).toBe(
      getCursorBranchSourceHandleId('condition-else-if-id')
    )
    expect(getNearestBranchCursorHandleId(conditionRows, 200, 60, 'condition')).toBe(
      getCursorBranchSourceHandleId('condition-else-id')
    )
    expect(normalizeCursorSourceHandleId(getCursorBranchSourceHandleId('condition-else-id'))).toBe(
      'condition-else-id'
    )
  })

  it('keeps Error as the bottom-right persisted source exception', () => {
    expect(getErrorBorderPort('var(--text-secondary)')).toEqual({
      id: 'error',
      side: 'bottom',
      position: { fromEnd: 30 },
      plateau: 24,
      color: 'var(--text-secondary)',
    })
    expect(ERROR_SOURCE_HANDLE_POSITION).toBe('bottom')
    expect(getErrorSourceHandleStyle()).toEqual({
      right: 'auto',
      top: 'auto',
      bottom: -7,
      left: 'calc(100% - 30px)',
      width: 24,
      height: 14,
      transform: 'translateX(-50%)',
    })
    expect(normalizeCursorSourceHandleId('error')).toBe('error')
  })

  it('collapses legacy vertical edge anchors during persistence normalization', () => {
    expect(normalizePositionedSourceHandleId('source-top')).toBe('source-right')
    expect(normalizePositionedSourceHandleId('source-bottom')).toBe('source-right')
    expect(normalizePositionedTargetHandleId('target-top')).toBe('target-left')
    expect(normalizePositionedTargetHandleId('target-bottom')).toBe('target-left')
  })

  it('never advances a spring with a negative or unbounded frame delta', () => {
    expect(getWorkflowBorderFrameDeltaSeconds(90, 100)).toBe(0)
    expect(getWorkflowBorderFrameDeltaSeconds(Number.NaN, 100)).toBe(0)
    expect(getWorkflowBorderFrameDeltaSeconds(10_000, 100)).toBeCloseTo(1 / 30)
  })

  it('reveals action-menu content only once the swell can contain it', () => {
    /* The row clips to the swell, so revealing it while the swell is shorter
       than the buttons collides the icons with the card's top edge. Pin the
       ratio, not the threshold constant — 24px of buttons in a 28px swell. */
    const ACTION_ROW_HEIGHT_PX = 24
    const OPEN_SWELL_HEIGHT_PX = 28
    const minimumSafeFraction = ACTION_ROW_HEIGHT_PX / OPEN_SWELL_HEIGHT_PX

    expect(isActionMenuSwellReady(1, minimumSafeFraction - 0.001)).toBe(false)
    expect(isActionMenuSwellReady(1, 1)).toBe(true)
    /* Never reveal while retracting, however far open the swell still is. */
    expect(isActionMenuSwellReady(0, 1)).toBe(false)
  })

  it('paints synchronously at mount without throwing', () => {
    const { host } = mount(
      <div style={{ width: 250, height: 136 }}>
        <WorkflowBlockBorder ports={ports} hasRing={false} ringStyles='' height={136} />
      </div>
    )
    const path = host.querySelector('svg path')
    expect(path?.getAttribute('d')?.length ?? 0).toBeGreaterThan(0)
  })

  it('mounts a header-only card without throwing', () => {
    const { host } = mount(
      <div style={{ width: 250, height: 48 }}>
        <WorkflowBlockBorder
          ports={[{ id: 'source', side: 'right', position: 'center', plateau: 10 }]}
          hasRing={false}
          ringStyles=''
          height={48}
        />
      </div>
    )
    expect(host.querySelector('svg')).toBeTruthy()
  })

  it('keeps every path coordinate bounded when animation timestamps move backward', () => {
    const callbacks = new Map<number, FrameRequestCallback>()
    let nextFrameId = 0
    vi.stubGlobal(
      'requestAnimationFrame',
      vi.fn((callback: FrameRequestCallback) => {
        nextFrameId += 1
        callbacks.set(nextFrameId, callback)
        return nextFrameId
      })
    )
    vi.stubGlobal(
      'cancelAnimationFrame',
      vi.fn((frameId: number) => {
        callbacks.delete(frameId)
      })
    )

    const { host } = mount(
      <div style={{ width: 250, height: 136 }}>
        <WorkflowBlockBorder ports={ports} hasRing={false} ringStyles='' height={136} />
      </div>
    )
    const initialTimestamp = performance.now()

    for (let index = 1; index <= 24; index++) {
      const next = callbacks.entries().next().value as [number, FrameRequestCallback] | undefined
      expect(next).toBeDefined()
      if (!next) break
      callbacks.delete(next[0])
      act(() => next[1](initialTimestamp - index * 33))
    }

    const pathData = [...host.querySelectorAll('svg path')]
      .map((path) => path.getAttribute('d') ?? '')
      .join(' ')
    const coordinates = pathData.match(/-?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?/gi)?.map(Number) ?? []
    expect(pathData).not.toMatch(/NaN|Infinity/)
    expect(coordinates.every(Number.isFinite)).toBe(true)
    expect(Math.max(...coordinates.map(Math.abs))).toBeLessThanOrEqual(278.1)
  })

  it('keeps only one animation frame scheduled across synchronous geometry repaints', () => {
    const callbacks = new Map<number, FrameRequestCallback>()
    let nextFrameId = 0
    vi.stubGlobal(
      'requestAnimationFrame',
      vi.fn((callback: FrameRequestCallback) => {
        nextFrameId += 1
        callbacks.set(nextFrameId, callback)
        return nextFrameId
      })
    )
    vi.stubGlobal(
      'cancelAnimationFrame',
      vi.fn((frameId: number) => {
        callbacks.delete(frameId)
      })
    )

    const host = document.createElement('div')
    document.body.appendChild(host)
    const root = createRoot(host)
    mountedRoots.add(root)
    mountedHosts.add(host)
    act(() => {
      root.render(
        <div style={{ width: 250, height: 136 }}>
          <WorkflowBlockBorder ports={ports} hasRing={false} ringStyles='' height={136} />
        </div>
      )
    })
    expect(callbacks.size).toBe(1)

    const updatedPorts = ports.map((port) =>
      port.id === 'source' ? { ...port, color: 'var(--text-secondary)' } : port
    )
    act(() => {
      root.render(
        <div style={{ width: 250, height: 136 }}>
          <WorkflowBlockBorder ports={updatedPorts} hasRing={false} ringStyles='' height={136} />
        </div>
      )
    })

    expect(callbacks.size).toBe(1)
  })
})
