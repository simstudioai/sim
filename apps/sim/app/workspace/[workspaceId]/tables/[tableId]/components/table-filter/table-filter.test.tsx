/**
 * @vitest-environment jsdom
 */
import { act, createRef, type Ref } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ColumnDefinition, TablePredicate } from '@/lib/table'
import {
  FILTER_DEBOUNCE_MS,
  TableFilter,
  type TableFilterHandle,
} from '@/app/workspace/[workspaceId]/tables/[tableId]/components/table-filter/table-filter'

const COLUMNS: ColumnDefinition[] = [{ id: 'col-name', name: 'Name', type: 'string' }]

let container: HTMLDivElement
let root: Root

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  vi.useFakeTimers()
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
  vi.useRealTimers()
})

function renderFilter(
  onChange: (filter: TablePredicate | null) => void,
  filter: TablePredicate | null = null,
  ref?: Ref<TableFilterHandle>
) {
  act(() => {
    root.render(<TableFilter ref={ref} columns={COLUMNS} filter={filter} onChange={onChange} />)
  })
}

describe('TableFilter', () => {
  it('applies text filters after a short typing delay', () => {
    const onApply = vi.fn()
    renderFilter(onApply)
    const input = container.querySelector<HTMLInputElement>('input[placeholder="Enter a value"]')
    expect(input).not.toBeNull()

    act(() => {
      if (!input) return
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(input, 'Ada')
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })

    expect(onApply).not.toHaveBeenCalled()
    act(() => vi.advanceTimersByTime(FILTER_DEBOUNCE_MS - 1))
    expect(onApply).not.toHaveBeenCalled()
    act(() => vi.advanceTimersByTime(1))
    expect(onApply).toHaveBeenCalledWith({
      all: [{ field: 'col-name', op: 'eq', value: 'Ada' }],
    })
  })

  it('uses fixed AND conjunctions without apply or clear actions', () => {
    renderFilter(vi.fn())
    const addFilter = Array.from(container.querySelectorAll('button')).find((button) =>
      button.textContent?.includes('Add filter')
    )

    act(() => addFilter?.click())

    const conjunction = Array.from(container.querySelectorAll('*')).find(
      (element) => element.textContent?.trim() === 'and'
    )
    expect(conjunction).toBeDefined()
    expect(conjunction?.closest('button')).toBeNull()
    expect(container.textContent).not.toContain('Apply filter')
    expect(container.textContent).not.toContain('Clear filters')
  })

  it('flushes the pending filter when the panel closes before the delay', () => {
    const onChange = vi.fn()
    const filterRef = createRef<TableFilterHandle>()
    renderFilter(onChange, null, filterRef)
    const input = container.querySelector<HTMLInputElement>('input[placeholder="Enter a value"]')

    act(() => {
      if (!input) return
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(input, 'Ada')
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })
    act(() => {
      filterRef.current?.flush()
    })

    expect(onChange).toHaveBeenCalledTimes(1)
    expect(onChange).toHaveBeenCalledWith({
      all: [{ field: 'col-name', op: 'eq', value: 'Ada' }],
    })
    act(() => vi.advanceTimersByTime(FILTER_DEBOUNCE_MS))
    expect(onChange).toHaveBeenCalledTimes(1)
  })

  it('cancels the previous debounce when typing continues', () => {
    const onChange = vi.fn()
    renderFilter(onChange)
    const input = container.querySelector<HTMLInputElement>('input[placeholder="Enter a value"]')
    const setInput = (value: string) => {
      if (!input) return
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(input, value)
      input.dispatchEvent(new Event('input', { bubbles: true }))
    }

    act(() => setInput('Ada'))
    act(() => vi.advanceTimersByTime(FILTER_DEBOUNCE_MS - 1))
    act(() => setInput('Grace'))
    act(() => vi.advanceTimersByTime(FILTER_DEBOUNCE_MS))

    expect(onChange).toHaveBeenCalledTimes(1)
    expect(onChange).toHaveBeenCalledWith({
      all: [{ field: 'col-name', op: 'eq', value: 'Grace' }],
    })
  })

  it('clears the active filter when its last rule is removed', () => {
    const onChange = vi.fn()
    renderFilter(onChange, {
      all: [{ field: 'col-name', op: 'eq', value: 'Ada' }],
    })

    const removeButton = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Remove filter"]'
    )
    act(() => removeButton?.click())
    act(() => vi.advanceTimersByTime(FILTER_DEBOUNCE_MS))

    expect(onChange).toHaveBeenCalledWith(null)
    expect(
      container.querySelector<HTMLInputElement>('input[placeholder="Enter a value"]')?.value
    ).toBe('')
  })

  it('normalizes a previously saved OR filter to AND', () => {
    const onChange = vi.fn()
    renderFilter(onChange, {
      any: [
        { all: [{ field: 'col-name', op: 'eq', value: 'Ada' }] },
        { all: [{ field: 'col-name', op: 'eq', value: 'Grace' }] },
      ],
    })

    act(() => vi.advanceTimersByTime(FILTER_DEBOUNCE_MS))

    expect(onChange).toHaveBeenCalledWith({
      all: [
        { field: 'col-name', op: 'eq', value: 'Ada' },
        { field: 'col-name', op: 'eq', value: 'Grace' },
      ],
    })
  })
})
