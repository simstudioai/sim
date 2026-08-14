/**
 * @vitest-environment jsdom
 */
import { act, createRef } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it } from 'vitest'
import { ReferenceTextarea, ReferenceTextInput } from './reference-text-control'

let root: Root | null = null
let container: HTMLDivElement | null = null

function mount(control: React.ReactNode) {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  act(() => root?.render(control))
}

describe('reference text controls', () => {
  afterEach(() => {
    if (root) act(() => root?.unmount())
    root = null
    container?.remove()
    container = null
  })

  it('synchronizes horizontal scrolling with a single-line reference overlay', () => {
    const overlayRef = createRef<HTMLDivElement>()
    mount(
      <ReferenceTextInput
        value='<Previous.output>'
        overlayContent={<span>Previous.output</span>}
        overlayRef={overlayRef}
        readOnly
      />
    )

    const input = container?.querySelector('input')
    if (!input || !overlayRef.current) throw new Error('Reference input did not render')
    input.scrollLeft = 48
    act(() => input.dispatchEvent(new Event('scroll', { bubbles: true })))

    expect(overlayRef.current.scrollLeft).toBe(48)
    expect(overlayRef.current.getAttribute('aria-hidden')).not.toBeNull()
  })

  it('synchronizes both axes with a multi-line reference overlay', () => {
    const overlayRef = createRef<HTMLDivElement>()
    mount(
      <ReferenceTextarea
        value='<Previous.output>'
        overlayContent={<span>Previous.output</span>}
        overlayRef={overlayRef}
        readOnly
      />
    )

    const textarea = container?.querySelector('textarea')
    if (!textarea || !overlayRef.current) throw new Error('Reference textarea did not render')
    textarea.scrollLeft = 24
    textarea.scrollTop = 36
    act(() => textarea.dispatchEvent(new Event('scroll', { bubbles: true })))

    expect(overlayRef.current.scrollLeft).toBe(24)
    expect(overlayRef.current.scrollTop).toBe(36)
  })
})
