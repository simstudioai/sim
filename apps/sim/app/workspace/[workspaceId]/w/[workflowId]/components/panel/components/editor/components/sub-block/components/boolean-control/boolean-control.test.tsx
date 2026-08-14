/**
 * @vitest-environment jsdom
 */
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { BooleanControl } from './boolean-control'

let root: Root | null = null
let container: HTMLDivElement | null = null

function mount(props: React.ComponentProps<typeof BooleanControl>) {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  act(() => root?.render(<BooleanControl {...props} />))
}

describe('BooleanControl', () => {
  afterEach(() => {
    if (root) act(() => root?.unmount())
    root = null
    container?.remove()
    container = null
  })

  it('maps the On segment to a boolean value', () => {
    const onChange = vi.fn()
    mount({ value: false, onChange, label: 'Cache prompts' })

    const onButton = [
      ...(container?.querySelectorAll<HTMLButtonElement>('[role="radio"]') ?? []),
    ].find((button) => button.textContent === 'On')
    if (!onButton) throw new Error('On segment did not render')
    act(() => onButton.click())

    expect(onChange).toHaveBeenCalledWith(true)
    expect(container?.textContent).toContain('Cache prompts')
  })

  it('disables every segment in preview state', () => {
    mount({ value: true, onChange: vi.fn(), disabled: true, 'aria-label': 'Preview toggle' })

    const buttons = container?.querySelectorAll<HTMLButtonElement>('[role="radio"]')
    expect(buttons).toHaveLength(2)
    expect([...buttons!].every((button) => button.disabled)).toBe(true)
  })
})
