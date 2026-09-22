/** @vitest-environment jsdom */
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it } from 'vitest'
import { Avatar, AvatarFallback } from './avatar'

let root: Root | undefined
let container: HTMLDivElement | undefined

afterEach(() => {
  act(() => root?.unmount())
  container?.remove()
})

describe('Avatar fallback sizing', () => {
  it('scopes xs sizing to its avatar while preserving explicit overrides', () => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    act(() =>
      root?.render(
        <>
          <Avatar size='xs'>
            <AvatarFallback data-testid='xs'>A</AvatarFallback>
          </Avatar>
          <Avatar>
            <AvatarFallback data-testid='default'>BC</AvatarFallback>
          </Avatar>
          <Avatar size='xs'>
            <AvatarFallback data-testid='override' className='text-[7px]'>
              D
            </AvatarFallback>
          </Avatar>
        </>
      )
    )
    const xs = container.querySelector('[data-testid="xs"]')!
    const regular = container.querySelector('[data-testid="default"]')!
    const overridden = container.querySelector('[data-testid="override"]')!
    expect(xs.classList.contains('text-[8px]')).toBe(true)
    expect(xs.classList.contains('text-xs')).toBe(false)
    expect(regular.classList.contains('text-xs')).toBe(true)
    expect(regular.classList.contains('text-[8px]')).toBe(false)
    expect(overridden.classList.contains('text-[7px]')).toBe(true)
    expect(overridden.classList.contains('text-[8px]')).toBe(false)
    expect(overridden.classList.contains('text-xs')).toBe(false)
  })
})
