/**
 * @vitest-environment jsdom
 *
 * A capped CSV preview offers to import the whole file as a table, which only an editor can do.
 * Failure mode: a reader without edit access offered "Import as a table", which the server refuses.
 */
import { act } from 'react'
import { stubResizeObserver } from '@sim/testing/mocks/browser-apis.mock'
import { nextNavigationMock } from '@sim/testing/mocks/next-navigation.mock'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

vi.mock('next/navigation', () => nextNavigationMock)
const sink = vi.hoisted(() => ({ warning: vi.fn(), success: vi.fn(), error: vi.fn() }))
vi.mock('@/lib/toast/sink', () => ({ toast: sink }))
vi.mock('@/hooks/queries/tables', () => ({ useImportFileAsTable: () => ({ mutate: vi.fn() }) }))
vi.mock('@/hooks/queries/workspace-file-table', () => ({
  useWorkspaceCsvPreview: () => ({
    data: { headers: ['a'], rows: [['1']], truncated: true },
    error: null,
  }),
}))

import { CsvTablePreview } from '@/components/file-viewer/csv-table-preview'
import type { WorkspaceFileRecord } from '@/lib/uploads/contexts/workspace'

let container: HTMLDivElement
let root: Root

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  stubResizeObserver()
  sink.warning.mockClear()
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
})

const file = {
  id: 'file',
  key: 'workspace/ws/big.csv',
  name: 'big.csv',
  size: 50_000_000,
  updatedAt: '2026-11-01T00:00:00.000Z',
} as unknown as WorkspaceFileRecord

it('offers the table import only to a viewer who can edit', () => {
  act(() => root.render(<CsvTablePreview file={file} workspaceId='ws' readOnly />))
  expect(sink.warning).not.toHaveBeenCalled()
  act(() =>
    root.render(<CsvTablePreview key='editor' file={file} workspaceId='ws' readOnly={false} />)
  )
  expect(sink.warning).toHaveBeenCalledTimes(1)
})
