/**
 * @vitest-environment jsdom
 */
import { act, StrictMode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import {
  FeaturesRail,
  foldScrollLeft,
} from '@/app/(landing)/components/features/components/features-rail/features-rail'

const CARDS = ['Chat', 'Workflows', 'Tables'] as const

/** Slot pitch the layout stub uses: a card plus the rail's gap. */
const PITCH = 444
/** One set of three cards, in the stubbed layout. */
const SET = CARDS.length * PITCH

function cards() {
  return CARDS.map((title) => (
    <a key={title} href={`/${title.toLowerCase()}`}>
      {title}
    </a>
  ))
}

const scrollLefts = new WeakMap<HTMLElement, number>()
const originalOffsetLeft = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetLeft')
const originalScrollLeft = Object.getOwnPropertyDescriptor(Element.prototype, 'scrollLeft')

/**
 * jsdom has no layout, so slots report a synthetic `offsetLeft` from their
 * index, and `scrollLeft` round-trips through a map instead of a scrollport.
 */
beforeAll(() => {
  Object.defineProperty(HTMLElement.prototype, 'offsetLeft', {
    configurable: true,
    get(this: HTMLElement) {
      const parent = this.parentElement
      if (!parent || !this.hasAttribute('data-copy')) return 0
      return Array.prototype.indexOf.call(parent.children, this) * PITCH
    },
  })
  Object.defineProperty(Element.prototype, 'scrollLeft', {
    configurable: true,
    get(this: HTMLElement) {
      return scrollLefts.get(this) ?? 0
    },
    set(this: HTMLElement, value: number) {
      scrollLefts.set(this, value)
    },
  })
})

afterAll(() => {
  if (originalOffsetLeft)
    Object.defineProperty(HTMLElement.prototype, 'offsetLeft', originalOffsetLeft)
  if (originalScrollLeft) Object.defineProperty(Element.prototype, 'scrollLeft', originalScrollLeft)
})

let root: Root | null = null
let host: HTMLDivElement | null = null

beforeEach(() => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
})

afterEach(() => {
  act(() => root?.unmount())
  root = null
  host?.remove()
  host = null
})

function mount(strict = false): HTMLElement {
  const rail = <FeaturesRail label='Core Sim features'>{cards()}</FeaturesRail>
  act(() => root?.render(strict ? <StrictMode>{rail}</StrictMode> : rail))
  const el = host?.querySelector<HTMLElement>('[aria-label="Core Sim features"]')
  if (!el) throw new Error('rail did not render')
  return el
}

function scrollTo(rail: HTMLElement, left: number): number {
  rail.scrollLeft = left
  rail.dispatchEvent(new Event('scroll'))
  return rail.scrollLeft
}

describe('foldScrollLeft', () => {
  it('leaves the home range alone and folds by exactly one set width', () => {
    expect(foldScrollLeft(1000, 1000)).toBe(1000)
    expect(foldScrollLeft(500, 1000)).toBe(500)
    expect(foldScrollLeft(499, 1000)).toBe(1499)
    expect(foldScrollLeft(1500, 1000)).toBe(500)
    expect(foldScrollLeft(2600, 1000)).toBe(600)
    expect(foldScrollLeft(-200, 1000)).toBe(800)
  })

  it('does nothing without a measurable set', () => {
    expect(foldScrollLeft(42, 0)).toBe(42)
  })
})

describe('FeaturesRail', () => {
  it('server-renders the finite rail once, with the scroll chrome', () => {
    const html = renderToStaticMarkup(
      <FeaturesRail label='Core Sim features'>{cards()}</FeaturesRail>
    )

    expect(html).toContain('aria-label="Core Sim features"')
    expect(html).toContain('overflow-x-auto')
    expect(html).not.toContain('snap-')
    expect(html.match(/data-copy="home"/g)).toHaveLength(3)
    expect(html).not.toContain('data-copy="lead"')
    expect(html).not.toContain('data-copy="tail"')
  })

  it('loops after hydration with clones off the tab order and accessibility tree', () => {
    const rail = mount()

    expect(rail.querySelectorAll('[data-copy="lead"]')).toHaveLength(3)
    expect(rail.querySelectorAll('[data-copy="home"]')).toHaveLength(3)
    expect(rail.querySelectorAll('[data-copy="tail"]')).toHaveLength(3)
    expect(rail.querySelectorAll('[data-copy="lead"][aria-hidden="true"]')).toHaveLength(3)
    expect(rail.querySelectorAll('[data-copy="tail"][aria-hidden="true"]')).toHaveLength(3)
    expect(rail.querySelectorAll('[data-copy="home"][aria-hidden]')).toHaveLength(0)

    const cloneLinks = rail.querySelectorAll('[data-copy="lead"] a, [data-copy="tail"] a')
    expect(cloneLinks).toHaveLength(6)
    for (const link of cloneLinks) {
      expect(link.getAttribute('tabindex')).toBe('-1')
    }
    expect(rail.querySelectorAll('[data-copy="home"] a[tabindex]')).toHaveLength(0)
    expect(rail.children).toHaveLength(9)
  })

  it('rests on the middle copy after hydration, once, even when Strict Mode reruns the effect', () => {
    expect(mount().scrollLeft).toBe(SET)
    act(() => root?.unmount())
    root = createRoot(host as HTMLDivElement)
    expect(mount(true).scrollLeft).toBe(SET)
  })

  it('keeps interactive controls keyboard-accessible only in the home copy', () => {
    let activations = 0
    act(() =>
      root?.render(
        <FeaturesRail label='Interactive features'>
          <div>
            <button type='button' onClick={() => activations++}>
              Open folder
            </button>
            <input aria-label='Search files' />
          </div>
        </FeaturesRail>
      )
    )

    const homeControls = host?.querySelectorAll<HTMLElement>(
      '[data-copy="home"] :is(button, input)'
    )
    expect(homeControls).toHaveLength(2)
    for (const control of homeControls ?? []) expect(control.tabIndex).toBe(0)

    const cloneControls = host?.querySelectorAll<HTMLElement>(
      ':is([data-copy="lead"], [data-copy="tail"]) :is(button, input)'
    )
    expect(cloneControls).toHaveLength(4)
    for (const control of cloneControls ?? []) expect(control.tabIndex).toBe(-1)

    const cloneButton = host?.querySelector<HTMLButtonElement>('[data-copy="tail"] button')
    expect(cloneButton?.disabled).toBe(false)
    act(() => cloneButton?.click())
    expect(activations).toBe(1)
  })

  it('drags with the mouse, scrolling by the pointer delta and swallowing the click', () => {
    const rail = mount()
    const link = rail.querySelector<HTMLAnchorElement>('[data-copy="home"] a')
    if (!link) throw new Error('no home link')
    /** jsdom has no PointerEvent; a MouseEvent carrying the pointer fields is what the handlers read. */
    const pointer = (type: string, clientX: number) => {
      const event = new MouseEvent(type, { bubbles: true, button: 0, clientX })
      Object.defineProperties(event, { pointerType: { value: 'mouse' }, pointerId: { value: 1 } })
      return event
    }

    rail.scrollLeft = SET
    link.dispatchEvent(pointer('pointerdown', 300))
    link.dispatchEvent(pointer('pointermove', 303))
    expect(rail.scrollLeft).toBe(SET)
    link.dispatchEvent(pointer('pointermove', 260))
    expect(rail.scrollLeft).toBe(SET + 40)
    expect(rail.dataset.dragging).toBe('')
    link.dispatchEvent(pointer('pointerup', 260))
    expect(rail.dataset.dragging).toBeUndefined()

    const click = new MouseEvent('click', { bubbles: true, cancelable: true, detail: 1 })
    link.dispatchEvent(click)
    expect(click.defaultPrevented).toBe(true)

    let swallowed: boolean | null = null
    link.addEventListener(
      'click',
      (event) => {
        swallowed = event.defaultPrevented
        event.preventDefault()
      },
      { once: true }
    )
    link.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
    expect(swallowed).toBe(false)
  })

  it.each(['pointercancel', 'pointerup'])(
    'allows keyboard activation after a drag ends with %s',
    (endEvent) => {
      const rail = mount()
      const link = rail.querySelector<HTMLAnchorElement>('[data-copy="home"] a')
      if (!link) throw new Error('no home link')
      for (const [type, clientX] of [
        ['pointerdown', 300],
        ['pointermove', 260],
        [endEvent, 260],
      ] as const) {
        const event = new MouseEvent(type, { bubbles: true, button: 0, clientX })
        Object.defineProperties(event, { pointerType: { value: 'mouse' }, pointerId: { value: 1 } })
        link.dispatchEvent(event)
      }
      expect(rail.dataset.dragging).toBeUndefined()

      let activated = false
      link.addEventListener('click', (event) => {
        activated = true
        event.preventDefault()
      })
      link.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, detail: 0 }))
      expect(activated).toBe(true)
    }
  )

  it('folds the position back into the middle copy as the user scrolls past it', () => {
    const rail = mount()

    expect(scrollTo(rail, SET + 200)).toBe(SET + 200)
    expect(scrollTo(rail, SET * 1.5 + 100)).toBe(SET * 0.5 + 100)
    expect(scrollTo(rail, SET * 0.5 - 60)).toBe(SET * 1.5 - 60)
  })
})
