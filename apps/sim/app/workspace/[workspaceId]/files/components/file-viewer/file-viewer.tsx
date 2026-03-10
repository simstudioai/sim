'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { createLogger } from '@sim/logger'
import { Skeleton } from '@/components/emcn'
import { cn } from '@/lib/core/utils/cn'
import type { WorkspaceFileRecord } from '@/lib/uploads/contexts/workspace'
import { getFileExtension } from '@/lib/uploads/utils/file-utils'
import {
  useUpdateWorkspaceFileContent,
  useWorkspaceFileContent,
} from '@/hooks/queries/workspace-files'
import { PreviewPanel, resolvePreviewType } from './preview-panel'

const logger = createLogger('FileViewer')

const SPLIT_MIN_PCT = 20
const SPLIT_MAX_PCT = 80
const SPLIT_DEFAULT_PCT = 50

const TEXT_EDITABLE_MIME_TYPES = new Set([
  'text/markdown',
  'text/plain',
  'application/json',
  'application/x-yaml',
  'text/csv',
  'text/html',
])

const TEXT_EDITABLE_EXTENSIONS = new Set(['md', 'txt', 'json', 'yaml', 'yml', 'csv', 'html', 'htm'])

const IFRAME_PREVIEWABLE_MIME_TYPES = new Set(['application/pdf'])
const IFRAME_PREVIEWABLE_EXTENSIONS = new Set(['pdf'])

type FileCategory = 'text-editable' | 'iframe-previewable' | 'unsupported'

function resolveFileCategory(mimeType: string | null, filename: string): FileCategory {
  if (mimeType && TEXT_EDITABLE_MIME_TYPES.has(mimeType)) return 'text-editable'
  if (mimeType && IFRAME_PREVIEWABLE_MIME_TYPES.has(mimeType)) return 'iframe-previewable'

  const ext = getFileExtension(filename)
  if (TEXT_EDITABLE_EXTENSIONS.has(ext)) return 'text-editable'
  if (IFRAME_PREVIEWABLE_EXTENSIONS.has(ext)) return 'iframe-previewable'

  return 'unsupported'
}

export function isTextEditable(file: { type: string; name: string }): boolean {
  return resolveFileCategory(file.type, file.name) === 'text-editable'
}

export function isPreviewable(file: { type: string; name: string }): boolean {
  return resolvePreviewType(file.type, file.name) !== null
}

interface FileViewerProps {
  file: WorkspaceFileRecord
  workspaceId: string
  canEdit: boolean
  showPreview?: boolean
  autoFocus?: boolean
  onDirtyChange?: (isDirty: boolean) => void
  saveRef?: React.MutableRefObject<(() => Promise<void>) | null>
}

export function FileViewer({
  file,
  workspaceId,
  canEdit,
  showPreview,
  autoFocus,
  onDirtyChange,
  saveRef,
}: FileViewerProps) {
  const category = resolveFileCategory(file.type, file.name)

  if (category === 'text-editable') {
    return (
      <TextEditor
        file={file}
        workspaceId={workspaceId}
        canEdit={canEdit}
        showPreview={showPreview}
        autoFocus={autoFocus}
        onDirtyChange={onDirtyChange}
        saveRef={saveRef}
      />
    )
  }

  if (category === 'iframe-previewable') {
    return <IframePreview file={file} />
  }

  return <UnsupportedPreview file={file} />
}

interface TextEditorProps {
  file: WorkspaceFileRecord
  workspaceId: string
  canEdit: boolean
  showPreview?: boolean
  autoFocus?: boolean
  onDirtyChange?: (isDirty: boolean) => void
  saveRef?: React.MutableRefObject<(() => Promise<void>) | null>
}

function TextEditor({
  file,
  workspaceId,
  canEdit,
  showPreview,
  autoFocus,
  onDirtyChange,
  saveRef,
}: TextEditorProps) {
  const initializedRef = useRef(false)
  const contentRef = useRef('')
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  const [splitPct, setSplitPct] = useState(SPLIT_DEFAULT_PCT)
  const [isResizing, setIsResizing] = useState(false)

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

      if (autoFocus) {
        requestAnimationFrame(() => textareaRef.current?.focus())
      }
    }
  }, [fetchedContent, autoFocus])

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
  }, [savedContent, workspaceId, file.id])

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

  useEffect(() => {
    if (!isResizing) return

    const handleMouseMove = (e: MouseEvent) => {
      const container = containerRef.current
      if (!container) return
      const rect = container.getBoundingClientRect()
      const pct = ((e.clientX - rect.left) / rect.width) * 100
      setSplitPct(Math.min(SPLIT_MAX_PCT, Math.max(SPLIT_MIN_PCT, pct)))
    }

    const handleMouseUp = () => setIsResizing(false)

    document.addEventListener('mousemove', handleMouseMove)
    document.addEventListener('mouseup', handleMouseUp)
    document.body.style.cursor = 'ew-resize'
    document.body.style.userSelect = 'none'

    return () => {
      document.removeEventListener('mousemove', handleMouseMove)
      document.removeEventListener('mouseup', handleMouseUp)
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
    }
  }, [isResizing])

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
    <div ref={containerRef} className='relative flex flex-1 overflow-hidden'>
      <textarea
        ref={textareaRef}
        value={content}
        onChange={(e) => handleContentChange(e.target.value)}
        readOnly={!canEdit}
        spellCheck={false}
        style={showPreview ? { width: `${splitPct}%`, flexShrink: 0 } : undefined}
        className={cn(
          'h-full resize-none border-0 bg-transparent p-[24px] font-mono text-[14px] text-[var(--text-body)] outline-none placeholder:text-[var(--text-subtle)]',
          !showPreview && 'w-full',
          isResizing && 'pointer-events-none'
        )}
      />
      {showPreview && (
        <>
          <div className='relative shrink-0'>
            <div className='h-full w-px bg-[var(--border)]' />
            <div
              className='-left-[3px] absolute top-0 z-10 h-full w-[6px] cursor-col-resize'
              onMouseDown={() => setIsResizing(true)}
              role='separator'
              aria-orientation='vertical'
              aria-label='Resize split'
            />
            {isResizing && (
              <div className='-translate-x-[0.5px] pointer-events-none absolute top-0 z-20 h-full w-[2px] bg-[var(--selection)]' />
            )}
          </div>
          <div
            className={cn('min-w-0 flex-1 overflow-hidden', isResizing && 'pointer-events-none')}
          >
            <PreviewPanel content={content} mimeType={file.type} filename={file.name} />
          </div>
        </>
      )}
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
        Preview not available{ext ? ` for .${ext} files` : ' for this file'}
      </p>
      <p className='text-[13px] text-[var(--text-muted)]'>
        Use the download button to view this file
      </p>
    </div>
  )
}
