/**
 * @vitest-environment jsdom
 *
 * The sidebar context menu is opened by right-clicking a row, including rows that live
 * inside another Radix menu — the collapsed sidebar's chat flyout. Radix menu rows focus
 * themselves on `pointermove` and a menu refocuses its own content when the pointer leaves
 * a row, so the first mouse movement after the right-click moves focus into the flyout.
 * A non-modal Radix menu dismisses on focus-outside, which closed this menu before the
 * cursor could reach it. These tests pin which dismissal paths survive: focus landing in a
 * surrounding menu keeps it open, focus landing anywhere else and a press outside close it.
 */
import { act } from 'react'
import { sleep } from '@sim/utils/helpers'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ContextMenu } from '@/app/workspace/[workspaceId]/w/components/sidebar/components/workflow-list/components/context-menu/context-menu'

let root: Root | null = null
let container: HTMLDivElement | null = null
let plainButton: HTMLButtonElement | null = null
let surroundingMenuItem: HTMLDivElement | null = null

/**
 * Stands in for the collapsed sidebar's chat flyout: a Radix menu whose rows this menu
 * is drawn on top of, and which steals focus back as soon as the pointer moves.
 */
function mountSurroundingMenu() {
  const menu = document.createElement('div')
  menu.setAttribute('role', 'menu')
  const item = document.createElement('div')
  item.setAttribute('role', 'menuitem')
  item.tabIndex = -1
  menu.appendChild(item)
  document.body.appendChild(menu)
  surroundingMenuItem = item
}

function renderMenu(onClose: () => void, onDelete: () => void = () => {}, selectedCount = 1) {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  mountSurroundingMenu()
  plainButton = document.createElement('button')
  document.body.appendChild(plainButton)
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  act(() =>
    root?.render(
      <ContextMenu
        isOpen
        position={{ x: 10, y: 10 }}
        menuRef={{ current: null }}
        onClose={onClose}
        onDelete={onDelete}
        showRename={false}
        showDuplicate={false}
        selectedCount={selectedCount}
      />
    )
  )
}

function contextMenuIsOpen() {
  return Array.from(document.querySelectorAll('[role="menuitem"]')).some(
    (item) => item.textContent === 'Delete'
  )
}

function focusOutside(element: HTMLElement | null) {
  act(() => {
    element?.focus()
    element?.dispatchEvent(new FocusEvent('focusin', { bubbles: true }))
  })
}

afterEach(() => {
  if (root) act(() => root?.unmount())
  container?.remove()
  plainButton?.remove()
  surroundingMenuItem?.closest('[role="menu"]')?.remove()
  root = null
  container = null
  plainButton = null
  surroundingMenuItem = null
})

describe('sidebar context menu dismissal', () => {
  it('stays open when a surrounding menu takes focus back', () => {
    const onClose = vi.fn()
    renderMenu(onClose)
    expect(contextMenuIsOpen()).toBe(true)

    focusOutside(surroundingMenuItem)

    expect(onClose).not.toHaveBeenCalled()
    expect(contextMenuIsOpen()).toBe(true)
  })

  it('still runs an item action after a surrounding menu took focus', () => {
    const onClose = vi.fn()
    const onDelete = vi.fn()
    renderMenu(onClose, onDelete)

    focusOutside(surroundingMenuItem)
    act(() => {
      const deleteItem = Array.from(document.querySelectorAll('[role="menuitem"]')).find(
        (item) => item.textContent === 'Delete'
      )
      ;(deleteItem as HTMLElement | undefined)?.click()
    })

    expect(onDelete).toHaveBeenCalled()
    expect(onClose).toHaveBeenCalled()
  })

  it('closes when focus leaves for an element outside any menu', () => {
    const onClose = vi.fn()
    renderMenu(onClose)

    focusOutside(plainButton)

    expect(onClose).toHaveBeenCalled()
  })

  it('closes on a pointer press outside it', async () => {
    const onClose = vi.fn()
    renderMenu(onClose)

    await act(async () => {
      await sleep(1)
    })

    await act(async () => {
      plainButton?.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }))
      plainButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      await sleep(1)
    })

    expect(onClose).toHaveBeenCalled()
  })

  it('states when delete applies to a multi-item selection', () => {
    renderMenu(vi.fn(), vi.fn(), 3)

    expect(
      Array.from(document.querySelectorAll('[role="menuitem"]')).some(
        (item) => item.textContent === 'Delete 3 items'
      )
    ).toBe(true)
  })
})

describe('separators', () => {
  function renderWith(props: Partial<React.ComponentProps<typeof ContextMenu>>) {
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    act(() =>
      root?.render(
        <ContextMenu
          isOpen
          position={{ x: 10, y: 10 }}
          menuRef={{ current: null }}
          onClose={() => {}}
          onDelete={() => {}}
          showRename={false}
          showDuplicate={false}
          {...props}
        />
      )
    )
  }

  function menuShape(): string[] {
    const content = document.querySelector('[role="menu"]')
    if (!content) return []
    return Array.from(content.children).map((el) =>
      el.getAttribute('role') === 'separator' ? 'sep' : (el.textContent ?? '')
    )
  }

  it('puts its one rule directly before the destructive action', () => {
    renderWith({ showRename: true, onRename: () => {}, showDelete: true })
    const shape = menuShape()
    expect(shape.filter((s) => s === 'sep')).toHaveLength(1)
    expect(shape[shape.indexOf('sep') + 1]).toBe('Delete')
  })

  it('renders no rule when nothing precedes the destructive action', () => {
    renderWith({ showDelete: true })
    expect(menuShape()).toEqual(['Delete'])
  })

  it('renders no rule when there is no destructive action', () => {
    renderWith({ showRename: true, onRename: () => {}, showDelete: false })
    const shape = menuShape()
    expect(shape).not.toContain('sep')
    expect(shape).toEqual(['Rename'])
  })

  it('never trails a rule when showLeave is set without an onLeave handler', () => {
    renderWith({
      showRename: true,
      onRename: () => {},
      showLeave: true,
      onLeave: undefined,
      showDelete: false,
    })
    const shape = menuShape()
    expect(shape.at(-1)).not.toBe('sep')
    expect(shape).toEqual(['Rename'])
  })

  it('draws the rule for Leave when its handler is present', () => {
    renderWith({
      showRename: true,
      onRename: () => {},
      showLeave: true,
      onLeave: () => {},
      showDelete: false,
    })
    expect(menuShape()).toEqual(['Rename', 'sep', 'Leave'])
  })

  it('never renders two rules back to back across a broad flag sweep', () => {
    const noop = () => {}
    for (const showOpenInNewTab of [true, false]) {
      for (const showPin of [true, false]) {
        for (const showLock of [true, false]) {
          for (const showExport of [true, false]) {
            for (const showDelete of [true, false]) {
              act(() => root?.unmount())
              container?.remove()
              renderWith({
                showOpenInNewTab,
                onOpenInNewTab: noop,
                showPin,
                onTogglePin: noop,
                showLock,
                onToggleLock: noop,
                showExport,
                onExport: noop,
                showDelete,
              })
              const shape = menuShape()
              expect(shape.filter((s) => s === 'sep').length).toBeLessThanOrEqual(1)
              expect(shape.at(0)).not.toBe('sep')
              expect(shape.at(-1)).not.toBe('sep')
            }
          }
        }
      }
    }
  })
})
