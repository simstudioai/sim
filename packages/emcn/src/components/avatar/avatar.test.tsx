/** @vitest-environment jsdom */
import { act, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Avatar, AvatarFallback } from './avatar'

/**
 * Stands in for the browser's image loader, which Radix drives through
 * `new window.Image()`: a `src` containing `broken` fails, anything else loads.
 */
class FakeImage extends EventTarget {
  complete = false
  naturalWidth = 0
  referrerPolicy = ''
  crossOrigin: string | null = null
  private source = ''

  get src() {
    return this.source
  }

  set src(value: string) {
    this.source = value
    queueMicrotask(() => {
      const loads = !value.includes('broken')
      this.complete = true
      this.naturalWidth = loads ? 1 : 0
      this.dispatchEvent(new Event(loads ? 'load' : 'error'))
    })
  }
}

let root: Root | null = null
let container: HTMLDivElement | null = null

async function mount(children: ReactNode) {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  await act(async () => {
    root?.render(children)
  })
  await act(async () => {})
  return container
}

beforeEach(() => {
  vi.stubGlobal('Image', FakeImage)
})

afterEach(() => {
  act(() => root?.unmount())
  container?.remove()
  root = null
  container = null
  vi.unstubAllGlobals()
})

describe('Avatar', () => {
  it('shows the photo once it loads', async () => {
    const view = await mount(<Avatar size='xs' name='Ada' src='https://example.com/ada.png' />)
    expect(view.querySelector('img')?.getAttribute('src')).toBe('https://example.com/ada.png')
    expect(view.textContent).toBe('')
  })

  it('falls back to the initial when the photo fails to load', async () => {
    const view = await mount(<Avatar size='xs' name='ada' src='https://example.com/broken.png' />)
    expect(view.querySelector('img')).toBeNull()
    expect(view.textContent).toBe('A')
  })

  it('labels a person by their name', async () => {
    const view = await mount(<Avatar size='xs' name='Ada Lovelace' />)
    expect(view.querySelector('[role="img"]')?.getAttribute('aria-label')).toBe('Ada Lovelace')
  })

  it('announces a status as part of the person, not as a second image', async () => {
    const view = await mount(<Avatar size='sm' name='Ada' status='online' />)
    const images = view.querySelectorAll('[role="img"]')
    expect(images).toHaveLength(1)
    expect(images[0]?.getAttribute('aria-label')).toBe('Ada, online')
    expect(view.querySelector('[data-slot="avatar-status"]')?.getAttribute('aria-hidden')).toBe(
      'true'
    )
  })

  it('never labels an image with an empty name', async () => {
    const view = await mount(<Avatar size='xs' name='  ' />)
    expect(view.querySelector('[role="img"]')).toBeNull()
    expect(view.textContent).toBe('?')
  })

  it('drops the label when the name is already visible beside it', async () => {
    const view = await mount(<Avatar size='xs' name='Ada' aria-hidden />)
    expect(view.querySelector('[aria-hidden="true"]')).not.toBeNull()
    expect(view.querySelector('[aria-label]')).toBeNull()
    expect(view.querySelector('[role="img"]')).toBeNull()
  })

  it('sizes the fallback glyph to the avatar, so a 14px disc needs no override', async () => {
    const xs = await mount(<Avatar size='xs' name='Ada' />)
    expect(xs.innerHTML).toContain('text-[8px]')
    act(() => root?.unmount())
    container?.remove()

    const md = await mount(
      <Avatar>
        <AvatarFallback>AL</AvatarFallback>
      </Avatar>
    )
    expect(md.innerHTML).toContain('text-xs')
    expect(md.innerHTML).not.toContain('text-[8px]')
  })
})
