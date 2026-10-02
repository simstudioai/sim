/** @vitest-environment jsdom */
import { act, createRef } from 'react'
import { AddRowButton } from '@sim/emcn'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'

let root: Root | null = null
let container: HTMLDivElement | null = null

afterEach(() => {
  if (root) act(() => root?.unmount())
  container?.remove()
  root = null
  container = null
})

describe('AddRowButton', () => {
  it('forwards its ref and action, honors disabled, and preserves native form submission', () => {
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    const ref = createRef<HTMLButtonElement>()
    const onClick = vi.fn()
    const onSubmit = vi.fn((event) => event.preventDefault())
    const render = (disabled: boolean) => (
      <form onSubmit={onSubmit}>
        <AddRowButton ref={ref} onClick={onClick} disabled={disabled}>
          Add filter condition
        </AddRowButton>
      </form>
    )
    act(() => root?.render(render(false)))
    const button = ref.current!
    expect(button).toBe(container.querySelector('button'))
    expect(button.textContent).toBe('Add filter condition')
    expect(button.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true')
    act(() => button.click())
    expect(onClick).toHaveBeenCalledOnce()
    expect(onSubmit).toHaveBeenCalledOnce()

    act(() => root?.render(render(true)))
    expect(button.disabled).toBe(true)
    act(() => button.click())
    expect(onClick).toHaveBeenCalledOnce()
  })
})
