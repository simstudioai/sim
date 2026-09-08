/**
 * @vitest-environment jsdom
 */
import { act, type ReactNode, useImperativeHandle } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { FilePreviewSession } from '@/lib/copilot/request/session'
import type { FileDownloadSource } from '@/lib/uploads/client/download'
import type { WorkspaceFileRecord } from '@/lib/uploads/contexts/workspace'

interface MockFileViewerProps {
  file: WorkspaceFileRecord
  workspaceId: string
  downloadSourceRef?: React.MutableRefObject<FileDownloadSource | null>
  streamingContent?: string
}

const { download, files } = vi.hoisted(() => ({
  download: vi.fn(),
  files: [] as WorkspaceFileRecord[],
}))

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }))
vi.mock('@/lib/uploads/client/download', () => ({ triggerFileDownload: download }))
vi.mock('@/hooks/queries/workspace-files', () => ({ useWorkspaceFiles: () => ({ data: files }) }))
vi.mock('@/app/workspace/[workspaceId]/providers/workspace-permissions-provider', () => ({
  useUserPermissionsContext: () => ({ canEdit: true }),
  useWorkspacePermissionsContext: () => ({ userPermissions: { canRead: true } }),
}))
vi.mock('@/app/workspace/[workspaceId]/files/components/file-viewer', () => ({
  resolveFileCategory: () => 'text-editable',
  FileViewer: ({ file, workspaceId, downloadSourceRef, streamingContent }: MockFileViewerProps) => {
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
import { useTableViewPinStore } from '@/stores/table/view-pin/store'

describe('ResourceContent handoff', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    useTableViewPinStore.getState().reset()
    vi.clearAllMocks()
    files.length = 0
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
