/**
 * @vitest-environment jsdom
 */
import { act, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it } from 'vitest'
import { ChipSelect } from './chip-select'

let root: Root | null = null
let container: HTMLDivElement | null = null

function mount(ui: ReactNode) {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  act(() => root?.render(ui))
}

function getTrigger() {
  const trigger = container?.querySelector('button')
  if (!trigger) throw new Error('Select trigger did not render')
  return trigger
}

describe('ChipSelect', () => {
  afterEach(() => {
    if (root) act(() => root?.unmount())
    root = null
    container?.remove()
    container = null
    document.body.replaceChildren()
  })

  it('resolves a selected hidden option without exposing it as a visible choice', () => {
    mount(
      <ChipSelect
        value='legacy'
        options={[
          { value: 'current', label: 'Current option' },
          { value: 'legacy', label: 'Legacy option', hidden: true },
        ]}
      />
    )

    expect(getTrigger().textContent).toContain('Legacy option')
    expect(document.body.textContent).not.toContain('Current option')
  })

  it('summarizes multiple selected values in the trigger', () => {
    mount(
      <ChipSelect
        multiSelect
        multiSelectValues={['one', 'two']}
        options={[
          { value: 'one', label: 'One' },
          { value: 'two', label: 'Two' },
        ]}
      />
    )

    expect(getTrigger().textContent).toContain('2 selected')
  })

  it('renders async loading state inside the open menu', () => {
    mount(<ChipSelect options={[]} isLoading aria-label='Load resources' />)

    act(() => {
      getTrigger().dispatchEvent(
        new MouseEvent('pointerdown', { bubbles: true, button: 0, ctrlKey: false })
      )
    })

    expect(document.body.textContent).toContain('Loading options...')
  })
})
