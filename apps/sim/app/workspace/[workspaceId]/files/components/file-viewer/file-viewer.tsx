'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { createLogger } from '@sim/logger'
import { Skeleton } from '@/components/emcn'
import type { WorkspaceFileRecord } from '@/lib/uploads/contexts/workspace'
import { getFileExtension } from '@/lib/uploads/utils/file-utils'
import {
  useUpdateWorkspaceFileContent,
  useWorkspaceFileContent,
} from '@/hooks/queries/workspace-files'

const logger = createLogger('FileViewer')

export const TEXT_EDITABLE_EXTENSIONS = new Set(['md', 'txt', 'json', 'yaml', 'yml', 'csv', 'html', 'htm'])

const IFRAME_PREVIEWABLE_EXTENSIONS = new Set(['pdf'])

interface FileViewerProps {
  file: WorkspaceFileRecord
  workspaceId: string
  canEdit: boolean
  onDirtyChange?: (isDirty: boolean) => void
  saveRef?: React.MutableRefObject<(() => Promise<void>) | null>
}

export function FileViewer({
  file,
  workspaceId,
  canEdit,
  onDirtyChange,
  saveRef,
}: FileViewerProps) {
  const ext = getFileExtension(file.name)
  const isTextEditable = TEXT_EDITABLE_EXTENSIONS.has(ext)
  const isIframePreviewable = IFRAME_PREVIEWABLE_EXTENSIONS.has(ext)

  if (isTextEditable) {
    return (
      <TextEditor
        file={file}
        workspaceId={workspaceId}
        canEdit={canEdit}
        onDirtyChange={onDirtyChange}
        saveRef={saveRef}
      />
    )
  }

  if (isIframePreviewable) {
    return <IframePreview file={file} />
  }

  return <UnsupportedPreview file={file} />
}

interface TextEditorProps {
  file: WorkspaceFileRecord
  workspaceId: string
  canEdit: boolean
  onDirtyChange?: (isDirty: boolean) => void
  saveRef?: React.MutableRefObject<(() => Promise<void>) | null>
}

function TextEditor({ file, workspaceId, canEdit, onDirtyChange, saveRef }: TextEditorProps) {
  const initializedRef = useRef(false)
  const contentRef = useRef('')

  const {
    data: fetchedContent,
    isLoading,
    error,
  } = useWorkspaceFileContent(workspaceId, file.id, file.key)

  const updateContent = useUpdateWorkspaceFileContent()

  const [content, setContent] = useState('')
  const [savedContent, setSavedContent] = useState('')

  useEffect(() => {
    if (fetchedContent !== undefined && !initializedRef.current) {
      setContent(fetchedContent)
      setSavedContent(fetchedContent)
      contentRef.current = fetchedContent
      initializedRef.current = true
    }
  }, [fetchedContent])

  const handleContentChange = useCallback((value: string) => {
    setContent(value)
    contentRef.current = value
  }, [])

  const isDirty = initializedRef.current && content !== savedContent

  useEffect(() => {
    onDirtyChange?.(isDirty)
  }, [isDirty, onDirtyChange])

  const handleSave = useCallback(async () => {
    const currentContent = contentRef.current
    if (currentContent === savedContent) return

    await updateContent.mutateAsync({
      workspaceId,
      fileId: file.id,
      content: currentContent,
    })
    setSavedContent(currentContent)
  }, [savedContent, workspaceId, file.id, updateContent])

  useEffect(() => {
    if (saveRef) {
      saveRef.current = handleSave
    }
    return () => {
      if (saveRef) {
        saveRef.current = null
      }
    }
  }, [saveRef, handleSave])

  if (isLoading) {
    return (
      <div className='flex flex-1 flex-col gap-[8px] p-[24px]'>
        <Skeleton className='h-[16px] w-[60%]' />
        <Skeleton className='h-[16px] w-[80%]' />
        <Skeleton className='h-[16px] w-[40%]' />
        <Skeleton className='h-[16px] w-[70%]' />
      </div>
    )
  }

  if (error) {
    return (
      <div className='flex flex-1 items-center justify-center'>
        <p className='text-[13px] text-[var(--text-muted)]'>Failed to load file content</p>
      </div>
    )
  }

  return (
    <div className='flex flex-1 overflow-hidden'>
      <textarea
        value={content}
        onChange={(e) => handleContentChange(e.target.value)}
        readOnly={!canEdit}
        spellCheck={false}
        className='h-full w-full resize-none border-0 bg-transparent p-[24px] font-mono text-[13px] text-[var(--text-body)] outline-none placeholder:text-[var(--text-subtle)]'
      />
    </div>
  )
}

function IframePreview({ file }: { file: WorkspaceFileRecord }) {
  const serveUrl = `/api/files/serve/${encodeURIComponent(file.key)}?context=workspace`

  return (
    <div className='flex flex-1 overflow-hidden'>
      <iframe
        src={serveUrl}
        className='h-full w-full border-0'
        title={file.name}
        onError={() => {
          logger.error(`Failed to load file: ${file.name}`)
        }}
      />
    </div>
  )
}

function UnsupportedPreview({ file }: { file: WorkspaceFileRecord }) {
  const ext = getFileExtension(file.name)

  return (
    <div className='flex flex-1 flex-col items-center justify-center gap-[8px]'>
      <p className='font-medium text-[14px] text-[var(--text-body)]'>
        Preview not available for .{ext} files
      </p>
      <p className='text-[13px] text-[var(--text-muted)]'>
        Use the download button to view this file
      </p>
    </div>
  )
}
