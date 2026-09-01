/**
 * @vitest-environment jsdom
 *
 * A row action the server would refuse stays visible and greyed rather than
 * disappearing, so the row can say why. That only works if three things hold at
 * once: the item is actually disabled (Radix greys it), the reason reaches
 * pointer users through the platform tooltip — which needs the wrapping span,
 * since a disabled item is `pointer-events-none` and never sees the hover — and
 * the reason reaches assistive tech through the accessible name, since Radix
 * skips disabled items in a menu's roving focus.
 */
import { act, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it } from 'vitest'
import { RowActionsMenu } from '@/app/workspace/[workspaceId]/settings/components/row-actions-menu/row-actions-menu'

const LOCK_REASON = 'Organization admins are automatically workspace admins.'

let root: Root | null = null
let container: HTMLDivElement | null = null

function mount(ui: ReactNode) {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  act(() => root?.render(ui))
}

/** Opens the `...` menu the way a pointer does — Radix opens on `pointerdown`. */
function openMenu() {
  const trigger = container?.querySelector('button')
  if (!trigger) throw new Error('Menu trigger did not render')
  act(() => {
    trigger.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, button: 0 }))
  })
}

function item(): HTMLElement {
  const node = document.querySelector('[role="menuitem"]')
  if (!node) throw new Error('No menu item rendered')
  return node as HTMLElement
}

afterEach(() => {
  if (root) act(() => root?.unmount())
  container?.remove()
  root = null
  container = null
})

describe('a disabled row action explains itself', () => {
  function mountLockedRemove() {
    mount(
      <RowActionsMenu
        label='Teammate actions'
        actions={[
          {
            label: 'Remove',
            destructive: true,
            disabled: true,
            tooltip: LOCK_REASON,
            onSelect: () => {},
          },
        ]}
      />
    )
    openMenu()
  }

  it('greys the item out instead of hiding it', () => {
    mountLockedRemove()

    const remove = item()
    expect(remove.textContent).toBe('Remove')
    expect(remove.getAttribute('data-disabled')).not.toBeNull()
    expect(remove.className).toContain('data-[disabled]:opacity-50')
  })

  it('shows the reason in the platform tooltip on hover', () => {
    mountLockedRemove()

    expect(document.querySelector('[role="tooltip"]')).toBeNull()

    /* The wrapping span, not the item — a disabled item is `pointer-events-none`. */
    const hoverTarget = item().parentElement
    if (!hoverTarget) throw new Error('Tooltip trigger wrapper did not render')
    act(() => {
      hoverTarget.dispatchEvent(
        new MouseEvent('pointerover', { bubbles: true, clientX: 120, clientY: 120 })
      )
    })

    expect(document.querySelector('[role="tooltip"]')?.textContent).toBe(LOCK_REASON)
  })

  it('folds the reason into the accessible name for assistive tech', () => {
    mountLockedRemove()

    expect(item().getAttribute('aria-label')).toBe(`Remove — ${LOCK_REASON}`)
  })

  it('leaves an enabled action unlabelled and untooltipped', () => {
    mount(
      <RowActionsMenu
        label='Teammate actions'
        actions={[{ label: 'Copy email', onSelect: () => {} }]}
      />
    )
    openMenu()

    expect(item().getAttribute('aria-label')).toBeNull()
    expect(item().getAttribute('data-disabled')).toBeNull()
  })
})
