/** @vitest-environment jsdom */
import { act, createRef, type ReactNode } from 'react'
import { UploadPreviewButton } from '@sim/emcn'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'

let root: Root | null = null
let container: HTMLDivElement | null = null

function mount(children: ReactNode) {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  act(() => root?.render(children))
}

afterEach(() => {
  if (root) act(() => root?.unmount())
  container?.remove()
  root = null
  container = null
})

describe('UploadPreviewButton', () => {
  it('forwards the label, ref and upload action without submitting an enclosing form', () => {
    const ref = createRef<HTMLButtonElement>()
    const onClick = vi.fn()
    const onSubmit = vi.fn((event) => event.preventDefault())
    mount(
      <form onSubmit={onSubmit}>
        <UploadPreviewButton ref={ref} aria-label='Upload logo' onClick={onClick} />
      </form>
    )

    const button = ref.current!
    expect(button).toBe(container?.querySelector('button'))
    expect(button.getAttribute('aria-label')).toBe('Upload logo')
    expect(button.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true')
    act(() => button.click())
    expect(onClick).toHaveBeenCalledTimes(1)
    expect(onSubmit).not.toHaveBeenCalled()
  })

  it('replaces the preview while busy and preserves a separate disabled restriction', () => {
    const ref = createRef<HTMLButtonElement>()
    const onClick = vi.fn()
    const render = (loading: boolean, disabled = false) => (
      <UploadPreviewButton
        ref={ref}
        aria-label='Change logo'
        loading={loading}
        disabled={disabled}
        onClick={onClick}
      >
        <img src='/logo.svg' alt='Logo' />
      </UploadPreviewButton>
    )
    mount(render(false))
    const button = ref.current!
    expect(button.querySelector('img')?.alt).toBe('Logo')

    act(() => root?.render(render(true)))
    expect(button.disabled).toBe(true)
    expect(button.getAttribute('aria-busy')).toBe('true')
    expect(button.querySelector('img')).toBeNull()
    act(() => button.click())
    expect(onClick).not.toHaveBeenCalled()

    act(() => root?.render(render(false, true)))
    expect(button.disabled).toBe(true)
    expect(button.hasAttribute('aria-busy')).toBe(false)
    expect(button.querySelector('img')?.alt).toBe('Logo')
    act(() => button.click())
    expect(onClick).not.toHaveBeenCalled()

    act(() => root?.render(render(false)))
    expect(button.disabled).toBe(false)
    act(() => button.click())
    expect(onClick).toHaveBeenCalledTimes(1)
  })
})
