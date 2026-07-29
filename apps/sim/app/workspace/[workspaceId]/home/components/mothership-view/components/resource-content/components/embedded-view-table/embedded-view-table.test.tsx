/**
 * @vitest-environment jsdom
 */

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const { tableMock } = vi.hoisted(() => ({ tableMock: vi.fn() }))

vi.mock('@/app/workspace/[workspaceId]/tables/[tableId]/table', () => ({
  Table: (props: Record<string, unknown>) => {
    tableMock(props)
    return <div data-testid='embedded-table' />
  },
}))

import { EmbeddedViewTable } from './embedded-view-table'

let container: HTMLDivElement
let root: Root

describe('EmbeddedViewTable', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(async () => {
    await act(async () => root.unmount())
    container.remove()
  })

  it('renders the source Table with the persisted View selected', async () => {
    await act(async () => {
      root.render(
        <EmbeddedViewTable workspaceId='workspace_1' resourceId='tbl_1:view_1' viewsEnabled />
      )
    })

    expect(container.querySelector('[data-testid="embedded-table"]')).not.toBeNull()
    expect(tableMock).toHaveBeenCalledWith({
      workspaceId: 'workspace_1',
      tableId: 'tbl_1',
      viewId: 'view_1',
      embedded: true,
      viewsEnabled: true,
    })
  })

  it('does not render a malformed View resource', async () => {
    await act(async () => {
      root.render(<EmbeddedViewTable workspaceId='workspace_1' resourceId='view_1' />)
    })

    expect(container.innerHTML).toBe('')
    expect(tableMock).not.toHaveBeenCalled()
  })

  it('does not bypass a disabled Views feature flag', async () => {
    await act(async () => {
      root.render(<EmbeddedViewTable workspaceId='workspace_1' resourceId='tbl_1:view_1' />)
    })

    expect(container.innerHTML).toBe('')
    expect(tableMock).not.toHaveBeenCalled()
  })
})
