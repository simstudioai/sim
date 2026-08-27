/**
 * @vitest-environment jsdom
 */
import { act, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { Search } from '../../icons'
import { ChipInput } from './chip-input'

let root: Root | null = null
let container: HTMLDivElement | null = null

function mount(ui: ReactNode) {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  act(() => root?.render(ui))
}

describe('ChipInput', () => {
  beforeEach(() => {
    container = null
    root = null
  })

  afterEach(() => {
    if (root) act(() => root?.unmount())
    container?.remove()
  })

  it('forwards the input ref and renders canonical adornment slots', () => {
    let input: HTMLInputElement | null = null

    mount(
      <ChipInput
        ref={(node) => {
          input = node
        }}
        icon={Search}
        endAdornment={<span data-testid='adornment'>⌘K</span>}
        aria-label='Search'
      />
    )

    expect(input).toBe(container?.querySelector('input'))
    expect(input?.className).toContain('-ml-1')
    expect(input?.className).toContain('indent-1')
    expect(container?.querySelector('svg')).not.toBeNull()
    expect(container?.querySelector('[data-testid="adornment"]')?.textContent).toBe('⌘K')
  })

  it('uses component state for error and disabled chrome', () => {
    mount(<ChipInput error disabled aria-label='Invalid field' />)

    const input = container?.querySelector('input')
    const wrapper = input?.parentElement
    expect(input?.disabled).toBe(true)
    expect(wrapper?.className).toContain('border-[var(--text-error)]')
    expect(wrapper?.className).toContain('opacity-50')
  })
})
