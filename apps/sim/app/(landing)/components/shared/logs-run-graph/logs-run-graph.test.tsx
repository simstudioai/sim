/**
 * @vitest-environment jsdom
 */
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CoreFeatureCard } from '@/app/(landing)/components/features/components/core-feature-card'
import { LogsRunGraph } from '@/app/(landing)/components/shared/logs-run-graph'
import { RunTraceGraphic } from '@/app/(landing)/logs/components/feature-graphics'

let root: Root
let host: HTMLDivElement

beforeEach(() => {
  vi.useFakeTimers()
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
})

afterEach(() => {
  act(() => root.unmount())
  host.remove()
  vi.restoreAllMocks()
  vi.useRealTimers()
})

function mount() {
  act(() => root.render(<LogsRunGraph layout='card' />))
  const graph = host.querySelector<HTMLButtonElement>('button')
  if (!graph) throw new Error('Graph not rendered')
  return graph
}

function pointer(element: Element, type: string, pointerType = 'touch', x = 40, y = 300) {
  const event = new MouseEvent(type, { bubbles: true, clientX: x, clientY: y })
  Object.defineProperty(event, 'pointerType', { value: pointerType })
  act(() => element.dispatchEvent(event))
}

describe('LogsRunGraph', () => {
  it('keeps tapped details visible and dismisses them on outside interaction', () => {
    const graph = mount()
    const bar = graph.querySelectorAll('[data-run-count]')[1]
    pointer(bar, 'pointerdown')
    pointer(bar, 'pointerup')
    pointer(graph, 'pointerout')
    expect(document.querySelector('[role="tooltip"]')?.textContent).toContain('5 succeeded')
    expect(graph.getAttribute('aria-label')).toContain('23–22 hours ago')
    pointer(document.body, 'pointerdown')
    expect(document.querySelector('[role="tooltip"]')).toBeNull()
  })

  it.each(['pointercancel', 'swipe'])('does not open details after a %s gesture', (gesture) => {
    const graph = mount()
    pointer(graph, 'pointerdown')
    if (gesture === 'pointercancel') pointer(graph, 'pointercancel')
    pointer(graph, 'pointerup', 'touch', gesture === 'swipe' ? 120 : 40)
    expect(document.querySelector('[role="tooltip"]')).toBeNull()
  })

  it.each(['scroll', 'resize'])(
    'dismisses details when the viewport changes through %s',
    (event) => {
      const graph = mount()
      pointer(graph, 'pointerdown')
      pointer(graph, 'pointerup')
      expect(document.querySelector('[role="tooltip"]')).not.toBeNull()
      act(() => (event === 'resize' ? window : host).dispatchEvent(new Event(event)))
      expect(document.querySelector('[role="tooltip"]')).toBeNull()
    }
  )

  it('supports keyboard exploration and Escape dismissal', () => {
    const graph = mount()
    act(() => graph.focus())
    act(() => graph.dispatchEvent(new KeyboardEvent('keydown', { key: 'End', bubbles: true })))
    expect(graph.getAttribute('aria-label')).toContain('Last hour: 7 succeeded')
    act(() =>
      graph.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }))
    )
    expect(graph.getAttribute('aria-label')).toContain('2–1 hours ago: 6 succeeded')
    act(() => graph.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })))
    expect(document.querySelector('[role="tooltip"]')).toBeNull()
  })

  it('keeps first-hour details inside a narrow viewport', () => {
    const graph = mount()
    vi.spyOn(window, 'innerWidth', 'get').mockReturnValue(320)
    pointer(graph, 'pointerdown')
    pointer(graph, 'pointerup')
    const tooltip = document.querySelector<HTMLElement>('[role="tooltip"]')
    expect(tooltip?.style.translate).toContain('calc(192px - 100%)')
    expect(tooltip?.className).toContain('w-[176px]')
  })

  it('keeps the interactive chart outside the route link and decorative wrappers', () => {
    act(() =>
      root.render(
        <CoreFeatureCard
          title='Logs'
          description='Inspect sample runs'
          href='/logs'
          visual={<RunTraceGraphic />}
          interactiveVisual
        />
      )
    )
    const graph = host.querySelector('[data-run-overview-graph]')
    expect(graph).not.toBeNull()
    expect(graph?.closest('a, [aria-hidden="true"]')).toBeNull()
    expect(host.querySelector('a')?.getAttribute('href')).toBe('/logs')
  })
})
