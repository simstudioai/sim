'use client'

import { type ComponentProps, useCallback, useEffect, useState } from 'react'
import { Columns2, Eye, Pencil, toast } from '@sim/emcn'
import { getErrorMessage } from '@sim/utils/errors'
import { SIM_PAGE_CONTENT_TYPE } from '@/lib/workspace-files/page-compile'
import type { ResourceAction } from '@/app/workspace/[workspaceId]/components/resource/components/resource-header'
import { Resource } from '@/app/workspace/[workspaceId]/components/resource/resource'
import { useFileNavigation } from '@/app/workspace/[workspaceId]/files/components/file-detail/navigation'
import {
  FileViewer,
  isCsvStreamOnly,
  isMarkdownFile,
  isPreviewable,
  isTextEditable,
  type PreviewMode,
} from '@/app/workspace/[workspaceId]/files/components/file-viewer'
import { FileDocAvatars } from '@/app/workspace/[workspaceId]/files/components/file-viewer/rich-markdown-editor/collaboration/file-doc-avatars'
import { FileDocRoomProvider } from '@/app/workspace/[workspaceId]/files/components/file-viewer/rich-markdown-editor/collaboration/file-doc-room-context'

interface FileDetailProps {
  viewer: ComponentProps<typeof FileViewer>
  header: Omit<ComponentProps<typeof Resource.Header>, 'aside'>
  showSaveAction?: boolean
}

/** Shared editor chrome; owner-specific queries and commands remain in their browser adapters. */
export function FileDetail({ viewer, header, showSaveAction = false }: FileDetailProps) {
  const owner = viewer.owner ?? { entityType: 'workspace' as const, entityId: viewer.workspaceId }
  const navigation = useFileNavigation(owner)
  const [previewMode, setPreviewMode] = useState<PreviewMode>(() =>
    !viewer.autoFocus && isPreviewable(viewer.file) ? 'preview' : 'editor'
  )
  const { save, setSaveStatus } = navigation
  const handleSave = useCallback(() => {
    void save().catch((error) => toast.error(getErrorMessage(error, 'Unable to save this file')))
  }, [save])
  const handleSaveStatusChange = useCallback(
    (status: 'idle' | 'saving' | 'saved' | 'error', retry?: () => Promise<void>) => {
      setSaveStatus(status)
      if (status === 'error') {
        toast.error(`Failed to save "${viewer.file.name}"`, {
          action: {
            label: 'Retry',
            onClick: () =>
              void retry?.().catch((error) =>
                toast.error(getErrorMessage(error, 'Unable to save this file'))
              ),
          },
        })
      }
    },
    [setSaveStatus, viewer.file.name]
  )

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key === 's') {
        event.preventDefault()
        handleSave()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [handleSave])

  if (navigation.fileId !== viewer.file.id)
    throw new Error('File detail does not match its navigation scope')

  const streamOnly = isCsvStreamOnly(viewer.file)
  const canPreview =
    isPreviewable(viewer.file) &&
    !streamOnly &&
    !isMarkdownFile(viewer.file) &&
    viewer.file.type !== SIM_PAGE_CONTENT_TYPE
  const hasSplitView = canPreview && isTextEditable(viewer.file)
  const actions: ResourceAction[] = [
    ...(canPreview
      ? [
          {
            text: hasSplitView
              ? previewMode === 'editor'
                ? 'Split'
                : previewMode === 'split'
                  ? 'Preview'
                  : 'Edit'
              : previewMode === 'preview'
                ? 'Edit'
                : 'Preview',
            icon:
              hasSplitView && previewMode === 'editor'
                ? Columns2
                : previewMode === 'preview'
                  ? Pencil
                  : Eye,
            onSelect: () =>
              setPreviewMode((current) =>
                hasSplitView
                  ? current === 'editor'
                    ? 'split'
                    : current === 'split'
                      ? 'preview'
                      : 'editor'
                  : current === 'preview'
                    ? 'editor'
                    : 'preview'
              ),
          },
        ]
      : []),
    ...(showSaveAction && viewer.canEdit && isTextEditable(viewer.file) && !streamOnly
      ? [
          {
            id: 'save',
            text: 'Save',
            disabled: !navigation.isDirty || navigation.saveStatus === 'saving',
            onSelect: handleSave,
          },
        ]
      : []),
    ...(header.actions ?? []),
  ]
  return (
    <FileDocRoomProvider>
      <Resource>
        <Resource.Header {...header} actions={actions} aside={<FileDocAvatars />} />
        <FileViewer
          {...viewer}
          previewMode={previewMode}
          onDirtyChange={navigation.setIsDirty}
          onSaveStatusChange={handleSaveStatusChange}
          saveRef={navigation.saveRef}
          downloadSourceRef={navigation.downloadSourceRef}
          discardRef={navigation.discardRef}
        />
      </Resource>
    </FileDocRoomProvider>
  )
}
