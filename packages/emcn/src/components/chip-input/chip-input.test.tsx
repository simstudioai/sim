/**
 * @vitest-environment jsdom
 */
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it } from 'vitest'
import { ChipInput } from './chip-input'

let root: Root | null = null
let container: HTMLDivElement | null = null

function mount(type?: string): HTMLInputElement {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  act(() => root?.render(<ChipInput aria-label='Search' type={type} />))

  const input = container.querySelector<HTMLInputElement>('input')
  if (!input) throw new Error('ChipInput did not render an input')
  return input
}

afterEach(() => {
  if (root) act(() => root?.unmount())
  container?.remove()
  root = null
  container = null
})

describe('ChipInput', () => {
  it('reserves paintable clearance for a leading glyph without shifting its alignment', () => {
    const input = mount()

    expect(input.className).toContain('-ml-1')
    expect(input.className).toContain('indent-1')
  })

  /**
   * A chip field owns its chrome, and the browser's number stepper paints a bordered
   * double-arrow inside it that belongs to no design token. Suppressing it lives on
   * the component so no caller re-derives the three vendor rules by hand.
   */
  it('suppresses the native number spinner on a number field', () => {
    const input = mount('number')

    expect(input.className).toContain('[appearance:textfield]')
    expect(input.className).toContain('[&::-webkit-inner-spin-button]:appearance-none')
    expect(input.className).toContain('[&::-webkit-outer-spin-button]:appearance-none')
  })

  it('leaves a text field untouched, since it has no stepper to hide', () => {
    expect(mount().className).not.toContain('[appearance:textfield]')
  })
})
