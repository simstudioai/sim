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
  getNoteBlockHeight,
  getWorkflowBorderFrameDeltaSeconds,
  HANDLE_POSITIONS,
  isActionMenuSwellReady,
  NoteBlockView,
  normalizeCursorSourceHandleId,
  SubflowNodeView,
  SubflowStartView,
  WorkflowBlockBorder,
  type WorkflowBorderPort,
} from '@sim/workflow-renderer'
import {
  normalizeWorkflowEdgeSourceHandle,
  normalizeWorkflowEdgeTargetHandle,
} from '@sim/workflow-types/workflow'
import { createRoot, type Root } from 'react-dom/client'
import { ReactFlowProvider } from 'reactflow'
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
  vi.useRealTimers()
})

describe('WorkflowBlockBorder mount', () => {
  it('resolves every connection start to the one canonical source handle', () => {
    /* Which perimeter edge the drag began on is presentation only. Minting a
       side-specific id here would split edge identity: the same visual A→B
       connection could persist twice, and neither the executor nor the copilot
       edit pipeline recognizes any id but `source`. */
    expect(normalizeCursorSourceHandleId('source-cursor-left')).toBe('source')
    expect(normalizeCursorSourceHandleId('source-cursor-right')).toBe('source')
    expect(normalizeCursorSourceHandleId('source-cursor-top')).toBe('source')
    expect(normalizeCursorSourceHandleId('source-cursor-bottom')).toBe('source')
    expect(normalizeCursorSourceHandleId('source-cursor-left', 'loop')).toBe('loop-end-source')
    expect(normalizeCursorSourceHandleId('source-cursor-right', 'parallel')).toBe(
      'parallel-end-source'
    )
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

  it('heals side-anchored handle ids back onto the canonical pair', () => {
    for (const side of ['top', 'right', 'bottom', 'left']) {
      expect(normalizeWorkflowEdgeSourceHandle(`source-${side}`)).toBe('source')
      expect(normalizeWorkflowEdgeTargetHandle(`target-${side}`)).toBe('target')
    }
    expect(normalizeWorkflowEdgeSourceHandle('source')).toBe('source')
    expect(normalizeWorkflowEdgeTargetHandle('target')).toBe('target')
    /* Semantic handles are untouched, and an absent handle stays absent so the
       duplicate check keeps matching what persistence actually writes. */
    expect(normalizeWorkflowEdgeSourceHandle('condition-if-id')).toBe('condition-if-id')
    expect(normalizeWorkflowEdgeSourceHandle('loop-end-source')).toBe('loop-end-source')
    expect(normalizeWorkflowEdgeSourceHandle('error')).toBe('error')
    expect(normalizeWorkflowEdgeSourceHandle('')).toBeNull()
    expect(normalizeWorkflowEdgeSourceHandle(undefined)).toBeNull()
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

  it('sizes the silhouette from the host it paints on, not the predicted height', () => {
    /*
     * The SVG is `calc(100% + padding)` of the host but its viewBox comes from
     * this size, under `preserveAspectRatio='none'` — so a size taken from the
     * caller's prediction rescales the whole outline the moment the card's real
     * content disagrees with it, and the content spills past its own border.
     * The prediction is only the first-paint seed.
     */
    const measured = { width: 250, height: 212 }
    const wrapper = document.createElement('div')
    for (const [prop, value] of Object.entries(measured)) {
      Object.defineProperty(wrapper, prop === 'width' ? 'offsetWidth' : 'offsetHeight', {
        configurable: true,
        value,
      })
    }
    document.body.appendChild(wrapper)
    const root = createRoot(wrapper)
    mountedRoots.add(root)
    mountedHosts.add(wrapper)

    act(() => {
      root.render(<WorkflowBlockBorder ports={ports} hasRing={false} ringStyles='' height={136} />)
    })

    const viewBox = wrapper.querySelector('svg')?.getAttribute('viewBox')
    /* viewBox is `-pad -pad (w + 2*pad) (h + 2*pad)`; the height term must come
       from the measured 212, not the predicted 136. */
    expect(viewBox?.split(' ').at(-1)).toBe(String(measured.height + 72))
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

  it('paints a tall selector card across floating-point segment seams', () => {
    const selectorPorts: WorkflowBorderPort[] = [
      {
        id: 'target',
        side: 'left',
        position: 'center',
        plateau: 38,
        color: 'var(--text-secondary)',
        magnetizable: false,
      },
    ]
    const { host } = mount(
      <div style={{ width: 250, height: 384 }}>
        <WorkflowBlockBorder ports={selectorPorts} hasRing={false} ringStyles='' height={384} />
      </div>
    )
    const path = host.querySelector('svg path')
    expect(path?.getAttribute('d')?.length ?? 0).toBeGreaterThan(0)
  })

  it('paints camera-followed execution with the selected silhouette color', () => {
    const { host } = mount(
      <div style={{ width: 250, height: 136 }}>
        <WorkflowBlockBorder
          ports={ports}
          hasRing={true}
          ringStyles='ring-[3.5px] ring-[var(--border-success)] animate-ring-pulse'
          isSelected={true}
          height={136}
        />
      </div>
    )

    expect(host.querySelector('path[fill="var(--text-secondary)"]')).toBeTruthy()
    expect(host.querySelector('path[stroke="var(--border-success)"]')).toBeNull()
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

  it('bounds note content in a faded scroll viewport without connection handles', () => {
    vi.stubGlobal(
      'ResizeObserver',
      class {
        observe() {}
        unobserve() {}
        disconnect() {}
      }
    )

    const { host } = mount(
      <NoteBlockView
        name='Implementation notes'
        content={'Long note content\n'.repeat(40)}
        isEnabled
        hasRing={false}
        ringStyles=''
        onSelect={() => undefined}
        actionBar={<div data-workflow-action-bar-swell=''>Actions</div>}
      />
    )

    const scrollRegion = host.querySelector('[data-note-scroll-region]')
    expect(scrollRegion).toHaveClass('allow-scroll', 'h-44', 'overflow-y-auto')
    expect(scrollRegion?.getAttribute('class')).toContain('mask-image:linear-gradient')
    expect(getNoteBlockHeight(false)).toBe(216)
    expect(host.querySelector('[data-workflow-action-bar-bridge]')).toBeTruthy()
    expect(host.querySelector('svg rect[fill="var(--surface-3)"]')).toBeTruthy()
    expect(host.querySelector('[data-handleid]')).toBeNull()
  })

  it('paints the subflow Start source as a unified connection swell', () => {
    const { host } = mount(
      <ReactFlowProvider>
        <div className='relative size-[100px]'>
          <SubflowStartView parentId='loop-1' kind='loop' isHighlighted />
        </div>
      </ReactFlowProvider>
    )

    const start = host.querySelector('[data-node-role="loop-start"]')
    expect(start).toHaveAttribute('data-connection-swell')
    expect(start).toHaveClass('top-3')
    expect(start?.querySelector('svg')).toHaveAttribute('viewBox', '-36 -36 130 106')
    expect(start?.querySelector('[data-handleid="loop-start-source"]')).toBeTruthy()
    expect(start?.querySelector('path[stroke="var(--text-secondary)"]')).toBeTruthy()
  })

  it('uses the standard card header and lower full-size ports for subflows', () => {
    const { host } = mount(
      <ReactFlowProvider>
        <SubflowNodeView
          id='loop-1'
          data={{ kind: 'loop', name: 'Loop 1', width: 500, height: 300, isPreview: true }}
          isEnabled
          isLocked={false}
          isFocused={false}
          nestingLevel={0}
          canEditWorkflow={false}
          onSelect={() => undefined}
        />
      </ReactFlowProvider>
    )

    const header = host.querySelector('[data-subflow-header]')
    expect(header).toHaveClass('h-[40px]')
    expect(header).not.toHaveClass('border-b')
    expect(header).not.toHaveClass('bg-[var(--surface-2)]')
    expect(host.querySelector('[data-subflow-type-tag="loop"]')).toHaveTextContent('Loop')
    expect(host.querySelector('[data-handleid="target"]')).toHaveStyle({ top: '69px' })
    expect(host.querySelector('[data-handleid="loop-end-source"]')).toHaveStyle({ top: '69px' })
    expect(host.querySelector('svg')).toHaveAttribute('viewBox', '-36 -36 572 372')
    expect(host.querySelector('svg rect[fill="var(--surface-3)"]')).toBeTruthy()
    const dropTargetOutline = host.querySelector('[data-subflow-drop-target-outline]')
    expect(dropTargetOutline).toHaveClass(
      'rounded-2xl',
      'ring-[1.5px]',
      'ring-[var(--text-secondary)]',
      '[.subflow-node-drop-target_&]:opacity-100'
    )
  })

  it('retracts a selected loop action swell after hover ends', () => {
    vi.useFakeTimers()
    vi.stubGlobal(
      'ResizeObserver',
      class {
        observe() {}
        unobserve() {}
        disconnect() {}
      }
    )

    const { host } = mount(
      <ReactFlowProvider>
        <SubflowNodeView
          id='loop-1'
          data={{ kind: 'loop', name: 'Loop 1', width: 500, height: 300 }}
          selected
          isEnabled
          isLocked={false}
          isFocused
          nestingLevel={0}
          canEditWorkflow
          onSelect={() => undefined}
          actionBar={<div data-workflow-action-bar-swell=''>Actions</div>}
        />
      </ReactFlowProvider>
    )

    const actionMenuRoot = host.querySelector('[data-node-selected]')
    expect(actionMenuRoot?.hasAttribute('data-action-menu-open')).toBe(false)

    act(() => actionMenuRoot?.dispatchEvent(new Event('pointerenter')))
    expect(actionMenuRoot?.hasAttribute('data-action-menu-open')).toBe(true)

    act(() => actionMenuRoot?.dispatchEvent(new Event('pointerleave')))
    act(() => vi.advanceTimersByTime(101))
    act(() => vi.advanceTimersByTime(41))
    expect(actionMenuRoot?.hasAttribute('data-action-menu-open')).toBe(false)
  })

  it('gives a nested block exclusive hover ownership over the loop action swell', () => {
    vi.stubGlobal(
      'ResizeObserver',
      class {
        observe() {}
        unobserve() {}
        disconnect() {}
      }
    )

    const { host } = mount(
      <ReactFlowProvider>
        <div>
          <div className='react-flow__node' data-loop-node='loop-1'>
            <SubflowNodeView
              id='loop-1'
              data={{ kind: 'loop', name: 'Loop 1', width: 500, height: 300 }}
              isEnabled
              isLocked={false}
              isFocused={false}
              nestingLevel={0}
              canEditWorkflow
              onSelect={() => undefined}
              actionBar={<div data-workflow-action-bar-swell=''>Loop actions</div>}
            />
          </div>
          <div className='react-flow__node' data-nested-node='block-1' />
        </div>
      </ReactFlowProvider>
    )

    const loopNode = host.querySelector('[data-loop-node="loop-1"]')
    const actionMenuRoot = host.querySelector('[data-node-id="loop-1"]')?.parentElement
    const nestedNode = host.querySelector('[data-nested-node="block-1"]')
    const loopHeader = host.querySelector('[data-subflow-header]')

    act(() => loopNode?.dispatchEvent(new Event('pointerenter')))
    expect(actionMenuRoot).toHaveAttribute('data-action-menu-open')

    act(() =>
      loopNode?.dispatchEvent(
        new MouseEvent('pointerleave', { relatedTarget: nestedNode, bubbles: false })
      )
    )
    expect(actionMenuRoot).not.toHaveAttribute('data-action-menu-open')

    act(() => loopNode?.dispatchEvent(new Event('pointerenter')))
    act(() => loopHeader?.dispatchEvent(new Event('pointerover', { bubbles: true })))
    expect(actionMenuRoot).toHaveAttribute('data-action-menu-open')
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
