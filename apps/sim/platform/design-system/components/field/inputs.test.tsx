/** @vitest-environment jsdom */
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Input } from '@/platform/design-system/components/field/inputs'

/**
 * Failure mode: a controlled field re-renders on every keystroke, so anything its ref starts must
 * stop on the next render, or typing gets slower the longer it goes on.
 */
describe('Input scroll measurement across renders', () => {
  let live = 0

  beforeEach(() => {
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    live = 0
    vi.stubGlobal(
      'ResizeObserver',
      class {
        constructor() {
          live += 1
        }
        observe() {}
        unobserve() {}
        disconnect() {
          live -= 1
        }
      }
    )
  })

  afterEach(() => {
    document.body.replaceChildren()
  })

  it('keeps one measurement alive through re-renders, and none after unmount', () => {
    const root = createRoot(document.body.appendChild(document.createElement('div')))
    for (const value of ['a', 'ab', 'abc', 'abcd']) {
      act(() =>
        root.render(<Input label='Name' placeholder='Name' value={value} onChange={() => {}} />)
      )
    }
    expect(live).toBe(1)
    act(() => root.unmount())
    expect(live).toBe(0)
  })

  it('hands the element to a caller ref and clears it on unmount', () => {
    const inputRef = { current: null as HTMLInputElement | null }
    const root = createRoot(document.body.appendChild(document.createElement('div')))
    act(() =>
      root.render(
        <Input label='Name' placeholder='Name' value='a' onChange={() => {}} inputRef={inputRef} />
      )
    )
    expect(inputRef.current).toBeInstanceOf(HTMLInputElement)
    act(() => root.unmount())
    expect(inputRef.current).toBeNull()
  })
})
