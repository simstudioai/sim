/**
 * @vitest-environment jsdom
 */
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it } from 'vitest'
import { SubBlockRowView } from './sub-block-row-view'

let host: HTMLDivElement | null = null
let root: Root | null = null

function mount(element: React.ReactElement): HTMLDivElement {
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  act(() => root?.render(element))
  return host
}

function hover(element: HTMLElement): void {
  act(() => {
    element.dispatchEvent(
      new MouseEvent('pointerover', { bubbles: true, clientX: 100, clientY: 100 })
    )
  })
}

afterEach(() => {
  act(() => root?.unmount())
  host?.remove()
  document.body.querySelectorAll('[data-native-surface-overlay]').forEach((node) => node.remove())
  host = null
  root = null
})

describe('SubBlockRowView tooltip values', () => {
  it('shows a full tooltip for an upstream-truncated inline value', () => {
    const compactValue = 'You are a research assistant. Keep every instruction...'
    const fullValue =
      'You are a research assistant. Keep every instruction, constraint, and output requirement.'
    const container = mount(
      <SubBlockRowView
        title='Messages'
        displayValue={compactValue}
        tooltipValue={fullValue}
        variant='inline-value'
      />
    )

    expect(container.textContent).toBe(compactValue)

    const trigger = container.querySelector<HTMLElement>('.truncate')
    if (!trigger) throw new Error('inline tooltip trigger not found')
    hover(trigger)

    expect(document.body.querySelector('[data-native-surface-overlay]')?.textContent).toBe(
      fullValue
    )
  })
})
