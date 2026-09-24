/**
 * @vitest-environment jsdom
 */
import { act, createRef } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@sim/emcn', () => ({
  cn: (...classes: unknown[]) => classes.filter(Boolean).join(' '),
  Input: (
    props: React.InputHTMLAttributes<HTMLInputElement> & { ref?: React.Ref<HTMLInputElement> }
  ) => <input {...props} />,
  Textarea: (
    props: React.TextareaHTMLAttributes<HTMLTextAreaElement> & {
      ref?: React.Ref<HTMLTextAreaElement>
    }
  ) => <textarea {...props} />,
}))

import {
  MirroredInput,
  MirroredTextarea,
} from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/editor/components/sub-block/components/mirrored-field/mirrored-field'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let host: HTMLDivElement
let root: Root

beforeEach(() => {
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})

afterEach(() => {
  act(() => root.unmount())
  host.remove()
  vi.restoreAllMocks()
})

describe('mirrored workflow fields', () => {
  it.each([
    ['input', MirroredInput],
    ['textarea', MirroredTextarea],
  ] as const)('keeps the %s mirror aligned and composition text visible', (_, Component) => {
    const controlRef = createRef<HTMLInputElement & HTMLTextAreaElement>()
    const overlayRef = createRef<HTMLDivElement>()
    const onCompositionEnd = vi.fn()

    act(() => {
      root.render(
        <div className='relative'>
          <Component
            ref={controlRef}
            value='long reference value'
            readOnly
            overlay='formatted reference value'
            overlayClassName='absolute inset-0'
            overlayRef={overlayRef}
            onCompositionEnd={onCompositionEnd}
          />
        </div>
      )
    })

    const control = controlRef.current
    const overlay = overlayRef.current
    expect(control).not.toBeNull()
    expect(overlay).not.toBeNull()
    expect(overlay?.getAttribute('aria-hidden')).toBe('true')

    control!.scrollLeft = 37
    control!.scrollTop = 18
    act(() => control!.dispatchEvent(new Event('scroll', { bubbles: true })))
    expect(overlay?.scrollLeft).toBe(37)
    expect(overlay?.scrollTop).toBe(18)

    control!.setSelectionRange(2, 8)
    act(() => control!.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true })))
    expect(overlay?.classList.contains('invisible')).toBe(true)
    expect(control?.classList.contains('text-[var(--text-primary)]')).toBe(true)
    expect(control?.selectionStart).toBe(2)
    expect(control?.selectionEnd).toBe(8)

    act(() => control!.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true })))
    expect(onCompositionEnd).toHaveBeenCalledOnce()
    expect(overlay?.classList.contains('invisible')).toBe(false)
    expect(control?.classList.contains('text-[var(--text-primary)]')).toBe(false)
    expect(control?.selectionStart).toBe(2)
    expect(control?.selectionEnd).toBe(8)
  })

  it('synchronizes when a controlled value changes without a scroll event', () => {
    const controlRef = createRef<HTMLInputElement>()
    const overlayRef = createRef<HTMLDivElement>()
    const render = (value: string) => (
      <MirroredInput
        ref={controlRef}
        value={value}
        readOnly
        overlay={value}
        overlayClassName='absolute inset-0'
        overlayRef={overlayRef}
      />
    )

    act(() => root.render(render('first')))
    controlRef.current!.scrollLeft = 25
    act(() => root.render(render('second')))
    expect(overlayRef.current?.scrollLeft).toBe(25)
  })
})
