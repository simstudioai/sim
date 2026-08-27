/**
 * @vitest-environment jsdom
 */
import { act, useState } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ColumnsMenu } from '@/app/workspace/[workspaceId]/tables/[tableId]/components/columns-menu/columns-menu'

let container: HTMLDivElement
let root: Root

function ColumnsMenuHarness({ onChange }: { onChange: (hiddenColumns: string[]) => void }) {
  const [hiddenColumns, setHiddenColumns] = useState<string[]>([])

  return (
    <ColumnsMenu
      columns={[
        { id: 'col-name', name: 'Name', type: 'string' },
        { id: 'col-email', name: 'Email', type: 'string' },
        { id: 'col-company', name: 'Company', type: 'string' },
      ]}
      workflowGroups={[]}
      hiddenColumns={hiddenColumns}
      onChange={(nextHiddenColumns) => {
        setHiddenColumns(nextHiddenColumns)
        onChange(nextHiddenColumns)
      }}
    />
  )
}

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

describe('ColumnsMenu', () => {
  it('uses the app menu styling and stays open across column changes', () => {
    const onChange = vi.fn()
    act(() => {
      root.render(<ColumnsMenuHarness onChange={onChange} />)
    })
    act(() => {
      container
        .querySelector<HTMLButtonElement>('button')
        ?.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, button: 0 }))
    })

    const items = document.body.querySelectorAll<HTMLElement>('[role="menuitem"]')
    expect(items).toHaveLength(3)
    expect(items[0]).toHaveClass('text-small')
    expect(items[0]?.querySelector('svg')).toHaveClass('size-[14px]')

    act(() => items[0]?.click())
    expect(onChange).toHaveBeenCalledWith(['col-name'])

    const remainingItems = document.body.querySelectorAll<HTMLElement>('[role="menuitem"]')
    expect(remainingItems).toHaveLength(3)
    act(() => remainingItems[1]?.click())
    expect(onChange).toHaveBeenLastCalledWith(['col-name', 'col-email'])
  })
})
