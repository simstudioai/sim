/**
 * @vitest-environment jsdom
 */
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ColumnDefinition, TablePredicate } from '@/lib/table'
import { TableFilter } from '@/app/workspace/[workspaceId]/tables/[tableId]/components/table-filter/table-filter'

const COLUMNS: ColumnDefinition[] = [{ id: 'col-name', name: 'Name', type: 'string' }]

let container: HTMLDivElement
let root: Root

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
})

function renderFilter(
  onChange: (filter: TablePredicate | null) => void,
  filter: TablePredicate | null = null
) {
  act(() => {
    root.render(<TableFilter columns={COLUMNS} filter={filter} onChange={onChange} />)
  })
}

function valueInput(): HTMLInputElement | null {
  return container.querySelector<HTMLInputElement>('input[placeholder="Enter a value"]')
}

function typeInto(input: HTMLInputElement | null, value: string) {
  if (!input) return
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(input, value)
  input.dispatchEvent(new Event('input', { bubbles: true }))
}

describe('TableFilter', () => {
  it('commits a typed value on blur, not per keystroke', () => {
    const onChange = vi.fn()
    renderFilter(onChange)
    const input = valueInput()
    expect(input).not.toBeNull()

    act(() => typeInto(input, 'Ada'))
    expect(onChange).not.toHaveBeenCalled()

    act(() => input?.dispatchEvent(new FocusEvent('focusout', { bubbles: true })))
    expect(onChange).toHaveBeenCalledTimes(1)
    expect(onChange).toHaveBeenCalledWith({
      all: [{ field: 'col-name', op: 'eq', value: 'Ada' }],
    })
  })

  it('commits a typed value on Enter', () => {
    const onChange = vi.fn()
    renderFilter(onChange)
    const input = valueInput()

    act(() => typeInto(input, 'Grace'))
    act(() => input?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })))

    expect(onChange).toHaveBeenCalledTimes(1)
    expect(onChange).toHaveBeenCalledWith({
      all: [{ field: 'col-name', op: 'eq', value: 'Grace' }],
    })
  })

  it('does not re-commit an unchanged value on blur after Enter', () => {
    const onChange = vi.fn()
    renderFilter(onChange)
    const input = valueInput()

    act(() => typeInto(input, 'Ada'))
    act(() => input?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })))
    act(() => input?.dispatchEvent(new FocusEvent('focusout', { bubbles: true })))

    expect(onChange).toHaveBeenCalledTimes(1)
  })

  it('offers a toggleable conjunction without apply or clear actions', () => {
    renderFilter(vi.fn())
    const addFilter = Array.from(container.querySelectorAll('button')).find((button) =>
      button.textContent?.includes('Add filter')
    )

    act(() => addFilter?.click())

    const conjunction = Array.from(container.querySelectorAll('button')).find(
      (button) => button.textContent?.trim() === 'and'
    )
    expect(conjunction).toBeDefined()

    act(() => conjunction?.click())
    expect(conjunction?.textContent?.trim()).toBe('or')

    expect(container.textContent).not.toContain('Apply filter')
    expect(container.textContent).not.toContain('Clear filters')
  })

  it('clears the active filter as soon as its last rule is removed', () => {
    const onChange = vi.fn()
    renderFilter(onChange, {
      all: [{ field: 'col-name', op: 'eq', value: 'Ada' }],
    })

    const removeButton = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Remove filter"]'
    )
    act(() => removeButton?.click())

    expect(onChange).toHaveBeenCalledWith(null)
    expect(valueInput()?.value).toBe('')
  })

  it('preserves saved isNull conditions instead of dropping them', () => {
    const onChange = vi.fn()
    renderFilter(onChange, { all: [{ field: 'col-name', op: 'isNull' }] })

    expect(onChange).not.toHaveBeenCalled()
  })

  it('loads a saved OR filter verbatim without an unsolicited autosave', () => {
    const onChange = vi.fn()
    renderFilter(onChange, {
      any: [
        { all: [{ field: 'col-name', op: 'eq', value: 'Ada' }] },
        { all: [{ field: 'col-name', op: 'eq', value: 'Grace' }] },
      ],
    })

    const orToggle = Array.from(container.querySelectorAll('button')).find(
      (button) => button.textContent?.trim() === 'or'
    )
    expect(orToggle).toBeDefined()
    expect(onChange).not.toHaveBeenCalled()
  })

  it('merges the OR groups as soon as the conjunction is toggled back to and', () => {
    const onChange = vi.fn()
    renderFilter(onChange, {
      any: [
        { all: [{ field: 'col-name', op: 'eq', value: 'Ada' }] },
        { all: [{ field: 'col-name', op: 'eq', value: 'Grace' }] },
      ],
    })

    const orToggle = Array.from(container.querySelectorAll('button')).find(
      (button) => button.textContent?.trim() === 'or'
    )
    act(() => orToggle?.click())

    expect(onChange).toHaveBeenCalledWith({
      all: [
        { field: 'col-name', op: 'eq', value: 'Ada' },
        { field: 'col-name', op: 'eq', value: 'Grace' },
      ],
    })
  })
})
