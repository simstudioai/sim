/**
 * @vitest-environment jsdom
 */
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  type ResourceRowSelection,
  type UseResourceRowSelectionOptions,
  useResourceRowSelection,
} from '@/app/workspace/[workspaceId]/components/resource/use-resource-row-selection'

/** Trees rendered by a test, torn down in afterEach so listeners do not leak across tests. */
const mountedRoots: Root[] = []

interface Harness {
  getResult: () => ResourceRowSelection
  /** Re-renders with new options, as a parent would when its rows change. */
  rerender: (options: UseResourceRowSelectionOptions) => void
}

function renderSelection(initialOptions: UseResourceRowSelectionOptions): Harness {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root: Root = createRoot(container)
  mountedRoots.push(root)
  let result: ResourceRowSelection | undefined

  function Probe({ options }: { options: UseResourceRowSelectionOptions }) {
    result = useResourceRowSelection(options)
    return null
  }

  const render = (options: UseResourceRowSelectionOptions) => {
    act(() => {
      root.render(<Probe options={options} />)
    })
  }

  render(initialOptions)

  return {
    getResult: () => {
      if (!result) throw new Error('Hook result is not ready')
      return result
    },
    rerender: render,
  }
}

function pressKey(key: string, init: KeyboardEventInit = {}) {
  act(() => {
    window.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, ...init }))
  })
}

afterEach(() => {
  act(() => {
    for (const root of mountedRoots.splice(0)) root.unmount()
  })
  document.body.innerHTML = ''
})

const ROWS = ['a', 'b', 'c', 'd']

describe('useResourceRowSelection', () => {
  it('adds and removes a single row', () => {
    const { getResult } = renderSelection({ visibleRowIds: ROWS })

    act(() => getResult().selectable.onSelectRow('b', true))
    expect([...getResult().selectedRowIds]).toEqual(['b'])

    act(() => getResult().selectable.onSelectRow('b', false))
    expect(getResult().selectedRowIds.size).toBe(0)
  })

  it('extends a shift-click range from the last anchor', () => {
    const { getResult } = renderSelection({ visibleRowIds: ROWS })

    act(() => getResult().selectable.onSelectRow('a', true))
    act(() => getResult().selectable.onSelectRow('c', true, true))

    expect([...getResult().selectedRowIds].sort()).toEqual(['a', 'b', 'c'])
  })

  it('treats a shift-click with no anchor as a plain click', () => {
    const { getResult } = renderSelection({ visibleRowIds: ROWS })

    act(() => getResult().selectable.onSelectRow('c', true, true))

    expect([...getResult().selectedRowIds]).toEqual(['c'])
  })

  it('reports isAllSelected only once every visible row is selected', () => {
    const { getResult } = renderSelection({ visibleRowIds: ROWS })

    act(() => getResult().selectable.onSelectAll(true))
    expect([...getResult().selectedRowIds].sort()).toEqual(['a', 'b', 'c', 'd'])
    expect(getResult().selectable.isAllSelected).toBe(true)

    act(() => getResult().selectable.onSelectRow('b', false))
    expect(getResult().selectable.isAllSelected).toBe(false)
  })

  it('drops rows that are no longer visible', () => {
    const { getResult, rerender } = renderSelection({ visibleRowIds: ROWS })

    act(() => getResult().selectable.onSelectAll(true))
    rerender({ visibleRowIds: ['a', 'c'] })

    expect([...getResult().selectedRowIds].sort()).toEqual(['a', 'c'])
  })

  it('replaceSelection collapses onto the given rows and re-anchors a single row', () => {
    const { getResult } = renderSelection({ visibleRowIds: ROWS })

    act(() => getResult().selectable.onSelectAll(true))
    act(() => getResult().replaceSelection(['b']))
    expect([...getResult().selectedRowIds]).toEqual(['b'])

    // 'b' became the anchor, so a shift-click on 'd' fills the range from there.
    act(() => getResult().selectable.onSelectRow('d', true, true))
    expect([...getResult().selectedRowIds].sort()).toEqual(['b', 'c', 'd'])
  })

  it('selects every visible row on Cmd+A and clears on Escape', () => {
    const { getResult } = renderSelection({ visibleRowIds: ROWS })

    pressKey('a', { metaKey: true })
    expect(getResult().selectedRowIds.size).toBe(ROWS.length)

    pressKey('Escape')
    expect(getResult().selectedRowIds.size).toBe(0)
  })

  it('calls onDeleteSelected for Delete only while rows are selected', () => {
    const onDeleteSelected = vi.fn()
    const { getResult } = renderSelection({ visibleRowIds: ROWS, onDeleteSelected })

    pressKey('Delete')
    expect(onDeleteSelected).not.toHaveBeenCalled()

    act(() => getResult().selectable.onSelectRow('a', true))
    pressKey('Delete')
    expect(onDeleteSelected).toHaveBeenCalledTimes(1)
  })

  it('ignores shortcuts while blocked or while a text field has focus', () => {
    const onDeleteSelected = vi.fn()
    const blocked = { current: true }
    const { getResult } = renderSelection({
      visibleRowIds: ROWS,
      isKeyboardBlocked: () => blocked.current,
      onDeleteSelected,
    })

    pressKey('a', { metaKey: true })
    expect(getResult().selectedRowIds.size).toBe(0)

    blocked.current = false
    const input = document.createElement('input')
    document.body.appendChild(input)
    input.focus()

    pressKey('a', { metaKey: true })
    expect(getResult().selectedRowIds.size).toBe(0)

    input.blur()
    pressKey('a', { metaKey: true })
    expect(getResult().selectedRowIds.size).toBe(ROWS.length)
  })
})
