/**
 * @vitest-environment jsdom
 */
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { mockUseTablesList, mockUseFolders, mockUsePinnedIds } = vi.hoisted(() => ({
  mockUseTablesList: vi.fn(),
  mockUseFolders: vi.fn(),
  mockUsePinnedIds: vi.fn(),
}))

vi.mock('next/link', () => ({
  default: ({ href, children }: { href: string; children: React.ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}))
vi.mock('next/navigation', () => ({ useParams: () => ({ workspaceId: 'w1' }) }))
vi.mock('@/hooks/queries/tables', () => ({ useTablesList: mockUseTablesList }))
vi.mock('@/hooks/queries/folders', () => ({ useFolders: mockUseFolders }))
vi.mock('@/hooks/queries/pinned-items', () => ({ usePinnedIds: mockUsePinnedIds }))
vi.mock('@/hooks/queries/workspace-files', () => ({ useWorkspaceFiles: vi.fn() }))
vi.mock('@/hooks/queries/workspace-file-folders', () => ({ useWorkspaceFileFolders: vi.fn() }))

import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } from '@sim/emcn'
import { TablesRailFlyout } from '@/app/workspace/[workspaceId]/w/components/sidebar/components/rail-resource-flyout'

type QueryStub = { data?: unknown; isPending: boolean; isPlaceholderData: boolean }

const resolved = (data: unknown): QueryStub => ({
  data,
  isPending: false,
  isPlaceholderData: false,
})
const placeholder = (data: unknown): QueryStub => ({
  data,
  isPending: false,
  isPlaceholderData: true,
})

const TABLE = {
  id: 't1',
  name: 'Leads',
  folderId: 'f1',
  updatedAt: new Date('2026-01-01'),
}
const FOLDER = { id: 'f1', name: 'Sales', parentId: null, updatedAt: new Date('2026-01-01') }

describe('TablesRailFlyout', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    vi.stubGlobal(
      'ResizeObserver',
      class {
        observe() {}
        unobserve() {}
        disconnect() {}
      }
    )
    mockUsePinnedIds.mockReturnValue(new Set<string>())
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
    vi.clearAllMocks()
    vi.unstubAllGlobals()
  })

  function render() {
    act(() => {
      root.render(
        <DropdownMenu open modal={false}>
          <DropdownMenuTrigger asChild>
            <button type='button'>rail</button>
          </DropdownMenuTrigger>
          <DropdownMenuContent>
            <TablesRailFlyout workspaceId='w1' />
          </DropdownMenuContent>
        </DropdownMenu>
      )
    })
    return document.body.textContent ?? ''
  }

  it('nests a table under its folder once both lists have resolved', () => {
    mockUseTablesList.mockReturnValue(resolved([TABLE]))
    mockUseFolders.mockReturnValue(resolved([FOLDER]))

    const text = render()

    expect(text).toContain('Sales')
    expect(text).not.toContain('Loading...')
    /* The table sits inside the folder's submenu, which is closed until hovered. */
    expect(document.querySelector('a[href="/workspace/w1/tables/t1"]')).toBeNull()
  })

  it('waits rather than filing tables at the root while the folders are the previous workspace’s', () => {
    mockUseTablesList.mockReturnValue(resolved([TABLE]))
    mockUseFolders.mockReturnValue(placeholder([]))

    const text = render()

    expect(text).toContain('Loading...')
    expect(text).not.toContain('Leads')
  })

  it('waits while the tables themselves are still placeholder data', () => {
    mockUseTablesList.mockReturnValue(placeholder([TABLE]))
    mockUseFolders.mockReturnValue(resolved([FOLDER]))

    expect(render()).toContain('Loading...')
  })

  it('still lists every table when the folder query failed outright', () => {
    mockUseTablesList.mockReturnValue(resolved([TABLE]))
    mockUseFolders.mockReturnValue({ data: undefined, isPending: false, isPlaceholderData: false })

    const text = render()

    expect(text).not.toContain('Loading...')
    expect(document.querySelector('a[href="/workspace/w1/tables/t1"]')?.textContent).toContain(
      'Leads'
    )
  })
})
