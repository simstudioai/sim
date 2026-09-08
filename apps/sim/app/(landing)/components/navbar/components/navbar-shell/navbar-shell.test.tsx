/**
 * @vitest-environment jsdom
 */
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  NavbarShell,
  useNavbarFrost,
} from '@/app/(landing)/components/navbar/components/navbar-shell/navbar-shell'

vi.mock('@sim/emcn', () => ({
  cn: (...values: Array<string | false | null | undefined>) => values.filter(Boolean).join(' '),
}))

let resizeObservers: ControlledResizeObserver[]
let intersectionObservers: ControlledIntersectionObserver[]

class ControlledResizeObserver implements ResizeObserver {
  observe = vi.fn<(target: Element) => void>()
  unobserve = vi.fn<(target: Element) => void>()
  disconnect = vi.fn()

  constructor(private readonly callback: ResizeObserverCallback) {
    resizeObservers.push(this)
  }

  resize(target: Element) {
    const entry: ResizeObserverEntry = {
      target,
      contentRect: target.getBoundingClientRect(),
      borderBoxSize: [],
      contentBoxSize: [],
      devicePixelContentBoxSize: [],
    }
    this.callback([entry], this)
  }
}

class ControlledIntersectionObserver {
  observe = vi.fn<(target: Element) => void>()
  disconnect = vi.fn()

  constructor(
    readonly callback: IntersectionObserverCallback,
    readonly options?: IntersectionObserverInit
  ) {
    intersectionObservers.push(this)
  }
}

function MenuControls() {
  const frost = useNavbarFrost()
  if (!frost) throw new Error('Menu controls require the actual navbar context')

  return (
    <>
      <button type='button' onClick={() => frost.setMenuOpen('desktop', true)}>
        Open desktop
      </button>
      <button type='button' onClick={() => frost.setMenuOpen('desktop', false)}>
        Close desktop
      </button>
      <button type='button' onClick={() => frost.setMenuOpen('mobile', true)}>
        Open mobile
      </button>
      <button type='button' onClick={() => frost.setMenuOpen('mobile', false)}>
        Close mobile
      </button>
    </>
  )
}

let host: HTMLDivElement
let root: Root
let mounted: boolean
let headerHeight: number

function header(): HTMLElement {
  const element = host.querySelector<HTMLElement>('[data-landing-header]')
  if (!element) throw new Error('Missing landing header')
  return element
}

function click(label: string) {
  const button = Array.from(host.querySelectorAll('button')).find(
    (candidate) => candidate.textContent === label
  )
  if (!button) throw new Error(`Missing menu control: ${label}`)
  act(() => button.dispatchEvent(new MouseEvent('click', { bubbles: true })))
}

function unmount() {
  act(() => root.unmount())
  mounted = false
}

beforeEach(() => {
  resizeObservers = []
  intersectionObservers = []
  headerHeight = 104
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  vi.stubGlobal('ResizeObserver', ControlledResizeObserver)
  vi.stubGlobal('IntersectionObserver', ControlledIntersectionObserver)
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function () {
    return new DOMRect(0, 0, 1440, this.tagName === 'HEADER' ? headerHeight : 0)
  })

  host = document.createElement('div')
  host.style.overflowY = 'scroll'
  host.style.paddingRight = '12px'
  host.style.scrollPaddingTop = '8px'
  host.scrollTop = 320
  Object.defineProperties(host, {
    offsetWidth: { value: 1440 },
    clientWidth: { value: 1420 },
  })
  document.body.append(host)
  root = createRoot(host)
  mounted = true
  act(() => {
    root.render(
      <NavbarShell>
        <MenuControls />
      </NavbarShell>
    )
  })
})

afterEach(() => {
  if (mounted) unmount()
  host.remove()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('NavbarShell menu positioning and scroll containment', () => {
  it('publishes the current header height before a resize and updates it when header content changes', () => {
    expect(header().style.getPropertyValue('--landing-header-height')).toBe('104px')
    expect(host.style.scrollPaddingTop).toBe('104px')
    expect(resizeObservers).toHaveLength(1)
    expect(resizeObservers[0].observe).toHaveBeenCalledWith(header())

    headerHeight = 76
    act(() => resizeObservers[0].resize(header()))

    expect(header().style.getPropertyValue('--landing-header-height')).toBe('76px')
    expect(host.style.scrollPaddingTop).toBe('76px')
    expect(host.scrollTop).toBe(320)
  })

  it('disconnects header and scroll-sentinel observations when the shell unmounts', () => {
    expect(resizeObservers).toHaveLength(1)
    expect(intersectionObservers).toHaveLength(1)
    expect(intersectionObservers[0].options?.root).toBe(host)

    unmount()

    expect(resizeObservers[0].disconnect).toHaveBeenCalledOnce()
    expect(intersectionObservers[0].disconnect).toHaveBeenCalledOnce()
    expect(host.style.scrollPaddingTop).toBe('8px')
  })

  it('locks its actual parent scroll port and restores existing styles without changing its position', () => {
    const bodyOverflow = document.body.style.overflowY
    const bodyPadding = document.body.style.paddingRight

    click('Open desktop')

    expect(host.style.overflowY).toBe('hidden')
    expect(host.style.paddingRight).toBe('20px')
    expect(host.scrollTop).toBe(320)
    expect(document.documentElement.style.overscrollBehaviorY).toBe('none')
    expect(document.body.style.overflowY).toBe(bodyOverflow)
    expect(document.body.style.paddingRight).toBe(bodyPadding)

    click('Close desktop')

    expect(host.style.overflowY).toBe('scroll')
    expect(host.style.paddingRight).toBe('12px')
    expect(host.scrollTop).toBe(320)
    expect(document.documentElement.style.overscrollBehaviorY).toBe('')
  })

  it('keeps the scroll port locked until desktop and mobile menus have both closed', () => {
    click('Open desktop')
    click('Open mobile')
    click('Close desktop')

    expect(host.style.overflowY).toBe('hidden')
    expect(host.style.paddingRight).toBe('20px')

    click('Close mobile')

    expect(host.style.overflowY).toBe('scroll')
    expect(host.style.paddingRight).toBe('12px')
  })
})
