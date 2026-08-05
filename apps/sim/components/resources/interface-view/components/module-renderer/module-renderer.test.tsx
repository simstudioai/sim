/**
 * @vitest-environment jsdom
 */
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiClientError } from '@/lib/api/client/errors'
import { PUBLIC_TABLE_PAGE_SIZE } from '@/lib/api/contracts/public-interfaces'

const {
  mockUseTable,
  mockUseInfiniteTableRows,
  mockUseWorkspaceFileRecord,
  mockUsePublicInterfaceTableRows,
  mockUseTablesList,
  mockUseWorkspaceFiles,
  mockUseWorkflows,
} = vi.hoisted(() => ({
  mockUseTable: vi.fn(),
  mockUseInfiniteTableRows: vi.fn(),
  mockUseWorkspaceFileRecord: vi.fn(),
  mockUsePublicInterfaceTableRows: vi.fn(),
  mockUseTablesList: vi.fn(),
  mockUseWorkspaceFiles: vi.fn(),
  mockUseWorkflows: vi.fn(),
}))

vi.mock('@/hooks/queries/tables', () => ({
  useTable: mockUseTable,
  useInfiniteTableRows: mockUseInfiniteTableRows,
  useTablesList: mockUseTablesList,
}))

vi.mock('@/hooks/queries/public-interfaces', () => ({
  usePublicInterfaceTableRows: mockUsePublicInterfaceTableRows,
}))

vi.mock('@/hooks/queries/workspace-files', () => ({
  useWorkspaceFileRecord: mockUseWorkspaceFileRecord,
  useWorkspaceFiles: mockUseWorkspaceFiles,
}))

vi.mock('@/hooks/queries/workflows', () => ({
  useWorkflows: mockUseWorkflows,
}))

vi.mock('@/hooks/use-execution-stream', () => ({
  useExecutionStream: () => ({ execute: vi.fn(), cancelExecute: vi.fn() }),
}))

vi.mock('@/components/resources/file-view/file-view', () => ({
  FileView: ({
    source,
    readOnly,
  }: {
    source: {
      via: string
      resourceId?: string
      grantId?: string
      seed?: { name: string }
    }
    readOnly?: boolean
  }) => (
    <div
      data-testid='file-view'
      data-via={source.via}
      data-address={source.via === 'share' ? source.grantId : source.resourceId}
      data-name={source.seed?.name ?? ''}
      data-read-only={String(!!readOnly)}
    />
  ),
}))

vi.mock(
  '@/components/resources/interface-view/components/module-renderer/components/form-module',
  () => ({
    FormModule: () => <div data-testid='form-module' />,
  })
)

/**
 * The chat module mounts the deployed chat's composer. Stubbed to the surface
 * the module is responsible for wiring — its inert state and its attach
 * policy — rather than re-testing a component the deployed chat owns.
 */
vi.mock('@/app/(interfaces)/chat/components/input/input', () => ({
  ChatInput: ({
    disabled,
    docked,
    allowAttachments,
    placeholder,
  }: {
    disabled?: boolean
    docked?: boolean
    allowAttachments?: boolean
    placeholder?: string
  }) => (
    <div
      data-testid='chat-input'
      data-docked={String(docked)}
      data-allow-attachments={String(allowAttachments)}
    >
      <textarea disabled={disabled} placeholder={placeholder} />
      <button type='button' aria-label='Send message' disabled={disabled} />
    </div>
  ),
}))

import { ModuleRenderer } from '@/components/resources/interface-view/components/module-renderer'
import { ResourceProvider } from '@/components/resources/resource-provider'
import type { InterfaceLayout, InterfaceModule } from '@/lib/interfaces/types'
import {
  type InterfaceModuleSeed,
  type ResourceGrants,
  type ResourceSource,
  shareSource,
  workspaceSource,
} from '@/resources'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const WORKSPACE_ID = 'ws-1'
const INTERFACE_ID = 'if-1'
const TOKEN = 'tok-1'

const EMPTY_LAYOUT: InterfaceLayout = { version: 1, grid: { rows: 1, cols: 1 }, modules: [] }

const GRANTS: ResourceGrants = { write: true, run: true }

const WORKSPACE_SOURCE: ResourceSource<'interface'> = workspaceSource({
  kind: 'interface',
  workspaceId: WORKSPACE_ID,
  resourceId: INTERFACE_ID,
})

/**
 * A shared interface is a container of grants: each table/file module mints its
 * own child share source from the seed the server resolved for it.
 */
function shareInterface(
  modules: Record<string, InterfaceModuleSeed> = {}
): ResourceSource<'interface'> {
  return shareSource({
    kind: 'interface',
    token: TOKEN,
    grantId: TOKEN,
    seed: { name: 'Shared', layout: EMPTY_LAYOUT, modules },
  })
}

let container: HTMLDivElement
let root: Root

function render(
  module: InterfaceModule,
  mode: 'edit' | 'preview' = 'preview',
  canRun = true,
  source: ResourceSource<'interface'> = WORKSPACE_SOURCE,
  /** Present = this surface may author the module, exactly as the canvas decides. */
  onConfigChange?: (moduleId: string, config: InterfaceModule['config'], isValid: boolean) => void
) {
  act(() => {
    root.render(
      <ResourceProvider source={source} grants={GRANTS} host='page'>
        <ModuleRenderer
          module={module}
          mode={mode}
          canRun={canRun}
          onConfigChange={onConfigChange}
        />
      </ResourceProvider>
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

/** A settled resource-list query, the shape the in-module pickers read. */
function listQuery(data: unknown) {
  return { data, isLoading: false }
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
  mockUsePublicInterfaceTableRows.mockReturnValue(pendingQuery())
  mockUseWorkspaceFileRecord.mockReturnValue(pendingQuery())
  mockUseTablesList.mockReturnValue(listQuery([{ id: 'tbl-1', name: 'Leads' }]))
  mockUseWorkspaceFiles.mockReturnValue(listQuery([{ id: 'file-1', name: 'Report.pdf' }]))
  mockUseWorkflows.mockReturnValue(listQuery([{ id: 'wf-1', name: 'Triage' }]))
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
    placement: { row: 0, col: 0, rowSpan: 1, colSpan: 1 },
    config: { workflowId: null, outputConfigs: [], showThinking: false, welcomeMessage: '' },
  },
  {
    id: 'm-table',
    type: 'table',
    placement: { row: 0, col: 0, rowSpan: 1, colSpan: 1 },
    config: { tableId: null },
  },
  {
    id: 'm-file',
    type: 'file',
    placement: { row: 0, col: 0, rowSpan: 1, colSpan: 1 },
    config: { fileId: null },
  },
]

describe('ModuleRenderer', () => {
  it('dispatches each module type to its renderer', () => {
    render({
      id: 'm-form',
      type: 'form',
      placement: { row: 0, col: 0, rowSpan: 1, colSpan: 1 },
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

  it('offers an in-module picker when the surface may author the module', () => {
    const onConfigChange = vi.fn()

    render(UNCONFIGURED[0], 'edit', true, WORKSPACE_SOURCE, onConfigChange)
    expect(container.textContent).toContain('Select a workflow')

    render(UNCONFIGURED[1], 'edit', true, WORKSPACE_SOURCE, onConfigChange)
    expect(container.textContent).toContain('Select a table')

    render(UNCONFIGURED[2], 'edit', true, WORKSPACE_SOURCE, onConfigChange)
    expect(container.textContent).toContain('Select a file')
  })

  /**
   * `onConfigChange` is what the canvas withholds from a read-only member, so
   * its absence must never leave a picker the viewer cannot act on.
   */
  it('falls back to the unavailable copy without an authoring callback', () => {
    render(UNCONFIGURED[0], 'edit')
    expect(container.textContent).toContain('This chat is not available.')

    render(UNCONFIGURED[1], 'edit')
    expect(container.textContent).toContain('This table is not available.')

    render(UNCONFIGURED[2], 'edit')
    expect(container.textContent).toContain('This file is not available.')
  })

  it('never names an editing surface in preview', () => {
    for (const module of UNCONFIGURED) {
      render(module)
      expect(container.textContent).not.toContain('properties panel')
      expect(container.textContent).not.toContain('edit mode')
      expect(container.textContent).not.toContain('Select a')
    }
  })
})

describe('ChatModule', () => {
  const chatModule = (
    config: Partial<Extract<InterfaceModule, { type: 'chat' }>['config']> = {}
  ): InterfaceModule => ({
    id: 'm-chat',
    type: 'chat',
    placement: { row: 0, col: 0, rowSpan: 1, colSpan: 1 },
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

  /** The deployed composer pins itself to the viewport; inside a pane it must not. */
  it('mounts the composer undocked so it stays inside the module', () => {
    render(chatModule(), 'preview')
    expect(container.querySelector('[data-testid="chat-input"]')?.getAttribute('data-docked')).toBe(
      'false'
    )
  })

  /**
   * Attachments ride to `/api/workflows/[id]/execute`, which uploads them. The
   * token-scoped chat route declares a text-only body, so a share must not
   * offer an affordance whose files the contract would strip.
   */
  it('offers attachments in workspace scope and withholds them on a share', () => {
    render(chatModule(), 'preview')
    expect(
      container.querySelector('[data-testid="chat-input"]')?.getAttribute('data-allow-attachments')
    ).toBe('true')

    render(chatModule(), 'preview', true, shareInterface())
    expect(
      container.querySelector('[data-testid="chat-input"]')?.getAttribute('data-allow-attachments')
    ).toBe('false')
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
    placement: { row: 0, col: 0, rowSpan: 1, colSpan: 1 },
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

  /**
   * Cells used to be `String(value)` for every type. These pin the typed
   * appearances so a boolean cannot silently regress to the text "false" and a
   * URL cannot lose its link.
   */
  it('draws each column type with its own cell appearance', () => {
    mockUseTable.mockReturnValue(
      successQuery({
        schema: {
          columns: [
            { id: 'col_flag', name: 'Flag', type: 'boolean' },
            { id: 'col_site', name: 'Site', type: 'string' },
            { id: 'col_note', name: 'Note', type: 'string' },
            { id: 'col_meta', name: 'Meta', type: 'json' },
          ],
        },
      })
    )
    mockUseInfiniteTableRows.mockReturnValue(
      rowsQuery({
        pages: [
          {
            rows: [
              {
                id: 'r1',
                data: {
                  col_flag: false,
                  col_site: 'https://example.com/a',
                  col_note: 'plain',
                  col_meta: { a: 1 },
                },
              },
            ],
            totalCount: 1,
          },
        ],
      })
    )
    render(tableModule)

    /** A false boolean is a checkbox, not the word "false". */
    expect(container.querySelector('[role="checkbox"]')).not.toBeNull()
    expect(container.textContent).not.toContain('false')

    const link = container.querySelector('a[href="https://example.com/a"]')
    expect(link).not.toBeNull()
    expect(link?.getAttribute('target')).toBe('_blank')
    expect(container.querySelector('img')).not.toBeNull()

    expect(container.textContent).toContain('plain')
    expect(container.textContent).toContain('{"a":1}')
  })

  /** An all-empty row must not collapse to its padding and break the rhythm. */
  it('keeps an empty cell the same height as a filled one', () => {
    mockUseTable.mockReturnValue(
      successQuery({ schema: { columns: [{ id: 'col_a', name: 'A', type: 'string' }] } })
    )
    mockUseInfiniteTableRows.mockReturnValue(
      rowsQuery({
        pages: [
          {
            rows: [
              { id: 'r1', data: { col_a: '' } },
              { id: 'r2', data: { col_a: 'x' } },
            ],
            totalCount: 2,
          },
        ],
      })
    )
    render(tableModule)

    const spans = [...container.querySelectorAll('tbody td > span')]
    expect(spans).toHaveLength(2)
    expect(spans.every((span) => span.className.includes('min-h-[20px]'))).toBe(true)
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
    placement: { row: 0, col: 0, rowSpan: 1, colSpan: 1 },
    config: { fileId: 'file-1' },
  }

  const unconfigured: InterfaceModule = { ...fileModule, config: { fileId: null } }

  it('binds its own file from the module and reports the edit as valid', () => {
    const onConfigChange = vi.fn()
    render(unconfigured, 'edit', true, WORKSPACE_SOURCE, onConfigChange)
    expect(container.textContent).toContain('Select a file')

    render(unconfigured, 'preview')
    expect(container.textContent).toContain('This file is not available.')
    expect(container.textContent).not.toContain('Select a file')
  })

  it('addresses the file by id and never offers to change it', async () => {
    render(fileModule, 'preview')
    await flush()

    const view = container.querySelector('[data-testid="file-view"]')
    expect(view?.getAttribute('data-via')).toBe('workspace')
    expect(view?.getAttribute('data-address')).toBe('file-1')
    expect(view?.getAttribute('data-read-only')).toBe('true')
  })

  it('addresses the same file the same way in edit mode', async () => {
    render(fileModule, 'edit')
    await flush()

    expect(container.querySelector('[data-testid="file-view"]')?.getAttribute('data-address')).toBe(
      'file-1'
    )
  })
})

/**
 * The same renderers, mounted against a share source. These assert the seam
 * itself: no module forks for the public page, and none of them reaches a
 * workspace-scoped query while a share token is what authorizes the viewer.
 */
describe('share source', () => {
  const tableModule: InterfaceModule = {
    id: 'm-table',
    type: 'table',
    placement: { row: 0, col: 0, rowSpan: 1, colSpan: 1 },
    config: { tableId: 'tbl-1' },
  }

  const fileModule: InterfaceModule = {
    id: 'm-file',
    type: 'file',
    placement: { row: 0, col: 0, rowSpan: 1, colSpan: 1 },
    config: { fileId: 'file-1' },
  }

  it('reads table rows from the token route and never the workspace one', () => {
    mockUsePublicInterfaceTableRows.mockReturnValue(
      rowsQuery({ pages: [{ rows: [{ id: 'r1', data: { col_a: 'shared' } }], totalCount: 1 }] })
    )
    render(
      tableModule,
      'preview',
      true,
      shareInterface({
        'm-table': {
          kind: 'table',
          seed: { name: 'People', columns: [{ id: 'col_a', name: 'A', type: 'string' }] },
        },
      })
    )

    expect(mockUsePublicInterfaceTableRows).toHaveBeenCalledWith(
      expect.objectContaining({
        token: TOKEN,
        moduleId: 'm-table',
        /** The public contract's hard `limit` ceiling — asking for more is a 400. */
        pageSize: PUBLIC_TABLE_PAGE_SIZE,
        enabled: true,
      })
    )
    expect(mockUseInfiniteTableRows).toHaveBeenCalledWith(
      expect.objectContaining({ enabled: false })
    )
    expect(mockUseTable).toHaveBeenCalledWith(undefined, undefined)
    expect(container.textContent).toContain('shared')
  })

  it('renders the server-resolved columns without fetching a schema', () => {
    mockUsePublicInterfaceTableRows.mockReturnValue(
      rowsQuery({ pages: [{ rows: [{ id: 'r1', data: { col_a: 'x' } }], totalCount: 1 }] })
    )
    render(
      tableModule,
      'preview',
      true,
      shareInterface({
        'm-table': {
          kind: 'table',
          seed: { name: 'People', columns: [{ id: 'col_a', name: 'Name', type: 'string' }] },
        },
      })
    )

    expect([...container.querySelectorAll('th')].map((th) => th.textContent)).toEqual(['Name'])
  })

  it('never tells a visitor the table lived in a workspace', () => {
    mockUsePublicInterfaceTableRows.mockReturnValue({
      ...rowsQuery(undefined),
      ...errorQuery(404),
    })
    render(
      tableModule,
      'preview',
      true,
      shareInterface({ 'm-table': { kind: 'table', seed: { name: 'People', columns: [] } } })
    )

    expect(container.textContent).toContain('This table is no longer available.')
    expect(container.textContent).not.toContain('workspace')
  })

  it('renders a file from the server-resolved metadata without a workspace fetch', async () => {
    render(
      fileModule,
      'preview',
      true,
      shareInterface({
        'm-file': {
          kind: 'file',
          seed: {
            name: 'quarterly-report.pdf',
            type: 'application/pdf',
            size: 2048,
            version: 1700000000000,
          },
        },
      })
    )
    await flush()

    const view = container.querySelector('[data-testid="file-view"]')
    expect(view?.getAttribute('data-via')).toBe('share')
    expect(view?.getAttribute('data-address')).toBe('m-file')
    expect(view?.getAttribute('data-name')).toBe('quarterly-report.pdf')
    expect(view?.getAttribute('data-read-only')).toBe('true')
    expect(mockUseWorkspaceFileRecord).not.toHaveBeenCalled()
  })
})
