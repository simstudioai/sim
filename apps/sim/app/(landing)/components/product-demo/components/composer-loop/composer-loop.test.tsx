/**
 * @vitest-environment jsdom
 */
import { act, type ReactNode } from 'react'
import { usePrefersReducedMotion } from '@sim/emcn/hooks/use-prefers-reduced-motion'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@sim/emcn', () => ({
  cn: (...values: Array<string | false | undefined>) => values.filter(Boolean).join(' '),
  usePrefersReducedMotion,
}))
vi.mock('@sim/emcn/icons', () => ({ Blimp: () => null, Table: () => null }))
vi.mock('@/components/ui', () => ({ ThinkingLoader: () => null }))
vi.mock('framer-motion', () => ({
  AnimatePresence: ({ children }: { children: ReactNode }) => children,
  MotionConfig: ({ children }: { children: ReactNode }) => children,
  motion: {
    div: ({ children }: { children: ReactNode }) => <div>{children}</div>,
    span: ({ children }: { children: ReactNode }) => <span>{children}</span>,
  },
}))
vi.mock(
  '@/app/(landing)/components/hero/components/hero-platform-loop/production-workflow-stage',
  () => ({
    ProductionWorkflowStage: ({ builtCount }: { builtCount: number }) => (
      <div data-workflow-blocks={builtCount} />
    ),
  })
)
vi.mock('@/app/(landing)/components/product-demo/components/composer-loop/demo-composer', () => ({
  DemoComposer: ({ prompt }: { prompt: string }) => <div data-composer>{prompt}</div>,
}))

import { ComposerLoop } from '@/app/(landing)/components/product-demo/components/composer-loop/composer-loop'
import { DEMO_BLOCKS } from '@/app/(landing)/components/product-demo/components/composer-loop/demo-workflow-data'

let root: Root
let host: HTMLDivElement
let reducedMotion: boolean
let motionListeners: Set<() => void>

beforeEach(() => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
  reducedMotion = false
  motionListeners = new Set()
  vi.stubGlobal('matchMedia', () => ({
    get matches() {
      return reducedMotion
    },
    addEventListener: (_event: string, callback: () => void) => motionListeners.add(callback),
    removeEventListener: (_event: string, callback: () => void) => motionListeners.delete(callback),
  }))
  vi.stubGlobal('IntersectionObserver', undefined)
  vi.stubGlobal('ResizeObserver', undefined)
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
})

afterEach(() => {
  act(() => root.unmount())
  host.remove()
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

function setReducedMotion(value: boolean) {
  act(() => {
    reducedMotion = value
    motionListeners.forEach((listener) => listener())
  })
}

describe('ComposerLoop motion preference', () => {
  it('shows the completed workflow without starting decorative timers when motion is reduced', () => {
    reducedMotion = true
    const onBeat = vi.fn()
    act(() => root.render(<ComposerLoop onBeat={onBeat} />))

    expect(host.querySelector('[data-workflow-blocks]')?.getAttribute('data-workflow-blocks')).toBe(
      String(DEMO_BLOCKS.length)
    )
    expect(host.querySelector('[data-composer]')).toBeNull()
    expect(onBeat).toHaveBeenLastCalledWith('build')
    expect(vi.getTimerCount()).toBe(0)

    act(() => vi.advanceTimersByTime(60_000))
    expect(host.querySelector('[data-composer]')).toBeNull()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('cancels an active pass immediately when reduced motion is enabled', () => {
    const onBeat = vi.fn()
    act(() => root.render(<ComposerLoop onBeat={onBeat} />))
    act(() => vi.advanceTimersByTime(1_100))
    expect(host.querySelector('[data-composer]')?.textContent).not.toBe('')
    expect(vi.getTimerCount()).toBeGreaterThan(0)

    setReducedMotion(true)
    expect(host.querySelector('[data-composer]')).toBeNull()
    expect(host.querySelector('[data-workflow-blocks]')?.getAttribute('data-workflow-blocks')).toBe(
      String(DEMO_BLOCKS.length)
    )
    expect(vi.getTimerCount()).toBe(0)
    act(() => vi.advanceTimersByTime(60_000))
    expect(onBeat).toHaveBeenLastCalledWith('build')
  })

  it('starts a fresh pass when motion is enabled again and unsubscribes on unmount', () => {
    reducedMotion = true
    act(() => root.render(<ComposerLoop />))
    setReducedMotion(false)
    expect(host.querySelector('[data-composer]')?.textContent).toBe('')
    act(() => vi.advanceTimersByTime(1_100))
    expect(host.querySelector('[data-composer]')?.textContent).not.toBe('')

    act(() => root.unmount())
    expect(vi.getTimerCount()).toBe(0)
    expect(motionListeners.size).toBe(0)
  })
})
