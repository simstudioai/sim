/**
 * @vitest-environment jsdom
 */
import { act, type HTMLAttributes, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const animation = vi.hoisted(() => ({
  start: () => {},
  complete: (_state: string) => {},
  reduced: false,
}))

vi.mock('@sim/emcn', () => ({
  cn: (...values: unknown[]) => values.filter(Boolean).join(' '),
  usePrefersReducedMotion: () => animation.reduced,
}))
vi.mock('@/lib/branding/wordmark', () => ({
  WORDMARK_PATHS: [],
  WORDMARK_VIEW_BOX: { width: 100, height: 40 },
}))
vi.mock('@/app/(landing)/components/landing-cta-link', () => ({
  LandingCtaLink: ({ children }: { children: ReactNode }) => <a href='/signup'>{children}</a>,
}))
vi.mock('framer-motion', () => ({
  motion: {
    div: ({
      children,
      onAnimationStart,
      onAnimationComplete,
      initial: _initial,
      animate: _animate,
      variants: _variants,
      transition: _transition,
      ...props
    }: Omit<HTMLAttributes<HTMLDivElement>, 'onAnimationStart'> & {
      onAnimationStart: () => void
      onAnimationComplete: (state: string) => void
      initial: boolean
      animate: string
      variants: unknown
      transition: unknown
    }) => {
      animation.start = onAnimationStart
      animation.complete = onAnimationComplete
      return <div {...props}>{children}</div>
    },
  },
}))

import { StackIntro } from '@/app/(landing)/components/sim-stack/stack-intro'

let root: Root
let host: HTMLDivElement

function render(element: ReactNode) {
  const rerender = (next: ReactNode) => act(() => root.render(next))
  rerender(element)
  return { container: host, rerender }
}

function getCta(container: HTMLElement) {
  return container.querySelector('[data-stack-completion-cta]') as HTMLElement
}

function expectInteractive(cta: HTMLElement, interactive: boolean) {
  expect(cta.hasAttribute('inert')).toBe(!interactive)
  expect(cta.getAttribute('aria-hidden')).toBe(String(!interactive))
}

describe('StackIntro CTA focus', () => {
  beforeEach(() => {
    animation.reduced = false
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    host = document.createElement('div')
    document.body.appendChild(host)
    root = createRoot(host)
  })

  afterEach(() => {
    act(() => root.unmount())
    host.remove()
    vi.unstubAllGlobals()
  })

  it('keeps the CTA inert until its entrance finishes', () => {
    const { container, rerender } = render(<StackIntro progress={4} />)
    expectInteractive(getCta(container), false)
    rerender(<StackIntro progress={5} />)
    act(() => animation.start())
    expectInteractive(getCta(container), false)
    act(() => animation.complete('visible'))
    expectInteractive(getCta(container), true)
  })

  it('disables focus immediately on rewind and waits for the next entrance', () => {
    const { container, rerender } = render(<StackIntro progress={6} />)
    expectInteractive(getCta(container), true)
    rerender(<StackIntro progress={4} />)
    expectInteractive(getCta(container), false)
    act(() => animation.start())
    rerender(<StackIntro progress={5} />)
    expectInteractive(getCta(container), false)
    act(() => animation.complete('visible'))
    expectInteractive(getCta(container), true)
  })

  it('keeps an interrupted entrance inert when it finishes hidden', () => {
    const { container, rerender } = render(<StackIntro progress={4} />)
    rerender(<StackIntro progress={5} />)
    act(() => animation.start())
    rerender(<StackIntro progress={4} />)
    act(() => animation.complete('hidden'))
    expectInteractive(getCta(container), false)
  })

  it('makes a completed initial scene interactive with reduced motion', () => {
    animation.reduced = true
    const { container } = render(<StackIntro progress={6} />)
    expectInteractive(getCta(container), true)
  })
})
