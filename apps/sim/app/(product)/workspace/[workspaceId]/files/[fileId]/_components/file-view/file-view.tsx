'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { type BreadcrumbItem, Breadcrumbs } from '@sim/emcn/breadcrumbs'
import { Button } from '@sim/emcn/button'
import { useClipboard } from '@sim/emcn/feedback/use-clipboard'
import { TextField } from '@sim/emcn/field'
import type { MenuAction } from '@sim/emcn/menu/action-menu'
import { Modal } from '@sim/emcn/modal'
import { ConfirmDialog } from '@sim/emcn/modal/confirm-dialog'
import { getErrorMessage } from '@sim/utils/errors'
import { useRouter } from 'next/navigation'
import { useQueryStates } from 'nuqs'
import { workspaceEntry, workspacePath } from '@/lib/navigation/paths'
import { toast } from '@/lib/toast/sink'
import { ControlBar } from '@/app/(product)/_components/control-bar/control-bar'
import {
  FileDocAvatars,
  FileDocRoomProvider,
} from '@/app/(product)/workspace/[workspaceId]/_components/file-viewer/collaboration/file-doc-room'
import {
  FileViewer,
  isCsvStreamOnly,
  isMarkdownFile,
  isPreviewable,
  isTextEditable,
} from '@/app/(product)/workspace/[workspaceId]/_components/file-viewer/file-viewer'
import type { PreviewMode } from '@/app/(product)/workspace/[workspaceId]/_components/file-viewer/types'
import {
  LiveWorkspacePage,
  WorkspaceEmpty,
} from '@/app/(product)/workspace/[workspaceId]/_components/workspace-page/workspace-page'
import { ShareModal } from '@/app/(product)/workspace/[workspaceId]/files/_components/share-modal/share-modal'
import {
  type FileDownloadSource,
  filesParsers,
  filesUrlKeys,
  type SaveStatus,
  SIM_PAGE_CONTENT_TYPE,
  triggerFileDownload,
  useDeleteWorkspaceFile,
  useDeriveFileTitle,
  useFileAccess,
  useRenameWorkspaceFile,
  useWorkspaceFileRecord,
  useWorkspaceFilesRoom,
  type WorkspaceFileRecord,
  workspaceFileRecordState,
} from '@/platform/lib/data/files'
import { useWorkspaceFileFolders } from '@/platform/lib/data/folders'
import { useSettingsUnsavedGuard } from '@/platform/lib/data/settings-guard'
import { folderChain } from '@/platform/lib/folder-chain'

interface FileViewProps {
  workspaceId: string
  fileId: string
}

/** The Files list, opened at a folder. */
function filesListHref(workspaceId: string, folderId: string | null | undefined) {
  const base = workspacePath(workspaceId, 'files')
  return folderId ? `${base}?folderId=${encodeURIComponent(folderId)}` : base
}

/** Edit → Split → Preview for a previewable text file, a two-way toggle otherwise. */
function nextModeAction(file: WorkspaceFileRecord, mode: PreviewMode) {
  const streamOnly = isCsvStreamOnly(file)
  const canEditText = isTextEditable(file) && !streamOnly
  const canPreview = isPreviewable(file) && !streamOnly
  const inlineMarkdown = isMarkdownFile(file)
  const simPage = file.type === SIM_PAGE_CONTENT_TYPE
  if (canEditText && canPreview && !inlineMarkdown && !simPage) {
    if (mode === 'editor') return { label: 'Split', icon: 'I038' as const, next: 'split' as const }
    if (mode === 'split')
      return { label: 'Preview', icon: 'eye' as const, next: 'preview' as const }
    return { label: 'Edit', icon: 'I036' as const, next: 'editor' as const }
  }
  if (canPreview && !inlineMarkdown && !simPage) {
    return mode === 'preview'
      ? { label: 'Edit', icon: 'I036' as const, next: 'editor' as const }
      : { label: 'Preview', icon: 'eye' as const, next: 'preview' as const }
  }
  return null
}

interface RenameFileModalProps {
  file: WorkspaceFileRecord
  workspaceId: string
  onClose: () => void
}

function RenameFileModal({ file, workspaceId, onClose }: RenameFileModalProps) {
  const [name, setName] = useState(file.name)
  const { mutateAsync: renameFile } = useRenameWorkspaceFile()
  const trimmed = name.trim()
  return (
    <Modal
      open
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
      title='Rename file'
      confirmLabel='Rename'
      confirmDisabled={!trimmed || trimmed === file.name}
      onConfirm={() => renameFile({ workspaceId, fileId: file.id, name: trimmed, quiet: true })}
    >
      <TextField label='Name' placeholder={file.name} value={name} onChange={setName} />
    </Modal>
  )
}

/**
 * A workspace file opened from Files: the file's viewer or editor fills the page beneath its
 * location trail, which also carries the file's commands; the mode toggle and page actions end
 * the control bar.
 */
export function FileView({ workspaceId, fileId }: FileViewProps) {
  const router = useRouter()
  const access = useFileAccess(workspaceId)
  // A `workspace-files-changed` broadcast refetches this file and its folder trail, as on the list.
  useWorkspaceFilesRoom(workspaceId)
  const record = useWorkspaceFileRecord(workspaceId, fileId)
  const recordState = workspaceFileRecordState(record)
  const file = record.data ?? null
  const [{ new: isNewFile, folderId: folderIdParam }, setFilesParams] = useQueryStates(
    filesParsers,
    filesUrlKeys
  )
  /** `?new=1` is read once: it opens the editor for a file just created, then leaves the URL. */
  const [composing] = useState(isNewFile)
  const { data: folders } = useWorkspaceFileFolders(workspaceId)
  const deriveTitle = useDeriveFileTitle(workspaceId)
  const deleteFile = useDeleteWorkspaceFile()
  const { copied: linkCopied, copy } = useClipboard()

  const saveRef = useRef<(() => Promise<void>) | null>(null)
  const discardRef = useRef<(() => void) | null>(null)
  const downloadSourceRef = useRef<FileDownloadSource | null>(null)
  const leavingRef = useRef(false)

  const [chosenMode, setChosenMode] = useState<PreviewMode | null>(null)
  const [isDirty, setIsDirty] = useState(false)
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('idle')
  const [dialog, setDialog] = useState<'rename' | 'share' | 'delete' | null>(null)

  const previewMode: PreviewMode =
    chosenMode ?? (!composing && file && isPreviewable(file) ? 'preview' : 'editor')

  useEffect(() => {
    if (isNewFile) void setFilesParams({ new: null }, { history: 'replace', scroll: false })
  }, [isNewFile, setFilesParams])

  useEffect(() => {
    if (access.hideFiles) router.replace(workspaceEntry(workspaceId))
  }, [access.hideFiles, router, workspaceId])

  /** An id naming no live file falls back to the list. */
  useEffect(() => {
    if (recordState === 'missing' && !leavingRef.current) {
      router.replace(filesListHref(workspaceId, folderIdParam))
    }
  }, [recordState, router, workspaceId, folderIdParam])

  useSettingsUnsavedGuard({
    isDirty,
    onDiscard: () => {
      discardRef.current?.()
      setIsDirty(false)
      setSaveStatus('idle')
    },
  })

  const saveStatusRef = useRef(saveStatus)
  saveStatusRef.current = saveStatus
  const isDirtyRef = useRef(isDirty)
  isDirtyRef.current = isDirty
  const save = useCallback(async () => {
    if (!saveRef.current || !isDirtyRef.current || saveStatusRef.current === 'saving') return
    await saveRef.current()
  }, [])

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key === 's') {
        event.preventDefault()
        void save()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [save])

  const fileName = file?.name
  const handleSaveStatusChange = useCallback(
    (status: SaveStatus, retry?: () => Promise<void>) => {
      setSaveStatus(status)
      if (status === 'error') {
        toast.error(`Failed to save "${fileName ?? 'file'}"`, {
          action: { label: 'Retry', onClick: () => void retry?.() },
        })
      }
    },
    [fileName]
  )

  const download = useCallback(async () => {
    if (!file) return
    try {
      await triggerFileDownload(file, downloadSourceRef.current)
    } catch (error) {
      toast.error(getErrorMessage(error, `Failed to download "${file.name}"`))
    }
  }, [file])

  const copyLink = useCallback(() => {
    void copy(`${window.location.origin}/workspace/${workspaceId}/files/${fileId}`)
  }, [copy, workspaceId, fileId])

  const folderById = useMemo(
    () => Object.fromEntries((folders ?? []).map((folder) => [folder.id, folder])),
    [folders]
  )

  const trail = useMemo((): BreadcrumbItem[] => {
    const commands: MenuAction[] = [
      { id: 'download', label: 'Download', icon: 'I049', onSelect: () => void download() },
      { id: 'copy-link', label: 'Copy link', icon: 'link', onSelect: copyLink },
      ...(access.canEdit
        ? [
            {
              id: 'rename',
              label: 'Rename',
              icon: 'I036' as const,
              onSelect: () => setDialog('rename'),
            },
            {
              id: 'share',
              label: 'Share',
              icon: 'I030' as const,
              onSelect: () => setDialog('share'),
            },
            {
              id: 'delete',
              label: 'Delete',
              destructive: true,
              separatorBefore: true,
              onSelect: () => setDialog('delete'),
            },
          ]
        : []),
    ]
    return [
      { id: 'files', label: 'Files', href: filesListHref(workspaceId, null) },
      ...folderChain(folderById, file?.folderId).map((folder) => ({
        id: folder.id,
        label: folder.name,
        href: filesListHref(workspaceId, folder.id),
      })),
      ...(file ? [{ id: file.id, label: file.name, actions: commands }] : []),
    ]
  }, [workspaceId, folderById, file, access.canEdit, download, copyLink])

  const modeAction = file ? nextModeAction(file, previewMode) : null

  const controls = (
    <ControlBar trail={<Breadcrumbs label='Location' items={trail} />}>
      {file && (
        <>
          <FileDocAvatars />
          {modeAction && (
            <Button
              variant='quiet'
              size='compact'
              icon={modeAction.icon}
              onClick={() => setChosenMode(modeAction.next)}
            >
              {modeAction.label}
            </Button>
          )}
          <Button
            variant='quiet'
            size='compact'
            icon={linkCopied ? 'I072' : 'link'}
            onClick={copyLink}
          >
            {linkCopied ? 'Copied' : 'Copy link'}
          </Button>
          <Button variant='quiet' size='compact' icon='I049' onClick={() => void download()}>
            Download
          </Button>
          {access.canEdit && (
            <>
              <Button variant='quiet' size='compact' onClick={() => setDialog('share')}>
                Share
              </Button>
              <Button
                variant='quiet'
                size='compact'
                destructive
                onClick={() => setDialog('delete')}
              >
                Delete
              </Button>
            </>
          )}
        </>
      )}
    </ControlBar>
  )

  return (
    <FileDocRoomProvider>
      <LiveWorkspacePage
        workspaceId={workspaceId}
        current='files'
        layout='fill'
        controls={controls}
        read={
          recordState === 'found' || recordState === 'failed'
            ? { status: 'ready' }
            : { status: 'pending' }
        }
      >
        {recordState === 'failed' && (
          <WorkspaceEmpty
            title='Could not load this file'
            description={getErrorMessage(record.error, 'Try again in a moment.')}
            action={{ label: 'Try again', onClick: () => void record.refetch() }}
          />
        )}
        {file && (
          <FileViewer
            key={file.id}
            file={file}
            workspaceId={workspaceId}
            canEdit={access.canEdit}
            previewMode={previewMode}
            autoFocus={composing}
            onDirtyChange={setIsDirty}
            onSaveStatusChange={handleSaveStatusChange}
            saveRef={saveRef}
            downloadSourceRef={downloadSourceRef}
            discardRef={discardRef}
            onDownload={() => void download()}
            collaborative
            onDeriveTitleFromHeading={deriveTitle}
            enableFind
          />
        )}
      </LiveWorkspacePage>
      {file && dialog === 'rename' && (
        <RenameFileModal file={file} workspaceId={workspaceId} onClose={() => setDialog(null)} />
      )}
      {file && (
        <ShareModal
          open={dialog === 'share'}
          onOpenChange={(open) => setDialog(open ? 'share' : null)}
          workspaceId={workspaceId}
          fileId={file.id}
          fileName={file.name}
          initialShare={file.share ?? null}
        />
      )}
      <ConfirmDialog
        target={dialog === 'delete' ? file : null}
        onClose={() => setDialog(null)}
        title='Delete file'
        description={(target) =>
          `Are you sure you want to delete ${target.name}? You can restore it from Recently Deleted in Settings.`
        }
        confirmLabel='Delete'
        pendingLabel='Deleting…'
        onConfirm={async (target) => {
          leavingRef.current = true
          try {
            await deleteFile.mutateAsync({ workspaceId, fileId: target.id })
          } catch (error) {
            leavingRef.current = false
            throw error
          }
          setIsDirty(false)
          router.push(filesListHref(workspaceId, target.folderId))
        }}
      />
    </FileDocRoomProvider>
  )
}
