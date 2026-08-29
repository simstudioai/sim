/**
 * @vitest-environment jsdom
 */

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it } from 'vitest'
import { ChipSelect } from './chip-select'

let root: Root | null = null
let container: HTMLDivElement | null = null

function mount(): HTMLButtonElement {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  act(() =>
    root?.render(
      <ChipSelect
        options={[{ value: 'workflow-1', label: 'Workflow 1' }]}
        value=''
        aria-label='Workflow'
        aria-required
        aria-invalid
        aria-describedby='workflow-error'
      />
    )
  )

  const trigger = container.querySelector<HTMLButtonElement>('button')
  if (!trigger) throw new Error('ChipSelect did not render a trigger')
  return trigger
}

afterEach(() => {
  if (root) act(() => root?.unmount())
  container?.remove()
  root = null
  container = null
})

describe('ChipSelect', () => {
  it('forwards field accessibility attributes to its trigger', () => {
    const trigger = mount()

    expect(trigger.getAttribute('aria-label')).toBe('Workflow')
    expect(trigger.getAttribute('aria-required')).toBe('true')
    expect(trigger.getAttribute('aria-invalid')).toBe('true')
    expect(trigger.getAttribute('aria-describedby')).toBe('workflow-error')
  })

  it('renders its text trigger through the fade-only overflow primitive', () => {
    const label = mount().querySelector<HTMLElement>('[data-overflow-text]')

    expect(label?.textContent).toBe('Select...')
    expect(label?.className).toContain('text-clip')
    expect(label?.className).not.toContain('truncate')
  })
})
