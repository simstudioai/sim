'use client'

import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Music } from 'lucide-react'
import dynamic from 'next/dynamic'
import { useTranslations } from 'next-intl'
import type { WorkspaceFileRecord } from '@/lib/uploads/contexts/workspace'
import { getFileExtension } from '@/lib/uploads/utils/file-utils'
import { useWorkspaceFileBinary, useWorkspaceFileContent } from '@/hooks/queries/workspace-files'
import {
  createWorkspaceFileContentSource,
  type FileContentSource,
  FileContentSourceProvider,
} from '@/hooks/use-file-content-source'
import { CsvTablePreview } from './csv-table-preview'
import { DocxPreview } from './docx-preview'
import { resolveFileCategory } from './file-category'
import { ImagePreview } from './image-preview'
import type { PdfDocumentSource } from './pdf-viewer'
import { PptxPreview } from './pptx-preview'
import { PreviewPanel, resolvePreviewType } from './preview-panel'
import {
  PREVIEW_LOADING_OVERLAY,
  PreviewError,
  PreviewErrorBoundary,
  PreviewLoadingFrame,
  resolvePreviewError,
} from './preview-shared'
import { TextEditor } from './text-editor'
import { useDocPreviewBinary } from './use-doc-preview-binary'
import { XlsxPreview } from './xlsx-preview'

const PdfViewerCore = dynamic(() => import('./pdf-viewer').then((m) => m.PdfViewerCore), {
  ssr: false,
})

const RichMarkdownEditor = dynamic(
  () => import('./rich-markdown-editor/rich-markdown-editor').then((m) => m.RichMarkdownEditor),
  { ssr: false, loading: () => <PreviewLoadingFrame className='flex flex-1 flex-col' /> }
)

/**
 * CSVs at or below this size load fully into the editor (editable, with an inline preview).
 * Larger CSVs would OOM the browser on `response.text()`, so they render a read-only,
 * server-streamed preview of the first rows instead (see {@link CsvTablePreview}).
 */
const CSV_INLINE_EDIT_MAX_BYTES = 5 * 1024 * 1024

export function isTextEditable(file: { type: string; name: string }): boolean {
  return resolveFileCategory(file.type, file.name) === 'text-editable'
}

export function isPreviewable(file: { type: string; name: string }): boolean {
  return resolvePreviewType(file.type, file.name) !== null
}

/**
 * Markdown files render in the inline rich editor ({@link RichMarkdownEditor}) rather than
 * the raw Monaco editor. Toolbars use this to hide the raw/split/preview mode controls,
 * which don't apply to the single-surface editor.
 */
export function isMarkdownFile(file: { type: string; name: string }): boolean {
  return resolvePreviewType(file.type, file.name) === 'markdown'
}

/**
 * A CSV larger than {@link CSV_INLINE_EDIT_MAX_BYTES} is shown as a streamed, read-only preview —
 * the editor would OOM loading the whole file. The viewer renders {@link CsvTablePreview} for it,
 * and toolbars use this to hide the edit/split/save controls (there is no editor to switch to).
 */
export function isCsvStreamOnly(file: {
  type: string | null
  name: string
  size?: number | null
}): boolean {
  return (
    resolvePreviewType(file.type, file.name) === 'csv' &&
    (file.size ?? 0) > CSV_INLINE_EDIT_MAX_BYTES
  )
}

export type PreviewMode = 'editor' | 'split' | 'preview'

interface FileViewerProps {
  file: WorkspaceFileRecord
  workspaceId: string
  /**
   * Content source for this view. Defaults to a workspace-scoped source derived from `workspaceId`;
   * the public share page passes a token-scoped source. Provided to descendants (renderers, embedded
   * images) via {@link FileContentSourceProvider}.
   */
  contentSource?: FileContentSource
  canEdit: boolean
  /**
   * Render a read-only preview with no editing affordances. Text files render
   * through {@link PreviewPanel} (or a plain `<pre>`) instead of the editable
   * {@link TextEditor}. Used by the public share page.
   */
  readOnly?: boolean
  previewMode?: PreviewMode
  autoFocus?: boolean
  onDirtyChange?: (isDirty: boolean) => void
  onSaveStatusChange?: (
    status: 'idle' | 'saving' | 'saved' | 'error',
    retry?: () => Promise<void>
  ) => void
  saveRef?: React.MutableRefObject<(() => Promise<void>) | null>
  discardRef?: React.MutableRefObject<(() => void) | null>
  streamingContent?: string
  isAgentEditing?: boolean
  streamIsIncremental?: boolean
  disableStreamingAutoScroll?: boolean
  previewContextKey?: string
}

export function FileViewer(props: FileViewerProps) {
  const { contentSource, workspaceId } = props
  const source = useMemo(
    () => contentSource ?? createWorkspaceFileContentSource(workspaceId),
    [contentSource, workspaceId]
  )
  return (
    <FileContentSourceProvider value={source}>
      <FileViewerContent {...props} />
    </FileContentSourceProvider>
  )
}

function FileViewerContent({
  file,
  workspaceId,
  canEdit,
  readOnly = false,
  previewMode,
  autoFocus,
  onDirtyChange,
  onSaveStatusChange,
  saveRef,
  discardRef,
  streamingContent,
  isAgentEditing,
  streamIsIncremental,
  disableStreamingAutoScroll = false,
  previewContextKey,
}: FileViewerProps) {
  const category = resolveFileCategory(file.type, file.name)

  if (category === 'text-editable') {
    if (readOnly) {
      // ReadOnlyTextPreview loads the whole file as text; a large CSV would OOM the
      // browser. CsvTablePreview's streamed fallback is workspace-only, so on the
      // read-only public path a large CSV is download-only.
      if (isCsvStreamOnly(file)) {
        return <UnsupportedPreview file={file} />
      }
      // Markdown renders through the inline rich editor (non-editable) so the public share
      // surface matches the in-app reading experience; canEdit={false} disables autosave,
      // the bubble menu, and every other editing affordance.
      if (isMarkdownFile(file)) {
        return (
          <RichMarkdownEditor key={file.id} file={file} workspaceId={workspaceId} canEdit={false} />
        )
      }
      return <ReadOnlyTextPreview file={file} workspaceId={workspaceId} />
    }
    // A large CSV can't be loaded whole into the editor (the browser OOMs on the full text).
    // Render a streamed, read-only preview of the first rows + an "Import as a table" path instead.
    if (isCsvStreamOnly(file)) {
      return <CsvTablePreview key={file.id} file={file} workspaceId={workspaceId} />
    }

    if (isMarkdownFile(file)) {
      return (
        <RichMarkdownEditor
          key={file.id}
          file={file}
          workspaceId={workspaceId}
          canEdit={canEdit}
          autoFocus={autoFocus}
          onDirtyChange={onDirtyChange}
          onSaveStatusChange={onSaveStatusChange}
          saveRef={saveRef}
          discardRef={discardRef}
          streamingContent={streamingContent}
          isAgentEditing={isAgentEditing}
          streamIsIncremental={streamIsIncremental}
          disableStreamingAutoScroll={disableStreamingAutoScroll}
          previewContextKey={previewContextKey}
        />
      )
    }

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
        discardRef={discardRef}
        streamingContent={streamingContent}
        isAgentEditing={isAgentEditing}
        disableStreamingAutoScroll={disableStreamingAutoScroll}
        previewContextKey={previewContextKey}
      />
    )
  }

  if (category === 'iframe-previewable') {
    return <IframePreview key={file.id} file={file} workspaceId={workspaceId} />
  }

  if (category === 'image-previewable') {
    return <ImagePreview key={file.key} file={file} />
  }

  if (category === 'audio-previewable') {
    return <MediaPreview key={file.id} file={file} workspaceId={workspaceId} kind='audio' />
  }

  if (category === 'video-previewable') {
    return <MediaPreview key={file.id} file={file} workspaceId={workspaceId} kind='video' />
  }

  if (category === 'docx-previewable') {
    return <DocxPreview key={file.id} file={file} workspaceId={workspaceId} />
  }

  if (category === 'pptx-previewable') {
    return <PptxPreview key={file.id} file={file} workspaceId={workspaceId} />
  }

  if (category === 'xlsx-previewable') {
    return <XlsxPreview key={file.id} file={file} workspaceId={workspaceId} />
  }

  return <UnsupportedPreview file={file} />
}

/**
 * Read-only text/markdown/code preview. Renders rich types (markdown, csv, svg,
 * mermaid, html) through {@link PreviewPanel} and plain text/code in a `<pre>`.
 * Fetches content through the active content source, so it works for both
 * workspace files and public share links.
 */
const ReadOnlyTextPreview = memo(function ReadOnlyTextPreview({
  file,
  workspaceId,
}: {
  file: WorkspaceFileRecord
  workspaceId: string
}) {
  const t = useTranslations('auto')
  const {
    data: content,
    isLoading,
    error,
  } = useWorkspaceFileContent(workspaceId, file.id, file.key)

  const resolvedError = resolvePreviewError((error as Error | null) ?? null, null)
  if (resolvedError) return <PreviewError label={t('file')} error={resolvedError} />
  if (isLoading || content == null) return <PreviewLoadingFrame className='h-full' tone='surface' />

  if (resolvePreviewType(file.type, file.name)) {
    return (
      <div className='h-full min-h-0 w-full overflow-auto'>
        <PreviewPanel
          content={content}
          mimeType={file.type}
          filename={file.name}
          workspaceId={workspaceId}
          fileKey={file.key}
          readOnly
        />
      </div>
    )
  }

  return (
    <div className='h-full min-h-0 w-full overflow-auto bg-[var(--surface-1)] p-4'>
      <pre className='whitespace-pre-wrap break-words font-mono text-[13px] text-[var(--text-body)]'>
        {content}
      </pre>
    </div>
  )
})

const IframePreview = memo(function IframePreview({
  file,
  workspaceId,
}: {
  file: WorkspaceFileRecord
  workspaceId: string
}) {
  const preview = useDocPreviewBinary(workspaceId, file)

  const bufferSource = useMemo<PdfDocumentSource | null>(
    () => (preview.data ? { kind: 'buffer', buffer: preview.data } : null),
    [preview.data]
  )

  const error = resolvePreviewError(preview.error, null)
  if (error) return <PreviewError label='PDF' error={error} />

  if (!bufferSource) {
    return <div className='relative flex flex-1 overflow-hidden'>{PREVIEW_LOADING_OVERLAY}</div>
  }

  return (
    <PreviewErrorBoundary key={`${file.id}:${preview.dataUpdatedAt}`} label='PDF'>
      <PdfViewerCore source={bufferSource} filename={file.name} />
    </PreviewErrorBoundary>
  )
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

const MEDIA_FALLBACK_MIME = { audio: 'audio/mpeg', video: 'video/mp4' } as const

/**
 * Shared blob-backed preview for audio and video files — the fetch, blob-URL
 * lifecycle, and error/loading handling are identical; only the rendered
 * player differs.
 */
const MediaPreview = memo(function MediaPreview({
  file,
  workspaceId,
  kind,
}: {
  file: WorkspaceFileRecord
  workspaceId: string
  kind: 'audio' | 'video'
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
    replaceBlobUrl(
      URL.createObjectURL(new Blob([fileData], { type: file.type || MEDIA_FALLBACK_MIME[kind] }))
    )
  }, [file.type, fileData, kind, replaceBlobUrl])

  const error = blobUrl !== null ? null : resolvePreviewError(fetchError, null)
  if (error) return <PreviewError label={kind} error={error} />

  if (isLoading && !blobUrl) {
    return <PreviewLoadingFrame className='h-full' tone='surface' />
  }

  if (kind === 'audio') {
    return (
      <div className='flex h-full flex-col items-center justify-center gap-4 bg-[var(--surface-1)] p-8'>
        <div className='flex flex-col items-center gap-2 text-center'>
          <Music className='size-[32px] text-[var(--text-muted)]' strokeWidth={1.5} />
          <p className='font-medium text-[14px] text-[var(--text-primary)]'>{file.name}</p>
        </div>
        {blobUrl && (
          // biome-ignore lint/a11y/useMediaCaption: audio from workspace files
          <audio src={blobUrl} controls className='w-full max-w-[480px]' />
        )}
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
  const tI18n = useTranslations('auto')
  const t = useTranslations('auto')
  const ext = getFileExtension(file.name)

  return (
    <div className='flex flex-1 flex-col items-center justify-center gap-[8px]'>
      <p className='font-medium text-[14px] text-[var(--text-primary)]'>
        {t('preview_not_available')}
        {ext ? ` for .${ext} files` : tI18n('for_this_file')}
      </p>
      <p className='text-[13px] text-[var(--text-muted)]'>{t('use_the_download_button_to_view')}</p>
    </div>
  )
})
