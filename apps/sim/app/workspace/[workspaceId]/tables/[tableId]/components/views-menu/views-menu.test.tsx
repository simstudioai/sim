/**
 * @vitest-environment jsdom
 */
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { TableViewWire } from '@/lib/api/contracts/tables'
import { ViewsMenu } from '@/app/workspace/[workspaceId]/tables/[tableId]/components/views-menu/views-menu'

const DEFAULT_VIEW: TableViewWire = {
  id: 'view-default',
  tableId: 'table-1',
  name: 'Default',
  config: {},
  isDefault: true,
  createdBy: 'user-1',
  createdAt: new Date('2026-08-15T01:00:00.000Z'),
  updatedAt: new Date('2026-08-15T01:00:00.000Z'),
}

const SECOND_VIEW: TableViewWire = {
  ...DEFAULT_VIEW,
  id: 'view-second',
  name: 'Second view',
  isDefault: false,
}

const PRIMARY_VIEW: TableViewWire = {
  ...DEFAULT_VIEW,
  name: 'Primary view',
}

afterEach(() => {
  vi.useRealTimers()
})

function renderMenu(views: TableViewWire[], activeViewId: string | null): string {
  return renderToStaticMarkup(
    <ViewsMenu
      views={views}
      activeViewId={activeViewId}
      onSelect={vi.fn()}
      onRename={vi.fn()}
      onSetDefault={vi.fn()}
      onDelete={vi.fn()}
      onNewView={vi.fn()}
      canEdit
    />
  )
}

describe('ViewsMenu', () => {
  it('shows the persisted default while its URL selection is being adopted', () => {
    const markup = renderMenu([DEFAULT_VIEW], null)

    expect(markup).toContain('Default')
    expect(markup).not.toContain('>View<')
  })

  it('shows All only for a legacy table without a persisted default', () => {
    const markup = renderMenu([], null)

    expect(markup).toContain('All')
    expect(markup).not.toContain('>View<')
  })

  it('shows filled and outline pins without a Default badge and keeps the menu open', () => {
    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)
    const onSetDefault = vi.fn()
    const onDelete = vi.fn()

    act(() => {
      root.render(
        <ViewsMenu
          views={[PRIMARY_VIEW, SECOND_VIEW]}
          activeViewId={PRIMARY_VIEW.id}
          onSelect={vi.fn()}
          onRename={vi.fn()}
          onSetDefault={onSetDefault}
          onDelete={onDelete}
          onNewView={vi.fn()}
          canEdit
        />
      )
    })
    act(() => container.querySelector<HTMLButtonElement>('button[aria-label="Views"]')?.click())

    // The default view's Delete stays hoverable (aria-disabled, no native
    // title) so its tooltip can explain why it is inert.
    const deleteButtons = [
      ...document.body.querySelectorAll<HTMLButtonElement>('button[aria-label="Delete"]'),
    ]
    expect(deleteButtons).toHaveLength(2)
    const defaultDelete = deleteButtons.find(
      (button) => button.getAttribute('aria-disabled') === 'true'
    )
    expect(defaultDelete).not.toBeUndefined()
    expect(defaultDelete?.title).toBe('')
    act(() => defaultDelete?.click())
    expect(onDelete).not.toHaveBeenCalled()

    const defaultPin = document.body.querySelector<HTMLButtonElement>(
      'button[aria-label="Current default view"]'
    )
    const setDefaultPin = document.body.querySelector<HTMLButtonElement>(
      'button[aria-label="Set as default"]'
    )

    expect(defaultPin?.querySelector('svg')).toHaveClass('fill-current')
    expect(setDefaultPin?.querySelector('svg')).not.toHaveClass('fill-current')
    expect(document.body).not.toHaveTextContent('Default')

    act(() => setDefaultPin?.click())
    expect(onSetDefault).toHaveBeenCalledWith(SECOND_VIEW.id)
    expect(document.body).toHaveTextContent('New view')

    expect(defaultPin).toBeDisabled()
    act(() => defaultPin?.click())
    expect(onSetDefault).toHaveBeenCalledTimes(1)

    act(() => root.unmount())
    container.remove()
  })

  it('keeps the menu open when keyboard focus moves from the trigger to the default pin', () => {
    vi.useFakeTimers()
    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)

    act(() => {
      root.render(
        <ViewsMenu
          views={[PRIMARY_VIEW, SECOND_VIEW]}
          activeViewId={PRIMARY_VIEW.id}
          onSelect={vi.fn()}
          onRename={vi.fn()}
          onSetDefault={vi.fn()}
          onDelete={vi.fn()}
          onNewView={vi.fn()}
          canEdit
        />
      )
    })

    const trigger = container.querySelector<HTMLButtonElement>('button[aria-label="Views"]')
    act(() => trigger?.focus())

    const setDefaultPin = document.body.querySelector<HTMLButtonElement>(
      'button[aria-label="Set as default"]'
    )
    expect(setDefaultPin).not.toBeNull()
    act(() => {
      setDefaultPin?.focus()
      vi.advanceTimersByTime(121)
    })

    expect(document.activeElement).toBe(setDefaultPin)
    expect(document.body).toHaveTextContent('New view')
    expect(document.body.querySelector('[data-native-surface-overlay]')).not.toBeNull()

    act(() => root.unmount())
    container.remove()
  })

  it('shows disabled pins without closing the menu for read-only members', () => {
    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)
    const onSetDefault = vi.fn()

    act(() => {
      root.render(
        <ViewsMenu
          views={[PRIMARY_VIEW, SECOND_VIEW]}
          activeViewId={PRIMARY_VIEW.id}
          onSelect={vi.fn()}
          onRename={vi.fn()}
          onSetDefault={onSetDefault}
          onDelete={vi.fn()}
          onNewView={vi.fn()}
          canEdit={false}
        />
      )
    })
    act(() => container.querySelector<HTMLButtonElement>('button[aria-label="Views"]')?.click())

    const defaultPin = document.body.querySelector<HTMLButtonElement>(
      'button[aria-label="Current default view"]'
    )
    const setDefaultPin = document.body.querySelector<HTMLButtonElement>(
      'button[aria-label="Set as default"]'
    )

    expect(defaultPin?.querySelector('svg')).toHaveClass('fill-current')
    expect(setDefaultPin?.querySelector('svg')).not.toHaveClass('fill-current')
    expect(setDefaultPin).toBeDisabled()

    act(() => setDefaultPin?.click())

    expect(onSetDefault).not.toHaveBeenCalled()
    expect(document.body.querySelector('[data-native-surface-overlay]')).not.toBeNull()

    // jsdom does not simulate pointer-events hit-testing, so assert the override
    // directly: without it a disabled pin is pointer-events-none and a real click
    // falls through the overlay to the row, selecting the view and closing the menu.
    expect(defaultPin).toHaveClass('disabled:pointer-events-auto')
    expect(setDefaultPin).toHaveClass('disabled:pointer-events-auto')

    act(() => root.unmount())
    container.remove()
  })
})
