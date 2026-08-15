/**
 * @vitest-environment jsdom
 */
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ColumnsMenu } from '@/app/workspace/[workspaceId]/tables/[tableId]/components/columns-menu/columns-menu'

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

describe('ColumnsMenu', () => {
  it('uses the app menu typography and icon sizing shared by Sort', () => {
    const onChange = vi.fn()
    act(() => {
      root.render(
        <ColumnsMenu
          columns={[
            { id: 'col-name', name: 'Name', type: 'string' },
            { id: 'col-email', name: 'Email', type: 'string' },
          ]}
          workflowGroups={[]}
          hiddenColumns={[]}
          onChange={onChange}
        />
      )
    })
    act(() => {
      container
        .querySelector<HTMLButtonElement>('button')
        ?.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, button: 0 }))
    })

    const item = document.body.querySelector<HTMLElement>('[role="menuitem"]')
    expect(item).not.toBeNull()
    expect(item).toHaveClass('text-small')
    expect(item?.querySelector('svg')).toHaveClass('size-[14px]')

    act(() => item?.click())
    expect(onChange).toHaveBeenCalledWith(['col-name'])
    expect(document.body.querySelector('[role="menuitem"]')).not.toBeNull()
  })
})
