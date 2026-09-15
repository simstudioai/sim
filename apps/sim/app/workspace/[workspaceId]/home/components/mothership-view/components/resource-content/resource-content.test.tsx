/**
 * @vitest-environment jsdom
 */
import { act, type ReactNode, StrictMode, useEffect, useImperativeHandle } from 'react'
import { QueryClient, QueryClientProvider, useQueryClient } from '@tanstack/react-query'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { FilePreviewSession } from '@/lib/mothership/request/session'
import type { FileDownloadSource } from '@/lib/uploads/client/download'
import type { WorkspaceFileRecord } from '@/lib/uploads/contexts/workspace'
import type { FileContentSource } from '@/hooks/use-file-content-source'

interface MockFileViewerProps {
  file: WorkspaceFileRecord
  workspaceId: string
  downloadSourceRef?: React.MutableRefObject<FileDownloadSource | null>
  streamingContent?: string
  canEdit?: boolean
  readOnly?: boolean
  collaborative?: boolean
  contentSource?: FileContentSource
}

const { download, files, detail, viewer } = vi.hoisted(() => ({
  download: vi.fn(),
  detail: vi.fn((): { data?: WorkspaceFileRecord; isFetching?: boolean } => ({})),
  viewer: vi.fn(),
  files: [] as WorkspaceFileRecord[],
}))

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }))
vi.mock('@/lib/uploads/client/download', () => ({ triggerFileDownload: download }))
vi.mock('@/hooks/queries/workspace-files', () => ({
  useWorkspaceFiles: () => ({ data: files }),
  useAddressedWorkspaceFileRecord: detail,
}))
vi.mock('@/app/workspace/[workspaceId]/providers/workspace-permissions-provider', () => ({
  useUserPermissionsContext: () => ({ canEdit: true }),
  useWorkspacePermissionsContext: () => ({ userPermissions: { canRead: true } }),
}))
vi.mock('@/app/workspace/[workspaceId]/files/components/file-viewer', () => ({
  resolveFileCategory: () => 'text-editable',
  FileViewer: (props: MockFileViewerProps) => {
    viewer(props)
    const { file, workspaceId, downloadSourceRef, streamingContent } = props
    useImperativeHandle(
      downloadSourceRef,
      () => ({
        fileId: file.id,
        workspaceId,
        getContent: () => streamingContent ?? 'settled content',
      }),
      [file.id, workspaceId, streamingContent]
    )
    return <div>{streamingContent ?? 'settled content'}</div>
  },
}))

const logQueries = vi.hoisted(() => ({
  detail: vi.fn(() => ({ data: undefined, isLoading: true, error: null })),
  execution: vi.fn(() => ({ data: undefined, isLoading: true, error: null })),
}))
vi.mock('@/hooks/queries/logs', () => ({
  useLogDetail: logQueries.detail,
  useLogByExecutionId: logQueries.execution,
}))
const canvasHydration = vi.hoisted(() => ({ enabled: false, query: vi.fn(), failed: vi.fn() }))
vi.mock('@/app/workspace/[workspaceId]/w/[workflowId]/workflow', () => ({
  default: ({ workflowId }: { workflowId: string }) => {
    const client = useQueryClient()
    useEffect(() => {
      if (canvasHydration.enabled) {
        void client
          .fetchQuery({
            queryKey: workflowKeys.state(workflowId),
            queryFn: canvasHydration.query,
            staleTime: 0,
          })
          .catch(canvasHydration.failed)
      }
    }, [client, workflowId])
    return <div>Verified workflow canvas</div>
  },
}))

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

import {
  ResourceActions,
  ResourceContent,
} from '@/app/workspace/[workspaceId]/home/components/mothership-view/components/resource-content/resource-content'
import type { MothershipResource } from '@/app/workspace/[workspaceId]/home/types'
import { workflowKeys } from '@/hooks/queries/utils/workflow-keys'
import { useTableViewPinStore } from '@/stores/table/view-pin/store'

describe('ResourceContent handoff', () => {
  let container: HTMLDivElement
  let root: Root
  let client: QueryClient

  beforeEach(() => {
    vi.clearAllMocks()
    canvasHydration.enabled = false
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    useTableViewPinStore.getState().reset()
    files.length = 0
    detail.mockReturnValue({})
    container = document.createElement('div')
    root = createRoot(container)
    client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  })

  afterEach(() => {
    act(() => root.unmount())
    useTableViewPinStore.getState().reset()
    client.clear()
  })

  function render(resource: MothershipResource) {
    act(() => {
      root.render(
        (
          <QueryClientProvider client={client}>
            <ResourceContent
              workspaceId='workspace-1'
              desktopScopeId='chat:chat-1'
              resource={resource}
            />
          </QueryClientProvider>
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

  it('opens a CLI log by its execution ID instead of querying it as a storage row', () => {
    render({ type: 'log', id: 'run-1', executionId: 'run-1', title: 'Workflow run' })
    expect(logQueries.detail).toHaveBeenCalledWith('run-1', 'workspace-1', { enabled: false })
    expect(logQueries.execution).toHaveBeenCalledWith('workspace-1', 'run-1')
  })

  it('keeps existing log row IDs on their ordinary detail path', () => {
    render({ type: 'log', id: 'row-1', title: 'Workflow run' })
    expect(logQueries.detail).toHaveBeenCalledWith('row-1', 'workspace-1', { enabled: true })
    expect(logQueries.execution).toHaveBeenCalledWith('workspace-1', undefined)
  })

  it('opens a foreign-workspace read without adding it to this workspace sidebar', () => {
    client.setQueryData(workflowKeys.list('workspace-1'), [])
    client.setQueryData(workflowKeys.state('foreign'), {
      id: 'foreign',
      workspaceId: 'workspace-2',
      name: 'Other workspace workflow',
    })
    render({ type: 'workflow', id: 'foreign', title: 'Other workspace workflow' })
    expect(container.textContent).toContain('Other workspace workflow')
    expect(container.textContent).toContain('Open in its workspace')
    expect(client.getQueryData(workflowKeys.list('workspace-1'))).toEqual([])
  })

  it('uses authorized same-workspace metadata, including folder and order, for a missing inventory entry', async () => {
    client.setQueryData(workflowKeys.list('workspace-1'), [])
    client.setQueryData(workflowKeys.state('verified'), {
      id: 'verified',
      workspaceId: 'workspace-1',
      name: 'Verified name',
      folderId: 'actual-folder',
      sortOrder: 42,
      createdAt: new Date('2026-09-01'),
      updatedAt: new Date('2026-09-02'),
      archivedAt: null,
    })
    render({ type: 'workflow', id: 'verified', title: 'Untrusted placeholder' })
    await act(async () => {})
    expect(client.getQueryData(workflowKeys.list('workspace-1'))).toEqual([
      expect.objectContaining({
        id: 'verified',
        name: 'Verified name',
        folderId: 'actual-folder',
        sortOrder: 42,
        workspaceId: 'workspace-1',
      }),
    ])
  })

  it('does not cancel canvas hydration when StrictMode replays panel effects', async () => {
    client.setQueryData(workflowKeys.list('workspace-1'), [{ id: 'verified' }])
    canvasHydration.enabled = true
    let resolveHydration!: (value: object) => void
    let hydrationSignal: AbortSignal | undefined
    canvasHydration.query.mockImplementation(({ signal }: { signal: AbortSignal }) => {
      hydrationSignal = signal
      return new Promise((resolve) => {
        resolveHydration = resolve
      })
    })
    await act(async () => {
      root.render(
        <StrictMode>
          <QueryClientProvider client={client}>
            <ResourceContent
              workspaceId='workspace-1'
              desktopScopeId='chat:chat-1'
              resource={{ type: 'workflow', id: 'verified', title: 'Verified workflow' }}
            />
          </QueryClientProvider>
        </StrictMode>
      )
    })
    expect(canvasHydration.failed).not.toHaveBeenCalled()
    expect(hydrationSignal?.aborted).toBe(false)
    await act(async () => {
      resolveHydration({ id: 'verified' })
    })
    expect(canvasHydration.failed).not.toHaveBeenCalled()
    expect(container.textContent).toContain('Verified workflow canvas')
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

  it.each(['workspace', 'mothership'] as const)(
    'opens a saved chat-upload resource ID read-only from %s storage',
    async (storageContext) => {
      const file: WorkspaceFileRecord = {
        id: 'upload-1',
        workspaceId: 'workspace-1',
        name: 'image.png',
        key: 'uploaded-image',
        path: '/uploads/image.png',
        type: 'image/png',
        size: 5,
        uploadedBy: 'user-1',
        uploadedAt: new Date(),
        vfsNamespace: 'uploads',
        storageContext,
      }
      detail.mockReturnValue({ data: file })
      const resource: MothershipResource = { type: 'file', id: file.id, title: file.name }
      act(() =>
        root.render(
          <>
            <ResourceActions workspaceId='workspace-1' resource={resource} />
            <ResourceContent
              workspaceId='workspace-1'
              desktopScopeId='chat:chat-1'
              resource={resource}
            />
          </>
        )
      )
      expect(detail).toHaveBeenCalledWith('workspace-1', 'upload-1', { enabled: true })
      expect(files).toEqual([])
      const props = viewer.mock.calls.at(-1)![0] as MockFileViewerProps
      expect(props).toMatchObject({ file, readOnly: true, canEdit: false, collaborative: false })
      expect(props.contentSource?.buildUrl(file.key, { preview: true })).toBe(
        `/api/files/serve/uploaded-image?context=${storageContext}&preview=1`
      )
      expect(container.querySelector('[aria-label="Open in files"]')).toBeNull()
      await act(async () =>
        container.querySelector<HTMLButtonElement>('[aria-label="Download file"]')!.click()
      )
      expect(download).toHaveBeenCalledWith(file, undefined)
    }
  )

  it('shares the mounted streaming viewer with its download action and releases it on resource switch', async () => {
    const file: WorkspaceFileRecord = {
      id: 'file-1',
      workspaceId: 'workspace-1',
      name: 'document.md',
      key: 'stored',
      path: '/document.md',
      type: 'text/markdown',
      size: 4,
      uploadedBy: 'user-1',
      uploadedAt: new Date('2026-01-01T00:00:00Z'),
    }
    files.push(file)
    const resource: MothershipResource = { type: 'file', id: file.id, title: file.name }
    const downloadSourceRef = { current: null as FileDownloadSource | null }
    const preview: FilePreviewSession = {
      schemaVersion: 1,
      id: 'preview-1',
      streamId: 'stream-1',
      toolCallId: 'tool-1',
      status: 'streaming',
      fileName: file.name,
      fileId: file.id,
      operation: 'append',
      previewText: 'visible streamed frame',
      previewVersion: 1,
      updatedAt: '2026-01-01T00:00:00Z',
    }
    const renderFile = (previewSession: FilePreviewSession) =>
      act(() =>
        root.render(
          <>
            <ResourceActions
              workspaceId={file.workspaceId}
              resource={resource}
              downloadSourceRef={downloadSourceRef}
            />
            <ResourceContent
              workspaceId={file.workspaceId}
              desktopScopeId='chat:chat-1'
              resource={resource}
              previewSession={previewSession}
              isAgentResponding
              downloadSourceRef={downloadSourceRef}
            />
          </>
        )
      )
    renderFile(preview)
    const firstSource = downloadSourceRef.current
    expect(firstSource?.getContent()).toBe('visible streamed frame')
    await act(async () =>
      container.querySelector<HTMLButtonElement>('[aria-label="Download file"]')!.click()
    )
    expect(download).toHaveBeenLastCalledWith(file, firstSource)
    renderFile({ ...preview, previewText: 'newer streamed frame', previewVersion: 2 })
    expect(downloadSourceRef.current?.getContent()).toBe('newer streamed frame')
    await act(async () =>
      container.querySelector<HTMLButtonElement>('[aria-label="Download file"]')!.click()
    )
    expect(download).toHaveBeenLastCalledWith(file, downloadSourceRef.current)
    render({ type: 'table', id: 'table-1', title: 'Table' })
    expect(downloadSourceRef.current).toBeNull()
  })
})
