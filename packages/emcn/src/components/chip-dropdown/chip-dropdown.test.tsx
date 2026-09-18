/**
 * @vitest-environment jsdom
 */
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it } from 'vitest'
import { ChipDropdown, type ChipDropdownProps } from './chip-dropdown'

let root: Root | null = null
let container: HTMLDivElement | null = null

function mount(
  fullWidth: boolean,
  aria: Pick<ChipDropdownProps, 'aria-required' | 'aria-invalid' | 'aria-describedby'> = {}
): HTMLButtonElement {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  act(() =>
    root?.render(
      <ChipDropdown
        value='workflow'
        options={[{ value: 'workflow', label: 'Workflow' }]}
        fullWidth={fullWidth}
        aria-label='Principal type'
        {...aria}
      />
    )
  )

  const trigger = container.querySelector<HTMLButtonElement>('button')
  if (!trigger) throw new Error('ChipDropdown did not render a trigger')
  return trigger
}

afterEach(() => {
  if (root) act(() => root?.unmount())
  container?.remove()
  root = null
  container = null
})

describe('ChipDropdown', () => {
  it('fills its container when fullWidth is enabled', () => {
    expect(mount(true).className).toContain('w-full')
  })

  it('keeps its intrinsic width by default', () => {
    expect(mount(false).className).not.toContain('w-full')
  })

  it('renders its text trigger through the fade-only overflow primitive', () => {
    const label = mount(true).querySelector<HTMLElement>('[data-overflow-text]')

    expect(label?.textContent).toBe('Workflow')
    expect(label?.className).toContain('text-clip')
    expect(label?.className).not.toContain('truncate')
  })

  it.each([true, 'true'] as const)(
    'announces %s field states alongside the supplied error description',
    (state) => {
      const trigger = mount(true, {
        'aria-required': state,
        'aria-invalid': state,
        'aria-describedby': 'field-error',
      })
      const error = document.createElement('p')
      error.id = 'field-error'
      error.textContent = 'Choose an available principal.'
      container?.appendChild(error)

      const description = trigger
        .getAttribute('aria-describedby')!
        .split(/\s+/)
        .map((id) => document.getElementById(id)?.textContent)
        .join(' ')

      expect(description).toBe('Choose an available principal. Required. Invalid selection.')
      expect(trigger.getAttribute('aria-haspopup')).toBe('menu')
      expect(trigger.hasAttribute('aria-required')).toBe(false)
      expect(trigger.hasAttribute('aria-invalid')).toBe(false)
      expect(trigger.textContent).toBe('Workflow')
    }
  )

  it.each([false, 'false'] as const)(
    'keeps the original description when field states are %s',
    (state) => {
      const trigger = mount(true, {
        'aria-required': state,
        'aria-invalid': state,
        'aria-describedby': 'field-hint',
      })

      expect(trigger.getAttribute('aria-describedby')).toBe('field-hint')
      expect(container?.textContent).toBe('Workflow')
    }
  )
})
