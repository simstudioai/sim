/**
 * @vitest-environment jsdom
 */
import { act, type ComponentProps, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { WorkflowMenuPreview } from '@/app/(landing)/components/navbar/components/nav-menu-chip/components/nav-menu-preview/components/workflow-menu-preview/workflow-menu-preview'

const { paintedCards, toolbarCallbacks } = vi.hoisted(() => ({
  paintedCards: new Set<string>(),
  toolbarCallbacks: new Map<string, (ready: boolean) => void>(),
}))

vi.mock('@sim/emcn', () => ({
  cn: (...values: Array<string | false | null | undefined>) => values.filter(Boolean).join(' '),
  Button: (props: ComponentProps<'button'>) => <button {...props} />,
  Check: () => null,
  Duplicate: () => null,
  handleKeyboardActivation: () => undefined,
  PlayOutline: () => null,
  Switch: () => null,
  Trash: () => null,
  Tooltip: {
    Root: ({ children }: { children: ReactNode }) => children,
    Trigger: ({ children }: { children: ReactNode }) => children,
    Content: () => null,
  },
}))

vi.mock('@sim/emcn/icons', () => ({
  Circle: () => null,
  Square: () => null,
  Unlock: () => null,
}))

vi.mock('@sim/workflow-renderer', () => ({
  BLOCK_DIMENSIONS: { MIN_PAINTED_HEIGHT: 48 },
  CanvasSentenceView: () => null,
  HANDLE_POSITIONS: { CONDITION_START_Y: 58, CONDITION_ROW_HEIGHT: 24 },
  InlineChip: ({ children }: { children: ReactNode }) => children,
  SubBlockRowView: () => null,
  WorkflowTypeTag: () => null,
  WorkflowBlockBorder: ({
    nodeId,
    onActionMenuReadyChange,
  }: {
    nodeId: string
    onActionMenuReadyChange?: (ready: boolean) => void
  }) => {
    if (onActionMenuReadyChange) toolbarCallbacks.set(nodeId, onActionMenuReadyChange)
    return (
      <svg>
        {paintedCards.has(nodeId) ? <path d='M0 0H250V100H0Z' fill='white' stroke='gray' /> : null}
      </svg>
    )
  },
}))

vi.mock('@/app/(landing)/components/hero/components/hero-platform-loop/stage-data', () => ({
  STAGE_BLOCKS: [
    { id: 'start', name: 'Start', isTrigger: true, rows: [] },
    { id: 'enrich', name: 'Enrich lead', rows: [] },
    { id: 'score', name: 'Score company fit', rows: [] },
  ],
}))

vi.mock('@/app/(landing)/components/hero/components/hero-visual/workflow-data', () => ({
  blockHeight: () => 100,
  horizontalHandleAnchors: () => ({ in: { x: 0, y: 0 }, out: { x: 250, y: 50 } }),
  smoothStep: () => 'M0 0H250',
}))

vi.mock('@/app/(landing)/components/shared/edge-fade', () => ({ EdgeFade: () => null }))

let host: HTMLDivElement
let root: Root

beforeEach(() => {
  paintedCards.clear()
  toolbarCallbacks.clear()
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
})

afterEach(() => {
  act(() => root.unmount())
  host.remove()
  vi.unstubAllGlobals()
})

describe('Workflow hero readiness', () => {
  it('waits for every silhouette and the selected toolbar, then reports only once', () => {
    const onReady = vi.fn()
    act(() => root.render(<WorkflowMenuPreview layout='hero' onReady={onReady} />))
    expect(onReady).not.toHaveBeenCalled()

    paintedCards.add('start')
    paintedCards.add('enrich')
    act(() => root.render(<WorkflowMenuPreview layout='hero' onReady={onReady} />))
    act(() => toolbarCallbacks.get('enrich')?.(true))
    expect(onReady).not.toHaveBeenCalled()

    paintedCards.add('score')
    act(() => root.render(<WorkflowMenuPreview layout='hero' onReady={onReady} />))
    expect(onReady).toHaveBeenCalledTimes(1)

    act(() => toolbarCallbacks.get('enrich')?.(false))
    act(() => toolbarCallbacks.get('enrich')?.(true))
    act(() => root.render(<WorkflowMenuPreview layout='hero' onReady={onReady} />))
    expect(onReady).toHaveBeenCalledTimes(1)
  })

  it('keeps the graphic pending when the frames exist but the toolbar is still opening', () => {
    const onReady = vi.fn()
    for (const id of ['start', 'enrich', 'score']) paintedCards.add(id)
    act(() => root.render(<WorkflowMenuPreview layout='hero' onReady={onReady} />))
    expect(onReady).not.toHaveBeenCalled()

    act(() => toolbarCallbacks.get('enrich')?.(true))
    expect(onReady).toHaveBeenCalledTimes(1)
  })

  it('leaves the nav preview independent of hero readiness', () => {
    const onReady = vi.fn()
    for (const id of ['start', 'enrich', 'score']) paintedCards.add(id)
    act(() => root.render(<WorkflowMenuPreview onReady={onReady} />))
    act(() => toolbarCallbacks.get('enrich')?.(true))
    expect(onReady).not.toHaveBeenCalled()
    expect(host.querySelector('[data-preview-layout]')?.getAttribute('data-preview-layout')).toBe(
      'menu'
    )
  })
})
