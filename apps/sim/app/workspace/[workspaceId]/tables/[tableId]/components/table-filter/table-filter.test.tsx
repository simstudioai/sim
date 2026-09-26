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
  filter: TablePredicate | null = null,
  autoApply = true,
  onClose: () => void = vi.fn()
) {
  act(() => {
    root.render(
      <TableFilter
        columns={COLUMNS}
        filter={filter}
        autoApply={autoApply}
        onChange={onChange}
        onClose={onClose}
      />
    )
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
  it('preserves saved isNull conditions instead of dropping them', () => {
    const onChange = vi.fn()
    renderFilter(onChange, { all: [{ field: 'col-name', op: 'isNull' }] })

    expect(onChange).not.toHaveBeenCalled()
  })

  it('keeps a saved valueless filter until its replacement value is committed', () => {
    const onChange = vi.fn()
    renderFilter(onChange, { all: [{ field: 'col-name', op: 'isEmpty' }] })

    const operatorTrigger = Array.from(container.querySelectorAll('button')).find(
      (button) => button.textContent?.trim() === 'is empty'
    )
    act(() => {
      operatorTrigger?.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, button: 0 }))
    })
    const equalsOption = Array.from(
      document.querySelectorAll<HTMLElement>('[role="menuitem"]')
    ).find((item) => item.textContent?.trim() === 'equals')
    act(() => equalsOption?.click())

    expect(valueInput()).not.toBeNull()
    expect(onChange).not.toHaveBeenCalled()

    act(() => typeInto(valueInput(), 'Ada'))
    act(() => valueInput()?.dispatchEvent(new FocusEvent('focusout', { bubbles: true })))

    expect(onChange).toHaveBeenCalledTimes(1)
    expect(onChange).toHaveBeenCalledWith({
      all: [{ field: 'col-name', op: 'eq', value: 'Ada' }],
    })
  })

  it('preserves an OR boundary when its first rule is cleared', () => {
    const onChange = vi.fn()
    renderFilter(onChange, {
      any: [
        { all: [{ field: 'col-name', op: 'eq', value: 'Ada' }] },
        {
          all: [
            { field: 'col-name', op: 'eq', value: 'Grace' },
            { field: 'col-name', op: 'eq', value: 'Linus' },
          ],
        },
      ],
    })

    const inputs = container.querySelectorAll<HTMLInputElement>(
      'input[placeholder="Enter a value"]'
    )
    act(() => typeInto(inputs[1], ''))
    act(() => inputs[1]?.dispatchEvent(new FocusEvent('focusout', { bubbles: true })))

    expect(onChange).toHaveBeenCalledWith({
      any: [
        { all: [{ field: 'col-name', op: 'eq', value: 'Ada' }] },
        { all: [{ field: 'col-name', op: 'eq', value: 'Linus' }] },
      ],
    })
  })
})
