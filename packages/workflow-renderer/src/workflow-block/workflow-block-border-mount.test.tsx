/**
 * @vitest-environment jsdom
 *
 * Mount smoke test for the border renderer. The coloured-port case exists because
 * a knob-paint bug once threw only when a card had a coloured knob — invisible
 * on an idle canvas, fatal on node creation.
 */
import { act } from 'react'
import {
  normalizeWorkflowEdgeSourceHandle,
  normalizeWorkflowEdgeTargetHandle,
} from '@sim/workflow-types/workflow'
import { createRoot, type Root } from 'react-dom/client'
import { ReactFlowProvider } from 'reactflow'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { CONTAINER_DIMENSIONS } from '../dimensions'
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
  type NoteContentEditorProps,
  normalizeCursorSourceHandleId,
  SubflowNodeView,
  SubflowStartView,
  WorkflowBlockBorder,
  type WorkflowBorderPort,
} from '../index'

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

/**
 * Stands in for the app's markdown editor.
 *
 * The view has no editor of its own — it renders whatever the host injects —
 * so exercising it through this seam is exactly the path production takes,
 * rather than a second built-in editing surface only tests ever reached.
 */
function renderTestContentEditor({ value, selectionClassName, onChange }: NoteContentEditorProps) {
  return (
    <textarea
      aria-label='Note content'
      className={selectionClassName}
      value={value}
      onChange={(event) => onChange(event.target.value)}
    />
  )
}

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

  it('keeps a subflow Start drag anchored to the start source, not the container exit', () => {
    /* The Start pill's cursor swell mints the branch-cursor form of its handle
       id. The plain cursor id normalizes by block type — for a container that
       is the loop/parallel END source — so a swell drag from Start would
       otherwise persist as an edge leaving the container. */
    expect(
      normalizeCursorSourceHandleId(getCursorBranchSourceHandleId('loop-start-source'), 'loop')
    ).toBe('loop-start-source')
    expect(
      normalizeCursorSourceHandleId(
        getCursorBranchSourceHandleId('parallel-start-source'),
        'parallel'
      )
    ).toBe('parallel-start-source')
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

  /**
   * The knob is a recolour of one stretch of the outline, so its commands have
   * to BE the outline's commands. When the two were generated off different
   * sample grids they disagreed by a fraction of a pixel at the shoulder tip,
   * and the sliver of dark stroke the knob failed to cover read as a barb
   * hanging off it.
   *
   * Only holds where a knob's own bulge is the tallest thing under it: a knob
   * is painted from its own feature alone, while the silhouette takes the max
   * over all of them, so two bulges tall enough to overlap genuinely part
   * company. Every port layout the editor builds keeps them clear of one
   * another.
   */
  const expectKnobsOnSilhouette = (host: HTMLElement) => {
    const silhouette = host.querySelector('svg > path')?.getAttribute('d') ?? ''
    const knobs = Array.from(host.querySelectorAll('svg > g[clip-path] path'))
    expect(knobs.length).toBeGreaterThan(0)

    for (const knob of knobs) {
      const commands = (knob.getAttribute('d') ?? '').match(/C[^MLAC]+/g) ?? []
      expect(commands.length).toBeGreaterThan(0)
      for (const command of commands) {
        expect(silhouette).toContain(command.trim())
      }
    }
  }

  it('paints every coloured knob on the silhouette’s own curve', () => {
    const { host } = mount(
      <div style={{ width: 250, height: 136 }}>
        <WorkflowBlockBorder ports={ports} hasRing={false} ringStyles='' height={136} />
      </div>
    )
    expectKnobsOnSilhouette(host)
  })

  it('keeps knobs on the curve when their resampled intervals merge', () => {
    /* Two coloured ports close enough that `relativeIntervals` merges them
       resample as one stretch, on a grid neither port's own bounds predict.
       The odd tab length is the other half of the same trap: a knob measured
       in whole pixels rather than against the interval it sits in lands half a
       step off whenever the bulge does not divide evenly. */
    const crowdedPorts: WorkflowBorderPort[] = [
      { id: 'target', side: 'left', position: 'center', plateau: 33 },
      { id: 'row-a', side: 'right', position: 60, plateau: 24, color: 'var(--brand-accent)' },
      { id: 'row-b', side: 'right', position: 87.5, plateau: 24, color: 'var(--text-error)' },
      { id: 'row-c', side: 'right', position: 140, plateau: 23, color: 'var(--warning)' },
    ]
    const { host } = mount(
      <div style={{ width: 250, height: 260 }}>
        <WorkflowBlockBorder ports={crowdedPorts} hasRing={false} ringStyles='' height={260} />
      </div>
    )
    expectKnobsOnSilhouette(host)
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
    const observedTargets: Element[] = []
    const handleNameChange = vi.fn(() => true)
    const handleContentChange = vi.fn()
    const handleExpandedChange = vi.fn()
    vi.stubGlobal(
      'ResizeObserver',
      class {
        observe(target: Element) {
          observedTargets.push(target)
        }
        unobserve() {}
        disconnect() {}
      }
    )

    const { host, root } = mount(
      <NoteBlockView
        name='Implementation notes'
        content={'Long note content\n'.repeat(40)}
        isEnabled
        isFocused={false}
        canEdit
        hasRing={false}
        ringStyles=''
        onSelect={() => undefined}
        renderContentEditor={renderTestContentEditor}
        onExpandedChange={handleExpandedChange}
        actionBar={<div data-workflow-action-bar-swell=''>Actions</div>}
      />
    )

    const scrollRegion = host.querySelector('[data-note-scroll-region]')
    expect(scrollRegion).toHaveClass('h-[calc(100%_-_40px)]', 'overflow-y-auto')
    expect(scrollRegion).not.toHaveClass('pointer-events-none', 'overflow-hidden')
    expect(scrollRegion).not.toHaveClass('allow-scroll', 'nodrag', 'nopan')
    expect(host.querySelector('[data-note-scroll-region] > div')).toHaveClass('pointer-events-none')

    Object.defineProperties(scrollRegion, {
      clientHeight: { configurable: true, value: 120 },
      scrollHeight: { configurable: true, value: 320 },
      scrollTop: { configurable: true, writable: true, value: 0 },
    })
    act(() => {
      scrollRegion?.dispatchEvent(new Event('scroll', { bubbles: true }))
    })
    expect(scrollRegion).toHaveClass('nowheel', 'allow-scroll', 'touch-pan-y')
    expect(host.querySelector('[data-note-card]')).toHaveClass(
      'transition-[color,width,height]',
      'cursor-grab'
    )
    expect(host.querySelector('[data-note-card]')).not.toHaveClass('cursor-text')
    expect(host.querySelector('[data-note-card]')).toHaveStyle({
      width: '320px',
      height: '240px',
    })
    expect(getNoteBlockHeight(true)).toBe(70)
    expect(getNoteBlockHeight(false)).toBe(240)
    expect(host.querySelector('[data-workflow-action-bar-bridge]')).toBeTruthy()
    expect(host.querySelector('svg rect[fill="#525252"]')).toBeTruthy()
    expect(
      host.querySelector('svg path[fill="var(--border-1)"][stroke="var(--border-1)"]')
    ).toBeTruthy()
    expect(host.querySelector('[data-handleid]')).toBeNull()
    expect(observedTargets).toContain(host.querySelector('[data-note-card]'))
    expect(host.querySelector('button[aria-label="Expand note"]')).toHaveClass(
      'pointer-events-none',
      'opacity-0',
      'group-hover:pointer-events-auto',
      'group-hover:opacity-70',
      'group-data-[node-selected]:opacity-70'
    )

    act(() => {
      root.render(
        <NoteBlockView
          name='Implementation notes'
          content={'Long note content\n'.repeat(40)}
          noteColor='light-gray'
          isEnabled
          isFocused={false}
          canEdit
          hasRing={false}
          ringStyles=''
          onSelect={() => undefined}
          renderContentEditor={renderTestContentEditor}
          onExpandedChange={handleExpandedChange}
          actionBar={<div data-workflow-action-bar-swell=''>Actions</div>}
        />
      )
    })

    const lightGrayCard = host.querySelector('[data-note-card]')
    act(() => {
      lightGrayCard?.dispatchEvent(new MouseEvent('pointerover', { bubbles: true }))
    })
    expect(host.querySelector('svg path[fill="#D4D4D4"]')).toBeTruthy()

    act(() => {
      lightGrayCard?.dispatchEvent(
        new MouseEvent('pointerout', { bubbles: true, relatedTarget: document.body })
      )
    })
    expect(host.querySelector('svg path[fill="#D4D4D4"]')).toBeNull()
    expect(host.querySelector('svg path[fill="var(--border-1)"]')).toBeTruthy()

    act(() => {
      root.render(
        <NoteBlockView
          name='Implementation notes'
          content={'Long note content\n'.repeat(40)}
          noteColor='light-gray'
          isEnabled
          isFocused
          canEdit
          hasRing
          ringStyles='ring-[1.5px] ring-[var(--text-secondary)]'
          onSelect={() => undefined}
          renderContentEditor={renderTestContentEditor}
          onNameChange={handleNameChange}
          onContentChange={handleContentChange}
          onExpandedChange={handleExpandedChange}
          actionBar={<div data-workflow-action-bar-swell=''>Actions</div>}
        />
      )
    })

    expect(host.querySelector('[data-note-card]')).toHaveClass(
      'transition-[color,width,height]',
      'note-drag-handle',
      'cursor-text'
    )
    expect(host.querySelector('[data-note-card]')).toHaveStyle({ width: '320px' })
    expect(host.querySelector('[data-note-card]')).not.toHaveClass('cursor-grab')
    expect(host.querySelector('[data-note-card]')).toHaveStyle({ height: '240px' })
    expect(host.querySelector('[data-note-card]')).not.toHaveClass(
      'transition-[width,height]',
      'will-change-[width,height]'
    )
    expect(host.querySelector('[data-note-scroll-region]')).toHaveClass(
      'h-[calc(100%_-_40px)]',
      'pb-0',
      '[contain:layout]'
    )
    expect(host.querySelector('[data-note-scroll-region]')).toHaveClass(
      'allow-scroll',
      'nowheel',
      'overflow-y-auto'
    )
    expect(host.querySelector('[data-note-scroll-region]')).not.toHaveClass('nodrag', 'nopan')
    expect(host.querySelector('[data-note-scroll-region]')).not.toHaveClass('pointer-events-none')
    expect(host.querySelector('input[aria-label="Note title"]')).toBeNull()
    expect(host.querySelector('textarea[aria-label="Note content"]')).toBeNull()
    expect(host.querySelector('svg')).toHaveAttribute('viewBox', '-36 -36 392 312')
    expect(host.querySelector('svg rect[fill="#E5E5E5"]')).toBeTruthy()
    expect(observedTargets).toContain(host.querySelector('[data-note-card]'))
    expect(host.querySelector('[data-node-selected]')).toBeTruthy()
    expect(host.querySelector('svg path[fill="var(--text-secondary)"]')).toBeTruthy()
    expect(host.querySelector('button[aria-label="Edit note title"]')).toBeNull()
    expect(host.querySelector('button[aria-label="Edit note content"]')).toBeNull()
    const compactCard = host.querySelector<HTMLElement>('[data-note-card]')

    act(() => {
      compactCard?.dispatchEvent(
        new MouseEvent('pointerdown', { bubbles: true, clientX: 10, clientY: 10, button: 0 })
      )
      compactCard?.dispatchEvent(
        new MouseEvent('click', { bubbles: true, clientX: 30, clientY: 30, detail: 1 })
      )
    })

    expect(handleExpandedChange).not.toHaveBeenCalled()

    act(() => {
      compactCard?.dispatchEvent(
        new MouseEvent('pointerdown', { bubbles: true, clientX: 10, clientY: 10, button: 0 })
      )
      compactCard?.dispatchEvent(
        new MouseEvent('click', { bubbles: true, clientX: 11, clientY: 11, detail: 1 })
      )
    })

    expect(handleExpandedChange).toHaveBeenCalledWith(true)
    handleExpandedChange.mockClear()
    const expandButton = host.querySelector<HTMLButtonElement>('button[aria-label="Expand note"]')
    expect(expandButton).toBeTruthy()
    expect(host.querySelector('[data-note-card]')?.contains(expandButton)).toBe(true)

    act(() => {
      expandButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })

    expect(handleExpandedChange).toHaveBeenCalledWith(true)

    act(() => {
      root.render(
        <NoteBlockView
          name='Implementation notes'
          content={'Long note content\n'.repeat(40)}
          noteColor='light-gray'
          isEnabled
          isFocused={false}
          isExpanded
          canEdit
          hasRing
          ringStyles='ring-[1.5px] ring-[var(--text-secondary)]'
          onSelect={() => undefined}
          renderContentEditor={renderTestContentEditor}
          onNameChange={handleNameChange}
          onContentChange={handleContentChange}
          onExpandedChange={handleExpandedChange}
          actionBar={<div data-workflow-action-bar-swell=''>Actions</div>}
        />
      )
    })

    expect(host.querySelector('[data-note-expanded]')).toBeTruthy()
    expect(host.querySelector('[data-note-card]')).toHaveClass('nodrag', 'cursor-default')
    expect(host.querySelector('[data-note-card]')).not.toHaveClass('note-drag-handle')
    expect(host.querySelector('[data-note-card]')).toHaveStyle({
      width: '520px',
      height: '400px',
    })
    expect(host.querySelector('[data-node-selected]')).toBeTruthy()
    expect(host.querySelector('button[aria-label="Collapse note"]')).toBeTruthy()

    const outsideCanvas = document.createElement('div')
    outsideCanvas.className = 'react-flow__pane'
    document.body.appendChild(outsideCanvas)
    handleExpandedChange.mockClear()

    act(() => {
      host
        .querySelector('[data-note-card]')
        ?.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, button: 0 }))
      outsideCanvas.dispatchEvent(new MouseEvent('pointerup', { bubbles: true, button: 0 }))
    })

    expect(handleExpandedChange).not.toHaveBeenCalled()

    act(() => {
      outsideCanvas.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, button: 0 }))
    })

    expect(handleExpandedChange).toHaveBeenCalledOnce()
    expect(handleExpandedChange).toHaveBeenCalledWith(false)
    outsideCanvas.remove()

    const titleEditTrigger = host.querySelector<HTMLButtonElement>(
      'button[aria-label="Edit note title"]'
    )
    expect(titleEditTrigger).toBeTruthy()
    expect(titleEditTrigger).not.toHaveClass('nodrag')

    act(() => {
      titleEditTrigger?.dispatchEvent(
        new MouseEvent('pointerdown', { bubbles: true, clientX: 10, clientY: 10 })
      )
      titleEditTrigger?.dispatchEvent(
        new MouseEvent('click', { bubbles: true, clientX: 30, clientY: 30, detail: 1 })
      )
    })

    expect(host.querySelector('input[aria-label="Note title"]')).toBeNull()

    act(() => {
      titleEditTrigger?.dispatchEvent(
        new MouseEvent('pointerdown', { bubbles: true, clientX: 10, clientY: 10 })
      )
      titleEditTrigger?.dispatchEvent(
        new MouseEvent('click', { bubbles: true, clientX: 11, clientY: 11, detail: 1 })
      )
    })

    const titleInput = host.querySelector<HTMLInputElement>('input[aria-label="Note title"]')
    expect(titleInput).toBeTruthy()
    expect(titleInput).toHaveClass(
      'nodrag',
      'nopan',
      'nowheel',
      'caret-current',
      'selection:bg-black/15'
    )
    expect(titleInput).toHaveFocus()
    expect(titleInput?.selectionStart).toBe(titleInput?.value.length)
    expect(titleInput?.selectionEnd).toBe(titleInput?.value.length)

    act(() => {
      const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
      setValue?.call(titleInput, 'Renamed note')
      titleInput?.dispatchEvent(new Event('input', { bubbles: true }))
      titleInput?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    })

    expect(handleNameChange).toHaveBeenCalledOnce()
    expect(handleNameChange).toHaveBeenCalledWith('Renamed note')

    const contentEditTrigger = host.querySelector<HTMLButtonElement>(
      'button[aria-label="Edit note content"]'
    )
    expect(contentEditTrigger).toBeTruthy()
    expect(contentEditTrigger).not.toHaveClass('nodrag')

    act(() => {
      contentEditTrigger?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })

    const contentInput = host.querySelector<HTMLTextAreaElement>(
      'textarea[aria-label="Note content"]'
    )
    expect(contentInput).toBeTruthy()
    /* The host's editor is mounted inside the view's own wrapper, which is what
       keeps a drag or wheel inside the text from panning the canvas; the note's
       selection tint reaches the editor as a prop rather than a class override. */
    expect(contentInput?.parentElement).toHaveClass('nodrag', 'nopan', 'nowheel')
    expect(contentInput).toHaveClass('selection:bg-black/15')

    act(() => {
      const setValue = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set
      setValue?.call(contentInput, `${'Maximum height content '.repeat(20)}`)
      contentInput?.dispatchEvent(new Event('input', { bubbles: true }))
    })

    expect(handleContentChange).toHaveBeenCalledWith(expect.stringContaining('Maximum height'))
    expect(host.querySelector('[data-note-card]')).toHaveStyle({ height: '400px' })

    /* Escape leaves editing, and the card owns that — the injected editor is a
       plain value surface with no exit callback of its own. */
    act(() => {
      contentInput?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    })

    expect(host.querySelector('textarea[aria-label="Note content"]')).toBeNull()
    expect(host.querySelector('[data-note-card]')).toHaveStyle({ height: '400px' })

    act(() => {
      root.render(
        <NoteBlockView
          name='Implementation notes'
          content={'Long note content\n'.repeat(40)}
          noteColor='carbon'
          isEnabled
          isFocused
          isExpanded
          canEdit
          hasRing
          ringStyles='ring-[1.5px] ring-[var(--text-secondary)]'
          onSelect={() => undefined}
          renderContentEditor={renderTestContentEditor}
          onNameChange={handleNameChange}
          onContentChange={handleContentChange}
          onExpandedChange={handleExpandedChange}
          actionBar={<div data-workflow-action-bar-swell=''>Actions</div>}
        />
      )
    })

    expect(host.querySelector('svg rect[fill="#525252"]')).toBeTruthy()
    expect(host.querySelector('svg path[fill="#3F3F3F"][stroke="#3F3F3F"]')).toBeTruthy()

    act(() => {
      host
        .querySelector<HTMLButtonElement>('button[aria-label="Edit note title"]')
        ?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })

    expect(host.querySelector('input[aria-label="Note title"]')).toHaveClass(
      'selection:bg-white/25'
    )
  })

  it('keeps an expanded note anchored while its compact height grows', () => {
    const handleHeightChange = vi.fn()
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
        name='Positioned note'
        content=''
        isEnabled
        isFocused
        isExpanded
        canEdit
        hasRing={false}
        ringStyles=''
        onSelect={() => undefined}
        renderContentEditor={renderTestContentEditor}
        onContentChange={() => undefined}
        onHeightChange={handleHeightChange}
        onExpandedChange={() => undefined}
      />
    )

    expect(host.querySelector('[data-note-layout]')).toHaveStyle({ height: '70px' })

    act(() => {
      host
        .querySelector<HTMLButtonElement>('button[aria-label="Edit note content"]')
        ?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })

    const contentInput = host.querySelector<HTMLTextAreaElement>(
      'textarea[aria-label="Note content"]'
    )
    Object.defineProperty(contentInput, 'scrollHeight', {
      configurable: true,
      value: 120,
    })

    act(() => {
      const setValue = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set
      setValue?.call(contentInput, 'Content that increases the compact note height')
      contentInput?.dispatchEvent(new Event('input', { bubbles: true }))
    })

    /*
     * The expanded card lays out at NOTE_EXPANDED_WIDTH, where the same text
     * re-wraps shorter. Publishing a height measured there would hand the store
     * a compact height that was never measured at the compact width — the node
     * would shrink for as long as the note stayed open and the collapse would
     * animate to the wrong height. Nothing is measured while expanded.
     */
    expect(handleHeightChange.mock.calls.every(([height]) => height === 70)).toBe(true)
    expect(host.querySelector('[data-note-layout]')).toHaveStyle({ height: '70px' })
    expect(host.querySelector('[data-note-card]')).toHaveStyle({ height: '400px' })
  })

  it('never publishes a height measured at the expanded width', () => {
    const handleHeightChange = vi.fn()
    let notifyResize: (() => void) | null = null
    vi.stubGlobal(
      'ResizeObserver',
      class {
        constructor(callback: () => void) {
          notifyResize = callback
        }
        observe() {}
        unobserve() {}
        disconnect() {}
      }
    )

    const noteProps = {
      name: 'Positioned note',
      content: 'Long note content\n'.repeat(40),
      isEnabled: true,
      isFocused: true,
      canEdit: true,
      hasRing: false,
      ringStyles: '',
      onSelect: () => undefined,
      onContentChange: () => undefined,
      onHeightChange: handleHeightChange,
      onExpandedChange: () => undefined,
      renderContentEditor: renderTestContentEditor,
    }

    const { host, root } = mount(<NoteBlockView {...noteProps} />)

    const measureNode = host.querySelector<HTMLElement>('[data-note-scroll-region] > div')
    expect(measureNode).toBeTruthy()
    Object.defineProperty(measureNode, 'scrollHeight', { configurable: true, value: 300 })
    handleHeightChange.mockClear()

    /*
     * A width change at the compact size is honoured — that is the only width a
     * note's height may be measured at (clamped to the scrolling maximum).
     */
    act(() => notifyResize?.())
    expect(handleHeightChange).toHaveBeenCalledWith(getNoteBlockHeight(false))

    handleHeightChange.mockClear()
    Object.defineProperty(measureNode, 'scrollHeight', { configurable: true, value: 60 })

    /*
     * Expanding lays the same text out at NOTE_EXPANDED_WIDTH, where it wraps
     * shorter. The re-measure that the expansion itself triggers must publish
     * nothing, or the node's stored height shrinks for as long as the note
     * stays open and the collapse animates to a height never measured at 320px.
     */
    act(() => root.render(<NoteBlockView {...noteProps} isExpanded />))

    expect(handleHeightChange).not.toHaveBeenCalled()
  })

  it('re-measures after a collapse that never blurred the editor', () => {
    const handleHeightChange = vi.fn()
    const observedTargets: Element[] = []
    let notifyResize: (() => void) | null = null
    vi.stubGlobal(
      'ResizeObserver',
      class {
        constructor(callback: () => void) {
          notifyResize = callback
        }
        observe(target: Element) {
          observedTargets.push(target)
        }
        unobserve() {}
        disconnect() {}
      }
    )

    const noteProps = {
      name: 'Positioned note',
      content: 'Long note content\n'.repeat(40),
      isEnabled: true,
      canEdit: true,
      hasRing: false,
      ringStyles: '',
      onSelect: () => undefined,
      onContentChange: () => undefined,
      onHeightChange: handleHeightChange,
      onExpandedChange: () => undefined,
      renderContentEditor: renderTestContentEditor,
    }

    const { host, root } = mount(<NoteBlockView {...noteProps} isFocused isExpanded />)

    act(() => {
      host
        .querySelector<HTMLButtonElement>('button[aria-label="Edit note content"]')
        ?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    expect(host.querySelector('textarea[aria-label="Note content"]')).toBeTruthy()

    /*
     * Losing edit rights collapses the note during render without blurring the
     * editor, so one frame commits collapsed-but-still-editing. The measured
     * node does not exist in that frame; the note must still be measured once
     * it comes back, or its canvas height stays at a raw line-count estimate.
     */
    observedTargets.length = 0
    handleHeightChange.mockClear()
    act(() => root.render(<NoteBlockView {...noteProps} isFocused={false} canEdit={false} />))

    const measureNode = host.querySelector<HTMLElement>('[data-note-scroll-region] > div')
    expect(measureNode).toBeTruthy()
    expect(observedTargets).toContain(measureNode)

    Object.defineProperty(measureNode, 'scrollHeight', { configurable: true, value: 300 })
    act(() => notifyResize?.())

    expect(handleHeightChange).toHaveBeenLastCalledWith(getNoteBlockHeight(false))
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
    /* Height comes from `CONTAINER_DIMENSIONS`, which the layout math also
       measures against — asserting the rendered value rather than a utility
       class keeps the two from drifting apart again. */
    expect(header).toHaveStyle({ height: `${CONTAINER_DIMENSIONS.HEADER_HEIGHT}px` })
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
