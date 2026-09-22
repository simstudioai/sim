/** @vitest-environment jsdom */
import { act, type ReactNode, useState } from 'react'
import { CollapsibleCard } from '@sim/emcn'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'

let container: HTMLDivElement | null = null
let root: Root | null = null

function mount(children: ReactNode) {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  act(() => root?.render(children))
}

afterEach(() => {
  if (root) act(() => root?.unmount())
  container?.remove()
  root = null
  container = null
})

describe('CollapsibleCard', () => {
  it.each([false, true])(
    'toggles controlled content and links its body (animated: %s)',
    (animated) => {
      function Example() {
        const [collapsed, setCollapsed] = useState(true)
        return (
          <CollapsibleCard
            title='Condition'
            animated={animated}
            contentProps={{ id: 'condition-fields' }}
            data-filter-id='condition-1'
            collapsed={collapsed}
            onToggleCollapse={() => setCollapsed((value) => !value)}
          >
            <input aria-label='Value' defaultValue='Example' />
          </CollapsibleCard>
        )
      }
      mount(<Example />)
      const card = container!.querySelector('[data-filter-id="condition-1"]')!
      const trigger = card.querySelector<HTMLElement>('[role="button"]')!
      expect(trigger.getAttribute('aria-expanded')).toBe('false')
      expect(trigger.getAttribute('aria-controls')).toBe('condition-fields')
      expect(card.querySelector('input')).toBeNull()
      act(() => trigger.click())
      expect(trigger.getAttribute('aria-expanded')).toBe('true')
      expect(card.querySelector('#condition-fields input')?.getAttribute('aria-label')).toBe(
        'Value'
      )
      expect(card.querySelector('input')?.value).toBe('Example')
      act(() =>
        trigger.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
      )
      expect(card.querySelector('input')).toBeNull()
      act(() => trigger.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true })))
      expect(card.querySelector('input')).not.toBeNull()
    }
  )

  it('keeps enabled and disabled actions outside the collapse target', () => {
    const toggle = vi.fn()
    const add = vi.fn()
    const remove = vi.fn()
    const parentClick = vi.fn()
    mount(
      <CollapsibleCard
        title={<span>Long condition name</span>}
        badge={<span>Text</span>}
        collapsed
        onToggleCollapse={toggle}
        onClick={parentClick}
        actions={
          <>
            <button type='button' onClick={add}>
              Add
            </button>
            <button type='button' disabled onClick={remove}>
              Delete
            </button>
          </>
        }
      >
        Content
      </CollapsibleCard>
    )
    const trigger = container!.querySelector('[role="button"]')!
    const [addButton, deleteButton] = container!.querySelectorAll('button')
    expect(trigger.contains(addButton)).toBe(false)
    act(() => {
      addButton.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
      addButton.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true }))
      addButton.click()
      deleteButton.click()
    })
    expect(add).toHaveBeenCalledTimes(1)
    expect(remove).not.toHaveBeenCalled()
    expect(toggle).not.toHaveBeenCalled()
    expect(parentClick).not.toHaveBeenCalled()
  })
})
