/** @vitest-environment jsdom */
import { act } from 'react'
import { AnimatedNumber, DashboardMetric } from '@sim/emcn'
import type { MotionValue } from 'framer-motion'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ animate: vi.fn(), stop: vi.fn(), reducedMotion: false }))
vi.mock('framer-motion', async (importOriginal) => ({
  ...(await importOriginal<typeof import('framer-motion')>()),
  animate: mocks.animate,
  useReducedMotion: () => mocks.reducedMotion,
}))

describe('AnimatedNumber', () => {
  let container: HTMLDivElement
  let root: Root

  async function render(value: number, maximumFractionDigits?: number) {
    await act(async () =>
      root.render(<AnimatedNumber value={value} maximumFractionDigits={maximumFractionDigits} />)
    )
  }
  function visibleValue() {
    return container.querySelector('[aria-hidden]')?.textContent
  }
  beforeEach(() => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    mocks.reducedMotion = false
    mocks.animate.mockReturnValue({ stop: mocks.stop })
    container = document.createElement('div')
    root = createRoot(container)
  })
  afterEach(() => {
    act(() => root.unmount())
    vi.resetAllMocks()
    vi.unstubAllGlobals()
  })

  it('shows the initial value immediately and exposes the target separately from animated digits', async () => {
    await render(25)
    expect(visibleValue()).toBe('25')
    expect(mocks.animate).not.toHaveBeenCalled()
    await render(38)
    expect(visibleValue()).toBe('25')
    expect(container.querySelector('.sr-only')?.textContent).toBe('38')
  })

  it('retargets from the number currently on screen when interrupted', async () => {
    await render(25)
    await render(38)
    const displayed = mocks.animate.mock.calls[0][0] as MotionValue<number>
    await act(async () => displayed.set(31))
    await vi.waitFor(() => expect(visibleValue()).toBe('31'))
    await render(10)
    expect(visibleValue()).toBe('31')
    expect(mocks.stop).toHaveBeenCalledTimes(1)
    expect(mocks.animate.mock.calls[1][0]).toBe(displayed)
    expect(mocks.animate.mock.calls[1][1]).toBe(10)
    await act(async () => displayed.set(10))
    await vi.waitFor(() => expect(visibleValue()).toBe('10'))
  })

  it('updates immediately with reduced motion and retains decimal formatting', async () => {
    mocks.reducedMotion = true
    await render(1.25, 2)
    await render(2.75, 2)
    await vi.waitFor(() => expect(visibleValue()).toBe('2.75'))
    expect(mocks.animate).not.toHaveBeenCalled()
  })

  it('eases decimal values in and out without rounding when the target becomes a whole number', async () => {
    async function renderMetric(value: number) {
      await act(async () =>
        root.render(<DashboardMetric label='First response' value={value} animated unit='s' />)
      )
    }
    await renderMetric(8.49)
    expect(visibleValue()).toBe('8.49')
    await renderMetric(10)
    expect(visibleValue()).toBe('8.49')
    const [displayed, target, options] = mocks.animate.mock.calls[0] as [
      MotionValue<number>,
      number,
      { ease: string },
    ]
    expect(target).toBe(10)
    expect(options.ease).toBe('easeInOut')
    await act(async () => displayed.set(9.25))
    await vi.waitFor(() => expect(visibleValue()).toBe('9.25'))
    await act(async () => displayed.set(10))
    await vi.waitFor(() => expect(visibleValue()).toBe('10'))
    await renderMetric(7.75)
    await act(async () => displayed.set(8.5))
    await vi.waitFor(() => expect(visibleValue()).toBe('8.5'))
    await act(async () => displayed.set(7.75))
    await vi.waitFor(() => expect(visibleValue()).toBe('7.75'))
  })

  it('keeps count animations in whole numbers when configured with zero fraction digits', async () => {
    await render(25, 0)
    await render(38, 0)
    const displayed = mocks.animate.mock.calls[0][0] as MotionValue<number>
    await act(async () => displayed.set(31.25))
    await vi.waitFor(() => expect(visibleValue()).toBe('31'))
  })

  it('supports explicit precision for small fractional values', async () => {
    await render(0.00125, 5)
    expect(visibleValue()).toBe('0.00125')
    await render(0.00275, 5)
    const displayed = mocks.animate.mock.calls[0][0] as MotionValue<number>
    await act(async () => displayed.set(0.00215))
    await vi.waitFor(() => expect(visibleValue()).toBe('0.00215'))
  })
})
