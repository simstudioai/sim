/**
 * @vitest-environment jsdom
 */
import { act, type ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const motionPreference = vi.hoisted(() => ({ reduced: false }))

vi.mock('@sim/emcn', () => ({
  Button: (props: React.ButtonHTMLAttributes<HTMLButtonElement>) => <button {...props} />,
  ChipTag: ({ children }: { children: ReactNode }) => <span>{children}</span>,
  cn: (...values: Array<string | false | null | undefined>) => values.filter(Boolean).join(' '),
  usePrefersReducedMotion: () => motionPreference.reduced,
  Tooltip: {
    Root: ({ children }: { children: ReactNode }) => children,
    Trigger: ({ children }: { children: ReactNode }) => children,
    Content: ({ children }: { children: ReactNode }) => (
      <span data-testid='customer-tooltip'>{children}</span>
    ),
  },
}))

vi.mock('next/image', () => ({
  default: ({ src, alt, className }: { src: string; alt: string; className?: string }) => (
    <img src={src} alt={alt} className={className} />
  ),
}))

vi.mock('@sim/emcn/icons', () => ({
  ArrowLeft: () => <svg aria-hidden='true' />,
  ArrowRight: () => <svg aria-hidden='true' />,
}))

import { FeaturedCustomer } from '@/app/(landing)/components/featured-customer/featured-customer'

beforeEach(() => {
  motionPreference.reduced = false
  vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined)
  vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {})
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
  document.body.replaceChildren()
})

describe('FeaturedCustomer', () => {
  it('keeps the next story outside the centered card and brings it into focus', () => {
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    const host = document.createElement('div')
    document.body.appendChild(host)
    const root = createRoot(host)

    act(() => {
      root.render(<FeaturedCustomer />)
    })

    const rivian = host.querySelector('[aria-label="1 of 2: Rivian"]') as HTMLElement
    const expRealty = host.querySelector('[aria-label="2 of 2: eXp Realty"]') as HTMLElement
    const nextButton = host.querySelector(
      '[aria-label="View eXp Realty customer story"]'
    ) as HTMLButtonElement
    const expRealtyContent = expRealty.querySelector(
      '[data-customer-story-content="true"]'
    ) as HTMLElement
    const carouselRail = host.querySelector('[data-customer-carousel-rail="true"]') as HTMLElement
    const video = rivian.querySelector('video') as HTMLVideoElement
    video.currentTime = 12

    expect(video.play).toHaveBeenCalledOnce()

    expect(rivian.querySelector('img[alt="Rivian | Volkswagen Group Technologies"]')).not.toBeNull()
    expect(host.querySelector('blockquote')).toBeNull()
    expect(host.textContent).not.toContain('Jordan Lee')
    expect(host.textContent).not.toContain('Director of Enterprise Systems')
    expect(host.textContent).not.toContain('eXp Realty team')
    expect(rivian.textContent).toContain(
      'Connect systems and build, deploy, and manage AI agents with Sim.'
    )
    expect(expRealty.textContent).toContain(
      'Bring teams, shared knowledge, and AI agents into one workspace with Sim.'
    )
    expect(rivian.querySelector('video')?.getAttribute('src')).toBe(
      '/landing/customer-stories/rivian-r2-loop.mp4'
    )
    const expVideo = expRealty.querySelector('video') as HTMLVideoElement
    expect(expVideo.getAttribute('src')).toBe('/landing/customer-stories/exp-house-color-loop.mp4')
    expect(expVideo.getAttribute('preload')).toBe('none')
    expect(expVideo.muted).toBe(true)
    expect(vi.mocked(video.play).mock.contexts).not.toContain(expVideo)
    expect(
      [...expRealty.querySelectorAll('img')].map((image) => image.getAttribute('src'))
    ).toEqual([
      '/landing/customer-stories/exp-house-color-poster.jpg',
      '/landing/logos/exp-realty.svg',
    ])

    const controls = nextButton.parentElement as HTMLElement
    expect(controls.className).toContain('justify-end')
    expect(controls.className).toContain('xl:pr-24')
    expect(controls.nextElementSibling).toBe(carouselRail)
    const disabledPrevious = host.querySelector(
      '[aria-label="Previous customer story"]'
    ) as HTMLButtonElement
    expect(disabledPrevious.disabled).toBe(true)
    expect(nextButton.disabled).toBe(false)
    expect(carouselRail.className).toContain('xl:pr-24')
    expect(carouselRail.className).not.toContain('xl:pl-24')

    expect(rivian.querySelector('article')?.getAttribute('aria-hidden')).toBe('false')
    expect(rivian.getAttribute('aria-current')).toBe('true')
    expect(rivian.className).toContain('translate-x-0')
    expect(expRealty.getAttribute('aria-current')).toBeNull()
    expect(expRealty.className).toContain('translate-x-[calc(100%_+_1.5rem)]')
    expect(expRealty.className).toContain('opacity-75')
    expect(expRealtyContent.className).toContain('translate-y-2')
    expect(expRealtyContent.className).toContain('opacity-40')
    expect(
      [...host.querySelectorAll('[data-testid="customer-tooltip"]')].map((node) => node.textContent)
    ).toEqual(['View eXp Realty customer story'])

    act(() => {
      nextButton.click()
    })

    expect(rivian.getAttribute('aria-current')).toBeNull()
    expect(rivian.querySelector('article')?.getAttribute('aria-hidden')).toBe('true')
    expect(rivian.className).toContain('-translate-x-[calc(100%_+_1.5rem)]')
    expect(expRealty.getAttribute('aria-current')).toBe('true')
    expect(vi.mocked(video.play).mock.contexts).toContain(expVideo)
    expect(expRealty.querySelector('article')?.getAttribute('aria-hidden')).toBe('false')
    expect(expRealty.className).toContain('translate-x-0')
    expect(expRealty.className).toContain('opacity-100')
    expect(expRealtyContent.className).toContain('translate-y-0')
    expect(expRealtyContent.className).toContain('opacity-100')
    expect(carouselRail.className).toContain('xl:translate-x-24')
    expect(carouselRail.className).toContain('xl:pr-24')
    const previousButton = host.querySelector(
      '[aria-label="View Rivian customer story"]'
    ) as HTMLButtonElement
    expect(previousButton.disabled).toBe(false)
    const disabledNext = host.querySelector(
      '[aria-label="Next customer story"]'
    ) as HTMLButtonElement
    expect(disabledNext.disabled).toBe(true)
    expect(expRealty.querySelector('img[alt="eXp Realty"]')).not.toBeNull()
    expect(host.querySelector('video')).toBe(video)
    expect(video.currentTime).toBe(12)
    expect(
      vi.mocked(video.pause).mock.contexts.filter((context) => context === video)
    ).toHaveLength(1)
    expect(
      [...expRealty.querySelectorAll('img')].map((image) => image.getAttribute('src'))
    ).toEqual([
      '/landing/customer-stories/exp-house-color-poster.jpg',
      '/landing/logos/exp-realty.svg',
    ])
    expect(
      [...host.querySelectorAll('[data-testid="customer-tooltip"]')].map((node) => node.textContent)
    ).toEqual(['View Rivian customer story'])

    act(() => {
      previousButton.click()
    })

    expect(rivian.getAttribute('aria-current')).toBe('true')
    expect(expRealty.getAttribute('aria-current')).toBeNull()
    expect(rivian.querySelector('video')).toBe(video)
    expect(video.currentTime).toBe(12)
    expect(vi.mocked(video.play).mock.contexts.filter((context) => context === video)).toHaveLength(
      2
    )

    act(() => {
      root.unmount()
    })
  })

  it('keeps video paused with reduced motion and responds to preference changes', () => {
    motionPreference.reduced = true
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    const host = document.createElement('div')
    document.body.appendChild(host)
    const root = createRoot(host)

    act(() => root.render(<FeaturedCustomer />))
    const video = host.querySelector('video') as HTMLVideoElement
    expect(video.play).not.toHaveBeenCalled()
    expect(
      vi.mocked(video.pause).mock.contexts.filter((context) => context === video)
    ).toHaveLength(1)

    motionPreference.reduced = false
    act(() => root.render(<FeaturedCustomer />))
    expect(video.play).toHaveBeenCalledOnce()

    motionPreference.reduced = true
    act(() => root.render(<FeaturedCustomer />))
    expect(
      vi.mocked(video.pause).mock.contexts.filter((context) => context === video)
    ).toHaveLength(2)

    act(() => root.unmount())
  })

  it('emphasizes and selects the neighboring customer story', () => {
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    const host = document.createElement('div')
    document.body.appendChild(host)
    const root = createRoot(host)

    act(() => {
      root.render(<FeaturedCustomer />)
    })

    const expRealty = host.querySelector('[aria-label="2 of 2: eXp Realty"]') as HTMLElement
    const expRealtyContent = expRealty.querySelector(
      '[data-customer-story-content="true"]'
    ) as HTMLElement
    const previewButton = host.querySelector(
      '[aria-label="Open eXp Realty customer story"]'
    ) as HTMLButtonElement

    act(() => {
      previewButton.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }))
    })

    expect(expRealty.className).toContain('opacity-100')
    expect(expRealtyContent.className).toContain('opacity-100')
    expect(expRealtyContent.className).toContain('translate-y-0')

    act(() => {
      previewButton.click()
    })

    expect(expRealty.getAttribute('aria-current')).toBe('true')
    expect(expRealty.className).toContain('translate-x-0')
    expect(host.querySelector('[aria-label="Open Rivian customer story"]')).not.toBeNull()

    act(() => {
      root.unmount()
    })
  })

  it('advances after a sustained hover and exposes the progress ring', () => {
    vi.useFakeTimers()
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    const host = document.createElement('div')
    document.body.appendChild(host)
    const root = createRoot(host)

    act(() => {
      root.render(<FeaturedCustomer />)
    })

    const nextButton = host.querySelector(
      '[aria-label="View eXp Realty customer story"]'
    ) as HTMLButtonElement
    const progressRing = nextButton.querySelector(
      '[data-customer-progress-ring="true"]'
    ) as SVGCircleElement
    const progressTrack = nextButton.querySelector(
      '[data-customer-progress-track="true"]'
    ) as SVGCircleElement

    expect(nextButton.className).toContain('border-0')
    expect(progressTrack.getAttribute('r')).toBe('19')
    expect(progressTrack.getAttribute('stroke-width')).toBe('2')
    expect(progressRing.getAttribute('r')).toBe('19')
    expect(progressRing.getAttribute('stroke-width')).toBe('2')
    expect(progressRing.className.baseVal).toContain('transition-[stroke-dashoffset]')

    act(() => {
      nextButton.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }))
      vi.advanceTimersByTime(500)
      nextButton.dispatchEvent(
        new MouseEvent('mouseout', { bubbles: true, relatedTarget: document.body })
      )
      vi.advanceTimersByTime(500)
    })

    expect(host.querySelector('[aria-label="View eXp Realty customer story"]')).not.toBeNull()
    expect(progressRing.className.baseVal).toContain('opacity-0')
    expect(progressRing.className.baseVal).toContain('[stroke-dashoffset:100]')

    act(() => {
      nextButton.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }))
    })

    expect(progressRing.className.baseVal).toContain('opacity-100')
    expect(progressRing.className.baseVal).toContain('[stroke-dashoffset:0]')

    act(() => {
      vi.advanceTimersByTime(1000)
    })

    expect(host.querySelector('[aria-label="View Rivian customer story"]')).not.toBeNull()
    expect(
      [...host.querySelectorAll('[data-testid="customer-tooltip"]')].map((node) => node.textContent)
    ).toEqual(['View Rivian customer story'])

    act(() => {
      root.unmount()
    })
  })
})
