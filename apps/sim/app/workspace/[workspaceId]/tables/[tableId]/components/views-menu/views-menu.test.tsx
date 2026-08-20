/**
 * @vitest-environment jsdom
 */
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
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

const SAVED_VIEW: TableViewWire = {
  ...DEFAULT_VIEW,
  id: 'view-saved',
  name: 'Saved',
  isDefault: false,
}

function renderMenu(views: TableViewWire[], activeViewId: string | null): string {
  return renderToStaticMarkup(
    <ViewsMenu
      views={views}
      activeViewId={activeViewId}
      onSelect={vi.fn()}
      onRename={vi.fn()}
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

  it('only offers deletion for non-default views', () => {
    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)

    act(() => {
      root.render(
        <ViewsMenu
          views={[DEFAULT_VIEW, SAVED_VIEW]}
          activeViewId={DEFAULT_VIEW.id}
          onSelect={vi.fn()}
          onRename={vi.fn()}
          onDelete={vi.fn()}
          onNewView={vi.fn()}
          canEdit
        />
      )
    })
    act(() => container.querySelector<HTMLButtonElement>('button[aria-label="Views"]')?.click())

    expect(document.body.querySelectorAll('button[aria-label="Delete"]')).toHaveLength(1)

    act(() => root.unmount())
    container.remove()
  })
})
