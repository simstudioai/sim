/**
 * @vitest-environment jsdom
 */
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  EvalStatusIndicator,
  type EvalStatusIndicatorStatus,
} from '@/components/ui/eval-status-indicator'

let container: HTMLDivElement
let root: Root

beforeEach(() => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
})

function getIndicator(): SVGSVGElement {
  const indicator = container.querySelector<SVGSVGElement>('svg[data-eval-status]')
  if (!indicator) throw new Error('Missing eval status indicator')
  return indicator
}

describe('EvalStatusIndicator', () => {
  it('renders pending and settled indicators without the progress filter', () => {
    const statuses: EvalStatusIndicatorStatus[] = [
      'pending',
      'complete',
      'failed',
      'partial-success',
      'partial-failure',
    ]

    for (const status of statuses) {
      act(() => root.render(<EvalStatusIndicator status={status} label={`Test: ${status}`} />))

      const indicator = getIndicator()
      expect(indicator.dataset.evalStatus).toBe(status)
      expect(indicator.querySelectorAll('filter')).toHaveLength(0)
      expect(indicator.querySelectorAll('rect')).toHaveLength(0)
      expect(indicator.querySelectorAll('defs')).toHaveLength(status === 'pending' ? 0 : 1)
    }
  })

  it('mounts the goo filter and squeeze geometry only while progress is active', () => {
    act(() => root.render(<EvalStatusIndicator status='progress' label='Test: Running' />))

    const indicator = getIndicator()
    expect(indicator.querySelectorAll('filter')).toHaveLength(1)
    expect(indicator.querySelectorAll('rect')).toHaveLength(2)

    act(() => root.render(<EvalStatusIndicator status='complete' label='Test: Passed' />))

    expect(getIndicator()).toBe(indicator)
    expect(indicator.querySelectorAll('filter')).toHaveLength(0)
    expect(indicator.querySelectorAll('rect')).toHaveLength(0)
  })

  it('can hold progress geometry at the fully squeezed state', () => {
    act(() =>
      root.render(
        <EvalStatusIndicator status='progress' progressMode='squeezed' label='Eval agent' />
      )
    )

    const indicator = getIndicator()
    const progress = indicator.querySelector('[data-eval-progress-mode="squeezed"]')
    if (!progress) throw new Error('Missing squeezed progress geometry')
    const bars = progress.querySelectorAll('rect')
    expect(bars).toHaveLength(2)
    expect(bars[0].getAttribute('transform')).toBe('translate(10 0)')
    expect(bars[1].getAttribute('transform')).toBe('translate(-10 0)')
    expect(bars[0].getAttribute('class')).toBeNull()
    expect(bars[1].getAttribute('class')).toBeNull()
  })

  it('renders partial results as an 80% outline over a faint full-ring track', () => {
    const statuses = ['partial-success', 'partial-failure'] as const

    for (const status of statuses) {
      act(() => root.render(<EvalStatusIndicator status={status} label={`Test: ${status}`} />))

      const indicator = getIndicator()
      const circles = indicator.querySelectorAll('circle')
      expect(circles).toHaveLength(2)
      expect(indicator.querySelectorAll('path')).toHaveLength(0)

      const [track, arc] = circles
      expect(track.getAttribute('r')).toBe('31.25')
      expect(track.getAttribute('fill')).toBe('none')
      expect(track.getAttribute('stroke-width')).toBe('12.5')
      expect(arc.getAttribute('r')).toBe('31.25')
      expect(arc.getAttribute('fill')).toBe('none')
      expect(arc.getAttribute('stroke-width')).toBe('12.5')
      expect(arc.getAttribute('pathLength')).toBe('100')
      expect(arc.getAttribute('stroke-dasharray')).toBe('80 20')
      expect(arc.getAttribute('transform')).toBe('rotate(-90 50 50)')
    }
  })

  it('renders a spaced selection ring with the matching status gradient', () => {
    act(() =>
      root.render(
        <EvalStatusIndicator
          status='failed'
          label='Test: Failed'
          selected
          selectionTone='failure'
        />
      )
    )

    const indicator = getIndicator()
    const ring = indicator.querySelector<SVGCircleElement>('[data-eval-selection-ring]')
    if (!ring) throw new Error('Missing eval selection ring')
    expect(ring.getAttribute('r')).toBe('44')
    expect(ring.getAttribute('fill')).toBe('none')
    expect(ring.getAttribute('stroke')).toContain('eval-status-failure-')
  })

  it('renders every status as a non-interactive image', () => {
    const statuses: EvalStatusIndicatorStatus[] = [
      'pending',
      'progress',
      'complete',
      'failed',
      'partial-success',
      'partial-failure',
    ]

    for (const status of statuses) {
      act(() => root.render(<EvalStatusIndicator status={status} label={`Test: ${status}`} />))

      const indicator = getIndicator()
      expect(indicator.getAttribute('role')).toBe('img')
      expect(indicator.getAttribute('tabindex')).toBeNull()
      expect(indicator.getAttribute('aria-pressed')).toBeNull()
    }
  })

  it('removes decorative filler indicators from the accessibility tree', () => {
    act(() => root.render(<EvalStatusIndicator status='pending' decorative />))

    const indicator = getIndicator()
    expect(indicator.getAttribute('aria-hidden')).toBe('true')
    expect(indicator.getAttribute('aria-label')).toBeNull()
    expect(indicator.getAttribute('role')).toBeNull()
  })
})
