/**
 * @vitest-environment jsdom
 */
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ChipTimePicker } from './chip-time-picker'

let root: Root | null = null
let container: HTMLDivElement | null = null

function mount(onChange: (value: string) => void) {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  act(() => root?.render(<ChipTimePicker value='09:30' onChange={onChange} />))
  const input = container.querySelector('input')
  if (!input) throw new Error('Time input did not render')
  return input
}

function type(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
  setter?.call(input, value)
  input.dispatchEvent(new Event('input', { bubbles: true }))
}

describe('ChipTimePicker', () => {
  afterEach(() => {
    if (root) act(() => root?.unmount())
    root = null
    container?.remove()
    container = null
  })

  it('normalizes typed time and commits it on Enter', () => {
    const onChange = vi.fn()
    const input = mount(onChange)
    expect(input.value).toBe('9:30 AM')

    act(() => {
      input.focus()
      type(input, '2:05 pm')
      input.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'Enter' }))
    })

    expect(onChange).toHaveBeenCalledWith('14:05')
    expect(input.value).toBe('2:05 PM')
  })

  it('restores the committed value when Escape cancels an edit', () => {
    const onChange = vi.fn()
    const input = mount(onChange)

    act(() => {
      input.focus()
      type(input, 'not a time')
      input.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'Escape' }))
    })

    expect(onChange).not.toHaveBeenCalled()
    expect(input.value).toBe('9:30 AM')
  })
})
