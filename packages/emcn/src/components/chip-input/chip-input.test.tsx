/**
 * @vitest-environment jsdom
 */
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it } from 'vitest'
import { ChipInput } from './chip-input'

let root: Root | null = null
let container: HTMLDivElement | null = null

function mount(): HTMLInputElement {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  act(() => root?.render(<ChipInput aria-label='Search' />))

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
})
