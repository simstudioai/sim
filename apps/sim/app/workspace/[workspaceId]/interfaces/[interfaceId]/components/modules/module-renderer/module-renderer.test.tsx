/**
 * @vitest-environment jsdom
 */
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiClientError } from '@/lib/api/client/errors'

const { mockUseTable, mockUseInfiniteTableRows, mockUseWorkspaceFileRecord } = vi.hoisted(() => ({
  mockUseTable: vi.fn(),
  mockUseInfiniteTableRows: vi.fn(),
  mockUseWorkspaceFileRecord: vi.fn(),
}))

vi.mock('@/hooks/queries/tables', () => ({
  useTable: mockUseTable,
  useInfiniteTableRows: mockUseInfiniteTableRows,
}))

vi.mock('@/hooks/queries/workspace-files', () => ({
  useWorkspaceFileRecord: mockUseWorkspaceFileRecord,
}))

vi.mock('@/hooks/use-execution-stream', () => ({
  useExecutionStream: () => ({ execute: vi.fn(), cancelExecute: vi.fn() }),
}))

vi.mock('@/app/workspace/[workspaceId]/files/components/file-viewer/file-viewer', () => ({
  FileViewer: ({ file, readOnly }: { file: { name: string }; readOnly?: boolean }) => (
    <div data-testid='file-viewer' data-name={file.name} data-read-only={String(!!readOnly)} />
  ),
}))

vi.mock(
  '@/app/workspace/[workspaceId]/interfaces/[interfaceId]/components/modules/form-module',
  () => ({ FormModule: () => <div data-testid='form-module' /> })
)

import type { InterfaceModule } from '@/lib/interfaces'
import { ModuleRenderer } from '@/app/workspace/[workspaceId]/interfaces/[interfaceId]/components/modules/module-renderer'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const WORKSPACE_ID = 'ws-1'
const INTERFACE_ID = 'if-1'

let container: HTMLDivElement
let root: Root

function render(module: InterfaceModule, mode: 'edit' | 'preview' = 'preview', canEdit = true) {
  act(() => {
    root.render(
      <ModuleRenderer
        workspaceId={WORKSPACE_ID}
        interfaceId={INTERFACE_ID}
        module={module}
        mode={mode}
        canEdit={canEdit}
      />
    )
  })
}

/** Flushes the `lazy()` boundary the file module mounts its viewer behind. */
async function flush() {
  await act(async () => {})
}

function pendingQuery() {
  return { isPending: true, isError: false, data: undefined }
}

function successQuery(data: unknown) {
  return { isPending: false, isError: false, data }
}

/**
 * A failed query carrying a real `ApiClientError`, so the module's
 * deleted-vs-unreachable branch is driven by the status the boundary actually
 * produces rather than a bare `isError` flag.
 */
function errorQuery(status: number) {
  return {
    isPending: false,
    isError: true,
    data: undefined,
    error: new ApiClientError({ status, message: `Request failed with ${status}`, body: null }),
  }
}

/** `useInfiniteQuery` shape — the table module pages in more rows as it scrolls. */
function rowsQuery(
  data: unknown,
  page: { hasNextPage?: boolean; isFetchingNextPage?: boolean; fetchNextPage?: () => void } = {}
) {
  return {
    isPending: false,
    isError: false,
    data,
    hasNextPage: false,
    isFetchingNextPage: false,
    fetchNextPage: vi.fn(),
    ...page,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  mockUseTable.mockReturnValue(pendingQuery())
  mockUseInfiniteTableRows.mockReturnValue(pendingQuery())
  mockUseWorkspaceFileRecord.mockReturnValue(pendingQuery())
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
})

const UNCONFIGURED: InterfaceModule[] = [
  {
    id: 'm-chat',
    type: 'chat',
    cell: { row: 0, col: 0 },
    config: { workflowId: null, outputConfigs: [], showThinking: false, welcomeMessage: '' },
  },
  { id: 'm-table', type: 'table', cell: { row: 0, col: 0 }, config: { tableId: null } },
  { id: 'm-file', type: 'file', cell: { row: 0, col: 0 }, config: { fileId: null } },
]

describe('ModuleRenderer', () => {
  it('dispatches each module type to its renderer', () => {
    render({
      id: 'm-form',
      type: 'form',
      cell: { row: 0, col: 0 },
      config: { workflowId: null, fields: [], submitLabel: 'Submit' },
    })
    expect(container.querySelector('[data-testid="form-module"]')).not.toBeNull()

    render(UNCONFIGURED[0])
    expect(container.textContent).toContain('This chat is not available.')

    render(UNCONFIGURED[1])
    expect(container.textContent).toContain('This table is not available.')

    render(UNCONFIGURED[2])
    expect(container.textContent).toContain('This file is not available.')
  })

  it('points the builder at the inspector in edit mode', () => {
    render(UNCONFIGURED[0], 'edit')
    expect(container.textContent).toContain('Connect a workflow to start chatting.')

    render(UNCONFIGURED[1], 'edit')
    expect(container.textContent).toContain('Pick a table in the properties panel.')

    render(UNCONFIGURED[2], 'edit')
    expect(container.textContent).toContain('Pick a file in the properties panel.')
  })

  it('never names an editing surface in preview', () => {
    for (const module of UNCONFIGURED) {
      render(module)
      expect(container.textContent).not.toContain('properties panel')
      expect(container.textContent).not.toContain('edit mode')
    }
  })
})

describe('ChatModule', () => {
  const chatModule = (
    config: Partial<Extract<InterfaceModule, { type: 'chat' }>['config']> = {}
  ): InterfaceModule => ({
    id: 'm-chat',
    type: 'chat',
    cell: { row: 0, col: 0 },
    config: {
      workflowId: 'wf-1',
      outputConfigs: [],
      showThinking: false,
      welcomeMessage: '',
      ...config,
    },
  })

  it('renders the welcome message as the opening assistant turn', () => {
    render(chatModule({ welcomeMessage: 'How can I help?' }))
    expect(container.textContent).toContain('How can I help?')
  })

  it('prompts for a first message when no welcome message is configured', () => {
    render(chatModule())
    expect(container.textContent).toContain('Send a message to run this workflow.')
  })

  it('disables the composer in edit mode and enables it in preview', () => {
    render(chatModule(), 'edit')
    const editTextarea = container.querySelector('textarea')
    expect(editTextarea?.disabled).toBe(true)
    expect(container.querySelector('[aria-label="Send message"]')).toHaveProperty('disabled', true)

    render(chatModule(), 'preview')
    const previewTextarea = container.querySelector('textarea')
    expect(previewTextarea?.disabled).toBe(false)
  })

  it('disables the composer for a viewer who cannot run the workflow', () => {
    render(chatModule(), 'preview', false)
    expect(container.querySelector('textarea')?.disabled).toBe(true)
    expect(container.querySelector('[aria-label="Send message"]')).toHaveProperty('disabled', true)
  })
})

describe('TableModule', () => {
  const tableModule: InterfaceModule = {
    id: 'm-table',
    type: 'table',
    cell: { row: 0, col: 0 },
    config: { tableId: 'tbl-1' },
  }

  it('treats a deleted table as a dangling reference', () => {
    mockUseTable.mockReturnValue(errorQuery(404))
    render(tableModule)
    expect(container.textContent).toContain('This table is no longer in the workspace.')
  })

  it('reports an unreachable table without claiming it was deleted', () => {
    mockUseTable.mockReturnValue(errorQuery(500))
    render(tableModule)
    expect(container.textContent).toContain('This table could not be loaded.')
    expect(container.textContent).not.toContain('no longer in the workspace')
  })

  it('does not claim deletion when the session has expired', () => {
    mockUseTable.mockReturnValue(errorQuery(401))
    render(tableModule)
    expect(container.textContent).not.toContain('no longer in the workspace')
  })

  it('renders columns, rows, and the remaining-rows footer', () => {
    mockUseTable.mockReturnValue(
      successQuery({
        schema: {
          columns: [
            { id: 'col_a', name: 'Name' },
            { id: 'col_b', name: 'Score' },
          ],
        },
      })
    )
    mockUseInfiniteTableRows.mockReturnValue(
      rowsQuery({
        pages: [
          {
            rows: [
              { id: 'r1', data: { col_a: 'Ada', col_b: 42 } },
              { id: 'r2', data: { col_a: 'Grace', col_b: null } },
            ],
            totalCount: 500,
          },
        ],
      })
    )
    render(tableModule)

    const headers = [...container.querySelectorAll('th')].map((th) => th.textContent)
    expect(headers).toEqual(['Name', 'Score'])
    const firstRow = [...container.querySelectorAll('tbody tr')][0]
    expect([...firstRow.querySelectorAll('td')].map((td) => td.textContent)).toEqual(['Ada', '42'])
    expect(container.textContent).toContain('Showing 2 of 500 rows.')
  })

  it('renders every fetched page, not just the first', () => {
    mockUseTable.mockReturnValue(
      successQuery({ schema: { columns: [{ id: 'col_a', name: 'A' }] } })
    )
    mockUseInfiniteTableRows.mockReturnValue(
      rowsQuery({
        pages: [
          { rows: [{ id: 'r1', data: { col_a: 'one' } }], totalCount: 2 },
          { rows: [{ id: 'r2', data: { col_a: 'two' } }], totalCount: 2 },
        ],
      })
    )
    render(tableModule)

    expect(container.querySelectorAll('tbody tr')).toHaveLength(2)
    expect(container.textContent).not.toContain('Showing')
  })

  it('pages in the next batch when the scroller nears the end', () => {
    const fetchNextPage = vi.fn()
    mockUseTable.mockReturnValue(
      successQuery({ schema: { columns: [{ id: 'col_a', name: 'A' }] } })
    )
    mockUseInfiniteTableRows.mockReturnValue(
      rowsQuery(
        { pages: [{ rows: [{ id: 'r1', data: { col_a: 'x' } }], totalCount: 500 }] },
        {
          hasNextPage: true,
          fetchNextPage,
        }
      )
    )
    render(tableModule)

    const scroller = container.querySelector('[class*="overscroll-contain"]') as HTMLDivElement
    Object.defineProperties(scroller, {
      scrollHeight: { value: 1000, configurable: true },
      clientHeight: { value: 400, configurable: true },
      /** 500px from the end — outside the prefetch window. */
      scrollTop: { value: 100, configurable: true },
    })

    act(() => scroller.dispatchEvent(new Event('scroll', { bubbles: true })))
    expect(fetchNextPage).not.toHaveBeenCalled()

    /** 50px from the end — inside it. */
    Object.defineProperty(scroller, 'scrollTop', { value: 550, configurable: true })
    act(() => scroller.dispatchEvent(new Event('scroll', { bubbles: true })))
    expect(fetchNextPage).toHaveBeenCalledTimes(1)
  })

  it('keeps the loaded rows when a scroll-triggered page fails', () => {
    mockUseTable.mockReturnValue(
      successQuery({ schema: { columns: [{ id: 'col_a', name: 'A' }] } })
    )
    mockUseInfiniteTableRows.mockReturnValue({
      ...rowsQuery({ pages: [{ rows: [{ id: 'r1', data: { col_a: 'kept' } }], totalCount: 500 }] }),
      isError: true,
    })
    render(tableModule)

    expect(container.textContent).toContain('kept')
    expect(container.textContent).not.toContain('no longer in the workspace')
  })

  it('reports a dangling reference when the first page fails', () => {
    mockUseTable.mockReturnValue(
      successQuery({ schema: { columns: [{ id: 'col_a', name: 'A' }] } })
    )
    mockUseInfiniteTableRows.mockReturnValue({
      ...rowsQuery(undefined),
      ...errorQuery(404),
    })
    render(tableModule)
    expect(container.textContent).toContain('This table is no longer in the workspace.')
  })

  it('reports an unreachable first page without claiming the table was deleted', () => {
    mockUseTable.mockReturnValue(
      successQuery({ schema: { columns: [{ id: 'col_a', name: 'A' }] } })
    )
    mockUseInfiniteTableRows.mockReturnValue({
      ...rowsQuery(undefined),
      ...errorQuery(503),
    })
    render(tableModule)
    expect(container.textContent).toContain('This table could not be loaded.')
  })

  it('shows an empty state for a table with no rows', () => {
    mockUseTable.mockReturnValue(
      successQuery({ schema: { columns: [{ id: 'col_a', name: 'A' }] } })
    )
    mockUseInfiniteTableRows.mockReturnValue(rowsQuery({ pages: [{ rows: [], totalCount: 0 }] }))
    render(tableModule)
    expect(container.textContent).toContain('This table has no rows yet.')
  })

  it('requests the module page size', () => {
    render(tableModule)
    expect(mockUseInfiniteTableRows).toHaveBeenCalledWith(
      expect.objectContaining({ workspaceId: WORKSPACE_ID, tableId: 'tbl-1', pageSize: 100 })
    )
  })
})

describe('FileModule', () => {
  const fileModule: InterfaceModule = {
    id: 'm-file',
    type: 'file',
    cell: { row: 0, col: 0 },
    config: { fileId: 'file-1' },
  }

  const record = {
    id: 'file-1',
    name: 'quarterly-report.pdf',
    size: 2048,
    type: 'application/pdf',
  }

  it('treats a missing file as a dangling reference', () => {
    mockUseWorkspaceFileRecord.mockReturnValue(successQuery(null))
    render(fileModule)
    expect(container.textContent).toContain('This file is no longer in the workspace.')
  })

  it('renders the file through the read-only viewer', async () => {
    mockUseWorkspaceFileRecord.mockReturnValue(successQuery(record))
    render(fileModule, 'preview')
    await flush()

    const viewer = container.querySelector('[data-testid="file-viewer"]')
    expect(viewer?.getAttribute('data-name')).toBe('quarterly-report.pdf')
    expect(viewer?.getAttribute('data-read-only')).toBe('true')
  })

  it('renders the same viewer in edit mode', async () => {
    mockUseWorkspaceFileRecord.mockReturnValue(successQuery(record))
    render(fileModule, 'edit')
    await flush()

    expect(container.querySelector('[data-testid="file-viewer"]')).not.toBeNull()
  })
})
