/**
 * @vitest-environment jsdom
 */
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CertBlocs } from '@/app/(landing)/components/security/components/cert-blocs'

function renderCerts() {
  return <CertBlocs href='https://trust.sim.ai/' />
}

describe('CertBlocs', () => {
  it('matches the Features stage aspect on white card chrome with dash-normalized strokes', () => {
    const html = renderToStaticMarkup(renderCerts())

    expect(html).toContain('aspect-[5/6]')
    expect(html).toContain('rounded-[10px]')
    expect(html).toContain('w-[56%]')
    expect(html).toContain('bg-[var(--surface-2)]')
    expect(html).toContain('border-[var(--border)]')
    expect(html).not.toContain('rounded-[12px]')
    expect(html).toContain('href="https://trust.sim.ai/"')
    expect(html).toContain('pathLength="1"')
    expect(html).not.toContain('<text')
  })

  it('keeps the small privacy stars part of the normalized stroke drawing', () => {
    const html = renderToStaticMarkup(renderCerts())

    const document = new DOMParser().parseFromString(html, 'text/html')
    const stars = document.querySelectorAll('[data-cert-stars] path')
    expect(stars).toHaveLength(12)
    expect([...stars].every((star) => star.getAttribute('pathLength') === '1')).toBe(true)
    expect(html).toContain('in the Sim Trust Center')
  })
})

describe('CertBlocs draw trigger', () => {
  let observe: ReturnType<typeof vi.fn>
  let disconnect: ReturnType<typeof vi.fn>
  let observerCallback: IntersectionObserverCallback | undefined
  let observerRoot: Element | Document | null | undefined
  let root: Root | null
  let host: HTMLDivElement | null
  let port: HTMLDivElement | null

  beforeEach(() => {
    observe = vi.fn()
    disconnect = vi.fn()
    observerCallback = undefined
    observerRoot = undefined
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

    vi.stubGlobal(
      'IntersectionObserver',
      class {
        constructor(callback: IntersectionObserverCallback, options?: IntersectionObserverInit) {
          observerCallback = callback
          observerRoot = options?.root
        }
        observe = observe
        disconnect = disconnect
        unobserve = vi.fn()
        takeRecords = () => []
        root = null
        rootMargin = ''
        thresholds = []
      }
    )

    port = document.createElement('div')
    port.className = 'h-screen overflow-y-auto'
    document.body.append(port)
    host = document.createElement('div')
    port.append(host)
    root = createRoot(host)
    vi.stubGlobal('matchMedia', () => ({
      matches: false,
      addEventListener: () => {},
      removeEventListener: () => {},
    }))
  })

  afterEach(() => {
    act(() => root?.unmount())
    root = null
    host?.remove()
    host = null
    port?.remove()
    port = null
    vi.unstubAllGlobals()
  })

  it('draws once when the row enters the inner landing scroll port', () => {
    vi.stubGlobal('matchMedia', () => ({
      matches: false,
      addEventListener: () => {},
      removeEventListener: () => {},
    }))

    act(() => {
      root?.render(renderCerts())
    })

    expect(observerRoot).toBe(port)
    expect(observe).toHaveBeenCalledTimes(1)

    act(() => {
      observerCallback?.(
        [{ isIntersecting: true } as IntersectionObserverEntry],
        {} as IntersectionObserver
      )
    })

    expect(disconnect).toHaveBeenCalled()
    expect(host?.querySelector('ul')?.className).toMatch(/drawn/)
  })

  it('shows marks fully drawn when the user prefers reduced motion', () => {
    vi.stubGlobal('matchMedia', () => ({
      matches: true,
      addEventListener: () => {},
      removeEventListener: () => {},
    }))

    act(() => {
      root?.render(renderCerts())
    })

    expect(observe).not.toHaveBeenCalled()
    expect(host?.querySelector('ul')?.className).toMatch(/drawn/)
  })

  it('replays the hovered GDPR mark and stars on every entry and cancels unfinished strokes', () => {
    act(() => root?.render(renderCerts()))
    const card = Array.from(host?.querySelectorAll('a') ?? []).find((link) =>
      link.textContent?.startsWith('GDPR')
    )
    expect(card).toBeTruthy()
    /** JSDOM does not inherit the CSS module's custom properties. */
    card?.style.setProperty('--draw-duration-ms', '900')
    card?.style.setProperty('--detail-delay-ms', '120')
    const cancel = vi.fn()
    const strokes = Array.from(host?.querySelectorAll('[pathLength]') ?? []).map((stroke) => {
      const animate = vi.fn()
      Object.assign(stroke, { animate, getAnimations: () => [{ cancel }] })
      return { stroke, animate }
    })

    for (let entry = 1; entry <= 2; entry += 1) {
      act(() => {
        card?.dispatchEvent(new MouseEvent('pointerover', { bubbles: true }))
      })

      for (const { stroke, animate } of strokes) {
        expect(animate).toHaveBeenCalledTimes(card?.contains(stroke) ? entry : 0)
        if (card?.contains(stroke)) {
          expect(animate).toHaveBeenLastCalledWith(
            expect.any(Array),
            expect.objectContaining({ duration: 900 })
          )
        }
      }

      act(() => {
        card?.dispatchEvent(new MouseEvent('pointerout', { bubbles: true }))
      })
    }

    expect(cancel).toHaveBeenCalledTimes((card?.querySelectorAll('[pathLength]').length ?? 0) * 2)
  })

  it('does not replay for touch entry or reduced motion', () => {
    act(() => root?.render(renderCerts()))
    const card = host?.querySelector('a')
    const animate = vi.fn()
    for (const stroke of host?.querySelectorAll('[pathLength]') ?? []) {
      Object.assign(stroke, { animate, getAnimations: () => [] })
    }

    const touch = new MouseEvent('pointerover', { bubbles: true })
    Object.defineProperty(touch, 'pointerType', { value: 'touch' })
    act(() => card?.dispatchEvent(touch))
    expect(animate).not.toHaveBeenCalled()

    vi.stubGlobal('matchMedia', () => ({
      matches: true,
      addEventListener: () => {},
      removeEventListener: () => {},
    }))
    act(() => card?.dispatchEvent(new MouseEvent('pointerover', { bubbles: true })))
    expect(animate).not.toHaveBeenCalled()
  })
})
