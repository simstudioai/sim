'use client'

import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createLogger } from '@sim/logger'
import { toError } from '@sim/utils/errors'
import dynamic from 'next/dynamic'
import { Skeleton } from '@/components/emcn'
import type { WorkspaceFileRecord } from '@/lib/uploads/contexts/workspace'
import { getFileExtension } from '@/lib/uploads/utils/file-utils'
import { useWorkspaceFileBinary } from '@/hooks/queries/workspace-files'
import { resolveFileCategory } from './file-category'
import type { StreamingMode } from './text-editor-state'

export type { StreamingMode } from './text-editor-state'

import { DocxPreview } from './docx-preview'
import { ImagePreview } from './image-preview'
import type { PdfDocumentSource } from './pdf-viewer'
import { PptxPreview } from './pptx-preview'
import { resolvePreviewType } from './preview-panel'
import {
  PDF_PAGE_SKELETON,
  PreviewError,
  resolvePreviewError,
  shouldSuppressStreamingDocumentError,
} from './preview-shared'
import { TextEditor } from './text-editor'
import { XlsxPreview } from './xlsx-preview'

const PdfViewerCore = dynamic(() => import('./pdf-viewer').then((m) => m.PdfViewerCore), {
  ssr: false,
})

const logger = createLogger('FileViewer')

export function isTextEditable(file: { type: string; name: string }): boolean {
  return resolveFileCategory(file.type, file.name) === 'text-editable'
}

export function isPreviewable(file: { type: string; name: string }): boolean {
  return resolvePreviewType(file.type, file.name) !== null
}

export type PreviewMode = 'editor' | 'split' | 'preview'

interface FileViewerProps {
  file: WorkspaceFileRecord
  workspaceId: string
  canEdit: boolean
  previewMode?: PreviewMode
  autoFocus?: boolean
  onDirtyChange?: (isDirty: boolean) => void
  onSaveStatusChange?: (status: 'idle' | 'saving' | 'saved' | 'error') => void
  saveRef?: React.MutableRefObject<(() => Promise<void>) | null>
  streamingContent?: string
  streamingMode?: StreamingMode
  disableStreamingAutoScroll?: boolean
  previewContextKey?: string
}

export function FileViewer({
  file,
  workspaceId,
  canEdit,
  previewMode,
  autoFocus,
  onDirtyChange,
  onSaveStatusChange,
  saveRef,
  streamingContent,
  streamingMode,
  disableStreamingAutoScroll = false,
  previewContextKey,
}: FileViewerProps) {
  const category = resolveFileCategory(file.type, file.name)

  if (category === 'text-editable') {
    return (
      <TextEditor
        file={file}
        workspaceId={workspaceId}
        canEdit={canEdit}
        previewMode={previewMode ?? 'editor'}
        autoFocus={autoFocus}
        onDirtyChange={onDirtyChange}
        onSaveStatusChange={onSaveStatusChange}
        saveRef={saveRef}
        streamingContent={streamingContent}
        streamingMode={streamingMode}
        disableStreamingAutoScroll={disableStreamingAutoScroll}
        previewContextKey={previewContextKey}
      />
    )
  }

  if (category === 'iframe-previewable') {
    return (
      <IframePreview
        key={file.id}
        file={file}
        workspaceId={workspaceId}
        streamingContent={streamingContent}
      />
    )
  }

  if (category === 'image-previewable') {
    return <ImagePreview key={file.key} file={file} />
  }

  if (category === 'audio-previewable') {
    return <AudioPreview key={file.id} file={file} workspaceId={workspaceId} />
  }

  if (category === 'video-previewable') {
    return <VideoPreview key={file.id} file={file} workspaceId={workspaceId} />
  }

  if (category === 'docx-previewable') {
    return (
      <DocxPreview
        key={file.id}
        file={file}
        workspaceId={workspaceId}
        streamingContent={streamingContent}
      />
    )
  }

  if (category === 'pptx-previewable') {
    return <PptxPreview file={file} workspaceId={workspaceId} streamingContent={streamingContent} />
  }

  if (category === 'xlsx-previewable') {
    return (
      <XlsxPreview
        file={file}
        workspaceId={workspaceId}
        canEdit={canEdit}
        onSaveStatusChange={onSaveStatusChange}
        saveRef={saveRef}
      />
    )
  }

  return <UnsupportedPreview file={file} />
}

const IframePreview = memo(function IframePreview({
  file,
  workspaceId,
  streamingContent,
}: {
  file: WorkspaceFileRecord
  workspaceId: string
  streamingContent?: string
}) {
  const [streamingBuffer, setStreamingBuffer] = useState<ArrayBuffer | null>(null)
  const streamingBufferRef = useRef<ArrayBuffer | null>(null)
  const streamingBufferSeqRef = useRef(0)
  const [streamingBufferSeq, setStreamingBufferSeq] = useState(0)
  const [rendering, setRendering] = useState(false)
  const [renderError, setRenderError] = useState<string | null>(null)

  useEffect(() => {
    if (streamingContent === undefined) return

    let cancelled = false
    const controller = new AbortController()

    const debounceTimer = setTimeout(async () => {
      if (cancelled) return

      try {
        setRendering(true)
        setRenderError(null)

        const response = await fetch(`/api/workspaces/${workspaceId}/pdf/preview`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ code: streamingContent }),
          signal: controller.signal,
        })
        if (!response.ok) {
          const err = await response.json().catch(() => ({ error: 'Preview failed' }))
          throw new Error(err.error || 'Preview failed')
        }

        const buf = await response.arrayBuffer()
        if (cancelled) return

        streamingBufferRef.current = buf
        streamingBufferSeqRef.current += 1
        setStreamingBuffer(buf)
        setStreamingBufferSeq(streamingBufferSeqRef.current)
      } catch (err) {
        if (!cancelled && !(err instanceof DOMException && err.name === 'AbortError')) {
          const msg = toError(err).message || 'Failed to render PDF'
          if (streamingBufferRef.current || shouldSuppressStreamingDocumentError(msg)) {
            logger.info('Suppressing transient PDF streaming preview error', { error: msg })
          } else {
            logger.error('PDF render failed', { error: msg })
            setRenderError(msg)
          }
        }
      } finally {
        if (!cancelled) setRendering(false)
      }
    }, 500)

    return () => {
      cancelled = true
      clearTimeout(debounceTimer)
      controller.abort()
    }
  }, [streamingContent, workspaceId])

  const staticSource = useMemo<PdfDocumentSource>(
    () => ({
      kind: 'url',
      url: `/api/files/serve/${encodeURIComponent(file.key)}?context=workspace`,
    }),
    [file.key]
  )

  const streamingSource = useMemo<PdfDocumentSource | null>(
    () => (streamingBuffer ? { kind: 'buffer', buffer: streamingBuffer } : null),
    [streamingBuffer]
  )

  if (renderError) return <PreviewError label='PDF' error={renderError} />

  if (streamingContent !== undefined) {
    if (!streamingSource) {
      return <div className='relative flex flex-1 overflow-hidden'>{PDF_PAGE_SKELETON}</div>
    }
    return <PdfViewerCore key={streamingBufferSeq} source={streamingSource} filename={file.name} />
  }

  return <PdfViewerCore source={staticSource} filename={file.name} />
})

function useBlobUrl(workspaceId: string, fileId: string, fileKey: string) {
  const { data: fileData, isLoading, error } = useWorkspaceFileBinary(workspaceId, fileId, fileKey)
  const [blobUrl, setBlobUrl] = useState<string | null>(null)
  const blobUrlRef = useRef<string | null>(null)

  const replaceBlobUrl = useCallback((nextUrl: string | null) => {
    const previousUrl = blobUrlRef.current
    blobUrlRef.current = nextUrl
    setBlobUrl(nextUrl)
    if (previousUrl && previousUrl !== nextUrl) URL.revokeObjectURL(previousUrl)
  }, [])

  useEffect(() => {
    return () => {
      if (blobUrlRef.current) {
        URL.revokeObjectURL(blobUrlRef.current)
        blobUrlRef.current = null
      }
    }
  }, [])

  return { fileData, isLoading, error, blobUrl, replaceBlobUrl }
}

const AudioPreview = memo(function AudioPreview({
  file,
  workspaceId,
}: {
  file: WorkspaceFileRecord
  workspaceId: string
}) {
  const {
    fileData,
    isLoading,
    error: fetchError,
    blobUrl,
    replaceBlobUrl,
  } = useBlobUrl(workspaceId, file.id, file.key)

  useEffect(() => {
    if (!fileData) return
    replaceBlobUrl(URL.createObjectURL(new Blob([fileData], { type: file.type || 'audio/mpeg' })))
  }, [file.type, fileData, replaceBlobUrl])

  const error = blobUrl !== null ? null : resolvePreviewError(fetchError, null)
  if (error) return <PreviewError label='audio' error={error} />

  if (isLoading && !blobUrl) {
    return (
      <div className='flex h-full flex-col items-center justify-center gap-4 bg-[var(--surface-1)] p-8'>
        <Skeleton className='h-[40px] w-[40px] rounded-full' />
        <Skeleton className='h-[14px] w-[160px]' />
        <Skeleton className='h-[40px] w-full max-w-[480px] rounded-lg' />
      </div>
    )
  }

  return (
    <div className='flex h-full flex-col items-center justify-center gap-4 bg-[var(--surface-1)] p-8'>
      <div className='flex flex-col items-center gap-2 text-center'>
        <div className='text-[32px]'>🎵</div>
        <p className='font-medium text-[14px] text-[var(--text-primary)]'>{file.name}</p>
      </div>
      {blobUrl && (
        // biome-ignore lint/a11y/useMediaCaption: audio from workspace files
        <audio src={blobUrl} controls className='w-full max-w-[480px]' />
      )}
    </div>
  )
})

const VideoPreview = memo(function VideoPreview({
  file,
  workspaceId,
}: {
  file: WorkspaceFileRecord
  workspaceId: string
}) {
  const {
    fileData,
    isLoading,
    error: fetchError,
    blobUrl,
    replaceBlobUrl,
  } = useBlobUrl(workspaceId, file.id, file.key)

  useEffect(() => {
    if (!fileData) return
    replaceBlobUrl(URL.createObjectURL(new Blob([fileData], { type: file.type || 'video/mp4' })))
  }, [file.type, fileData, replaceBlobUrl])

  const error = blobUrl !== null ? null : resolvePreviewError(fetchError, null)
  if (error) return <PreviewError label='video' error={error} />

  if (isLoading && !blobUrl) {
    return (
      <div className='flex h-full items-center justify-center bg-[var(--surface-1)] p-8'>
        <Skeleton className='w-full max-w-[720px]' style={{ aspectRatio: '16 / 9' }} />
      </div>
    )
  }

  return (
    <div className='flex h-full items-center justify-center bg-[var(--surface-1)]'>
      {blobUrl && (
        // biome-ignore lint/a11y/useMediaCaption: video from workspace files
        <video src={blobUrl} controls className='max-h-full max-w-full' />
      )}
    </div>
  )
})

const UnsupportedPreview = memo(function UnsupportedPreview({
  file,
}: {
  file: WorkspaceFileRecord
}) {
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
})
