'use client'

import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Music } from '@sim/emcn/icons'
import dynamic from 'next/dynamic'
import type { FileDownloadSource } from '@/lib/uploads/client/download'
import type { WorkspaceFileRecord } from '@/lib/uploads/contexts/workspace'
import { resolveMediaMimeType } from '@/lib/uploads/utils/file-utils'
import {
  useWorkspaceFileBinary,
  useWorkspaceFileContent,
  useWorkspaceImageDimensionsAdapter,
} from '@/hooks/queries/workspace-files'
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
  UnsupportedPreview,
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
  downloadSourceRef?: React.MutableRefObject<FileDownloadSource | null>
  discardRef?: React.MutableRefObject<(() => void) | null>
  streamingContent?: string
  isAgentEditing?: boolean
  streamIsIncremental?: boolean
  streamOperation?: string
  disableStreamingAutoScroll?: boolean
  previewContextKey?: string
  /**
   * Opt this surface into live collaborative editing (markdown files only). Set by the
   * Files page; the agent/Chat surface leaves it off so collaboration and agent-streaming
   * never target one editor. See {@link RichMarkdownEditorProps.collaborative}.
   */
  collaborative?: boolean
  /**
   * Called (debounced) with the markdown document's leading-heading text while the file is still
   * untitled, so the caller can name the file after it. Only wired for the editable markdown editor.
   */
  onDeriveTitleFromHeading?: (headingText: string) => void
  /**
   * Let an open markdown file claim Cmd/Ctrl+F for find-in-document. Set wherever the file is the
   * whole pane the user is reading — the Files page, the mothership file view, the public share
   * page. Left off for the streaming-file preview, which is a pane beside a conversation that owns
   * its own find. See {@link RichMarkdownEditorProps.enableFind}.
   */
  enableFind?: boolean
}

export function FileViewer(props: FileViewerProps) {
  const { contentSource, workspaceId } = props
  // A caller-supplied contentSource means the adapter is unused (and its `workspaceId` may be a share token).
  const imageDimensions = useWorkspaceImageDimensionsAdapter(workspaceId, {
    enabled: !contentSource,
  })
  const source = useMemo(
    () => contentSource ?? createWorkspaceFileContentSource(workspaceId, imageDimensions),
    [contentSource, workspaceId, imageDimensions]
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
  downloadSourceRef,
  discardRef,
  streamingContent,
  isAgentEditing,
  streamIsIncremental,
  streamOperation,
  disableStreamingAutoScroll = false,
  previewContextKey,
  collaborative,
  onDeriveTitleFromHeading,
  enableFind = false,
}: FileViewerProps) {
  const category = resolveFileCategory(file.type, file.name)

  if (category === 'text-editable') {
    if (readOnly) {
      // ReadOnlyTextPreview loads the whole file as text; a large CSV would OOM the
      // browser. CsvTablePreview's streamed fallback is workspace-only, so on the
      // read-only public path a large CSV is download-only.
      if (isCsvStreamOnly(file)) {
        return <UnsupportedPreview name={file.name} />
      }
      // Markdown renders through the inline rich editor (non-editable) so the public share
      // surface matches the in-app reading experience; canEdit={false} disables autosave,
      // the bubble menu, and every other editing affordance.
      if (isMarkdownFile(file)) {
        return (
          <RichMarkdownEditor
            key={file.id}
            file={file}
            workspaceId={workspaceId}
            canEdit={false}
            enableFind={enableFind}
          />
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
          downloadSourceRef={downloadSourceRef}
          discardRef={discardRef}
          streamingContent={streamingContent}
          isAgentEditing={isAgentEditing}
          streamIsIncremental={streamIsIncremental}
          streamOperation={streamOperation}
          disableStreamingAutoScroll={disableStreamingAutoScroll}
          previewContextKey={previewContextKey}
          collaborative={collaborative}
          onDeriveTitleFromHeading={onDeriveTitleFromHeading}
          enableFind={enableFind}
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

  return <UnsupportedPreview name={file.name} />
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
  const {
    data: content,
    isLoading,
    error,
  } = useWorkspaceFileContent(workspaceId, file.id, file.key)

  const resolvedError = resolvePreviewError((error as Error | null) ?? null, null)
  if (resolvedError) return <PreviewError label='file' error={resolvedError} />
  if (isLoading || content == null)
    return <PreviewLoadingFrame className='min-h-0 flex-1' tone='surface' />

  if (resolvePreviewType(file.type, file.name)) {
    return (
      <div className='flex min-h-0 w-full flex-1 flex-col overflow-auto'>
        <PreviewPanel
          content={content}
          mimeType={file.type}
          filename={file.name}
          workspaceId={workspaceId}
          fileId={file.id}
          fileKey={file.key}
          readOnly
        />
      </div>
    )
  }

  return (
    <div className='min-h-0 w-full flex-1 overflow-auto bg-[var(--surface-1)] p-4'>
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

  const mediaType = resolveMediaMimeType(file.type, file.name, kind)

  useEffect(() => {
    if (!fileData) return
    replaceBlobUrl(URL.createObjectURL(new Blob([fileData], { type: mediaType })))
  }, [fileData, mediaType, replaceBlobUrl])

  const error = blobUrl !== null ? null : resolvePreviewError(fetchError, null)
  if (error) return <PreviewError label={kind} error={error} />

  if (isLoading && !blobUrl) {
    return <PreviewLoadingFrame className='h-full' tone='surface' />
  }

  if (kind === 'audio') {
    return (
      <div className='flex h-full flex-col items-center justify-center gap-4 bg-[var(--surface-1)] p-8'>
        <div className='flex flex-col items-center gap-2 text-center'>
          <Music className='size-[32px] text-[var(--text-muted)]' />
          <p className='text-[14px] text-[var(--text-primary)]'>{file.name}</p>
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
