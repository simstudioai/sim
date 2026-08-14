/**
 * @vitest-environment jsdom
 */
import { act, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CollapsibleCard, FieldCard } from './collapsible-card'

let root: Root | null = null
let container: HTMLDivElement | null = null

function mount(ui: ReactNode) {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  act(() => root?.render(ui))
}

describe('CollapsibleCard', () => {
  beforeEach(() => {
    container = null
    root = null
  })

  afterEach(() => {
    if (root) act(() => root?.unmount())
    container?.remove()
  })

  it('keeps header actions separate from the collapse toggle', () => {
    const onToggleCollapse = vi.fn()
    const onAction = vi.fn()

    mount(
      <CollapsibleCard
        title='Variable'
        collapsed={false}
        onToggleCollapse={onToggleCollapse}
        actions={
          <button type='button' onClick={onAction}>
            Add
          </button>
        }
      >
        <div>Value</div>
      </CollapsibleCard>
    )

    const buttons = container?.querySelectorAll('button')
    act(() => buttons?.[1]?.click())
    expect(onAction).toHaveBeenCalledOnce()
    expect(onToggleCollapse).not.toHaveBeenCalled()

    act(() => buttons?.[0]?.click())
    expect(onToggleCollapse).toHaveBeenCalledOnce()
  })

  it('shares chip field chrome with static edge-to-edge cards', () => {
    mount(
      <FieldCard title='if' flush>
        <div>Condition editor</div>
      </FieldCard>
    )

    const card = container?.firstElementChild
    const header = card?.firstElementChild
    const body = card?.lastElementChild
    expect(card?.className).toContain('rounded-lg')
    expect(header?.className).toContain('border-b')
    expect(body?.className).not.toContain('px-2.5')
  })

  it('does not render an empty body for static header-only cards', () => {
    mount(
      <FieldCard title='else'>
        {false}
        {null}
      </FieldCard>
    )

    const card = container?.firstElementChild
    const header = card?.firstElementChild
    expect(card?.childElementCount).toBe(1)
    expect(header?.className).not.toContain('border-b')
  })
})
