/**
 * @vitest-environment jsdom
 */
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  TableSidebarScrollBody,
  TableSidebarShell,
} from '@/app/workspace/[workspaceId]/tables/[tableId]/components/table-sidebar-layout'

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

describe('table sidebar layout', () => {
  it('keeps the labeled dialog and its form mounted while the sidebar slides closed', () => {
    function render(open: boolean) {
      act(() => {
        root.render(
          <TableSidebarShell open={open} aria-label='Configure workflow'>
            <TableSidebarScrollBody>
              <input aria-label='Workflow name' defaultValue='Existing workflow' />
            </TableSidebarScrollBody>
          </TableSidebarShell>
        )
      })
    }

    render(true)
    const dialog = container.querySelector<HTMLElement>('[role="dialog"]')!
    const input = container.querySelector<HTMLInputElement>('input')!
    const scrollBody = input.parentElement!
    expect(dialog.getAttribute('aria-label')).toBe('Configure workflow')
    expect(dialog.classList.contains('translate-x-0')).toBe(true)
    expect(dialog.classList.contains('shadow-overlay')).toBe(true)

    input.value = 'Edited workflow'
    scrollBody.scrollTop = 64
    render(false)
    expect(container.querySelector('[role="dialog"]')).toBe(dialog)
    expect(container.querySelector('input')).toBe(input)
    expect(input.value).toBe('Edited workflow')
    expect(input.parentElement).toBe(scrollBody)
    expect(scrollBody.scrollTop).toBe(64)
    expect(dialog.classList.contains('translate-x-full')).toBe(true)
    expect(dialog.classList.contains('shadow-overlay')).toBe(false)

    render(true)
    expect(dialog.classList.contains('translate-x-0')).toBe(true)
    expect(input.value).toBe('Edited workflow')
    expect(scrollBody.scrollTop).toBe(64)
  })
})
