/**
 * @vitest-environment jsdom
 */
import { act, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/app/workspace/[workspaceId]/tables/[tableId]/table', () => ({
  Table: () => null,
}))
vi.mock(
  '@/app/workspace/[workspaceId]/home/components/mothership-view/components/resource-content/components/browser-session/browser-session',
  () => ({ BrowserSession: () => null })
)
vi.mock(
  '@/app/workspace/[workspaceId]/home/components/mothership-view/components/resource-content/components/terminal-session/terminal-session',
  () => ({ TerminalSession: () => null })
)

import { ResourceContent } from '@/app/workspace/[workspaceId]/home/components/mothership-view/components/resource-content/resource-content'
import type { MothershipResource } from '@/app/workspace/[workspaceId]/home/types'
import { useTableViewPinStore } from '@/stores/table/view-pin/store'

describe('ResourceContent table view handoff', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    useTableViewPinStore.getState().reset()
    container = document.createElement('div')
    root = createRoot(container)
  })

  afterEach(() => {
    act(() => root.unmount())
    useTableViewPinStore.getState().reset()
  })

  function render(resource: MothershipResource) {
    act(() => {
      root.render(
        (
          <ResourceContent
            workspaceId='workspace-1'
            desktopScopeId='chat:chat-1'
            resource={resource}
          />
        ) as ReactNode
      )
    })
  }

  it('hands off a restored view the table is mounted with', () => {
    // The table can only honour `initialViewId` while its views query already
    // lists that id. Reopening a chat against a cached list from before the
    // agent's write would otherwise strand the restored view.
    render({ type: 'table', id: 'table-1', title: 'Invoices', viewId: 'view-restored' })

    expect(useTableViewPinStore.getState().pins['table-1']?.viewId).toBe('view-restored')
  })

  it('does not pin a table opened without a saved view', () => {
    render({ type: 'table', id: 'table-1', title: 'Invoices' })

    expect(useTableViewPinStore.getState().pins['table-1']).toBeUndefined()
  })

  it('hands off a saved view that arrives after the embedded table mounts', () => {
    const table: MothershipResource = {
      type: 'table',
      id: 'table-1',
      title: 'Invoices',
    }
    render(table)
    expect(useTableViewPinStore.getState().pins['table-1']).toBeUndefined()

    render({ ...table, viewId: 'view-edited' })
    const pin = useTableViewPinStore.getState().pins['table-1']
    expect(pin?.viewId).toBe('view-edited')

    render({ ...table, viewId: 'view-edited' })
    expect(useTableViewPinStore.getState().pins['table-1']?.seq).toBe(pin?.seq)
  })
})
