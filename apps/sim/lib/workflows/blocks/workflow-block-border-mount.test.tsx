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
  getHorizontalWorkflowHandleSide,
  normalizePositionedSourceHandleId,
  normalizePositionedTargetHandleId,
  POSITIONED_SOURCE_HANDLE_SIDES,
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
    expect(normalizeCursorSourceHandleId('source-cursor-left', 'loop')).toBe('loop-end-source')
    expect(normalizeCursorSourceHandleId('source-cursor-right', 'parallel')).toBe(
      'parallel-end-source'
    )
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
      'w-[320px]',
      'transition-[color,width,height]',
      'cursor-grab'
    )
    expect(host.querySelector('[data-note-card]')).not.toHaveClass('cursor-text')
    expect(host.querySelector('[data-note-card]')).toHaveStyle({ height: '240px' })
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
          onNameChange={handleNameChange}
          onContentChange={handleContentChange}
          onExpandedChange={handleExpandedChange}
          actionBar={<div data-workflow-action-bar-swell=''>Actions</div>}
        />
      )
    })

    expect(host.querySelector('[data-note-card]')).toHaveClass(
      'w-[320px]',
      'transition-[color,width,height]',
      'note-drag-handle',
      'cursor-text'
    )
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
          onNameChange={handleNameChange}
          onContentChange={handleContentChange}
          onExpandedChange={handleExpandedChange}
          actionBar={<div data-workflow-action-bar-swell=''>Actions</div>}
        />
      )
    })

    expect(host.querySelector('[data-note-expanded]')).toBeTruthy()
    expect(host.querySelector('[data-note-card]')).toHaveClass(
      'nodrag',
      'w-[520px]',
      'cursor-default'
    )
    expect(host.querySelector('[data-note-card]')).not.toHaveClass('note-drag-handle')
    expect(host.querySelector('[data-note-card]')).toHaveStyle({ height: '400px' })
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
    expect(contentInput).toHaveClass(
      'nodrag',
      'nopan',
      'nowheel',
      'caret-current',
      'selection:bg-black/15'
    )
    expect(contentInput).toHaveFocus()

    let textareaScrollHeight = 30
    Object.defineProperty(contentInput, 'scrollHeight', {
      configurable: true,
      get: () => textareaScrollHeight,
    })

    act(() => {
      textareaScrollHeight = 90
      const setValue = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set
      setValue?.call(contentInput, 'Updated note content')
      contentInput?.dispatchEvent(new Event('input', { bubbles: true }))
    })

    expect(host.querySelector('[data-note-card]')).toHaveStyle({ height: '400px' })

    act(() => {
      textareaScrollHeight = 400
      const setValue = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set
      setValue?.call(contentInput, `${'Maximum height content '.repeat(20)}`)
      contentInput?.dispatchEvent(new Event('input', { bubbles: true }))
      contentInput?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    })

    expect(host.querySelector('[data-note-card]')).toHaveStyle({ height: '400px' })
    expect(handleContentChange).toHaveBeenCalledWith(expect.stringContaining('Maximum height'))

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

    expect(handleHeightChange.mock.calls.some(([height]) => height > 70)).toBe(true)
    expect(host.querySelector('[data-note-layout]')).toHaveStyle({ height: '70px' })
    expect(host.querySelector('[data-note-card]')).toHaveStyle({ height: '400px' })
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
