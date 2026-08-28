/**
 * @vitest-environment jsdom
 *
 * Menu rows are a fixed height, so a label that wraps overflows its row and paints over its
 * neighbours. Rows are held to one line and their bare text is wrapped in the shared overflow
 * treatment so an over-long label fades instead of being cut mid-word. These tests cover that wrapping:
 * that it happens, that adjacent text stays in ONE box (two boxes would be two flex items, and
 * the row's `gap` would open between the words), and that it steps aside for `asChild`, where
 * Radix's `Slot` requires exactly one element child.
 */
import { act, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it } from 'vitest'
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from './dropdown-menu'

let root: Root | null = null
let container: HTMLDivElement | null = null

function openMenu(children: ReactNode) {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  act(() =>
    root?.render(
      <DropdownMenu open modal={false}>
        <DropdownMenuTrigger />
        <DropdownMenuContent>{children}</DropdownMenuContent>
      </DropdownMenu>
    )
  )
}

function row(selector = '[role="menuitem"]'): HTMLElement {
  const node = document.querySelector(selector)
  if (!node) throw new Error(`No ${selector} rendered`)
  return node as HTMLElement
}

afterEach(() => {
  if (root) act(() => root?.unmount())
  container?.remove()
  root = null
  container = null
})

describe('menu row labels', () => {
  it('wraps a bare text label in the shared overflow treatment', () => {
    openMenu(<DropdownMenuItem>Run empty or failed cells on 2 rows</DropdownMenuItem>)

    const labels = row().querySelectorAll('span')
    expect(labels).toHaveLength(1)
    expect(labels[0].textContent).toBe('Run empty or failed cells on 2 rows')
    expect(labels[0].className).toContain('overflow-hidden')
    expect(labels[0].className).toContain('text-clip')
    expect(labels[0].className).not.toContain('truncate')
  })

  it('keeps the row on one line', () => {
    openMenu(<DropdownMenuItem>Delete 2 rows</DropdownMenuItem>)

    expect(row().className).toContain('whitespace-nowrap')
  })

  it('coalesces adjacent text into a single box', () => {
    const count = 2
    openMenu(
      <DropdownMenuItem>
        <svg aria-hidden />
        Delete {count} rows
      </DropdownMenuItem>
    )

    const labels = row().querySelectorAll('span')
    expect(labels).toHaveLength(1)
    expect(labels[0].textContent).toBe('Delete 2 rows')
  })

  it('wraps a checkbox row label, leaving the check indicator its own box', () => {
    openMenu(<DropdownMenuCheckboxItem checked>Show archived workflows</DropdownMenuCheckboxItem>)

    const labels = row('[role="menuitemcheckbox"]').querySelectorAll('span')
    const label = Array.from(labels).find((node) => node.className.includes('text-clip'))
    expect(label?.textContent).toBe('Show archived workflows')
  })

  it('leaves an asChild row alone so Slot still sees one element child', () => {
    openMenu(
      <DropdownMenuItem asChild>
        <a href='/workflows'>Open workflow</a>
      </DropdownMenuItem>
    )

    const link = row('a')
    expect(link.textContent).toBe('Open workflow')
    expect(link.querySelector('span')).toBeNull()
  })

  it('leaves a label the consumer already wrapped as a single box', () => {
    openMenu(
      <DropdownMenuItem>
        <span>Add 2 rows to Chat</span>
      </DropdownMenuItem>
    )

    expect(row().querySelectorAll('span')).toHaveLength(1)
    expect(row().className).toContain('[&>span:not([data-overflow-text])]:truncate')
  })
})
