'use client'

import { memo, type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Music } from '@sim/emcn/icons'
import dynamic from 'next/dynamic'
import type { FileDownloadSource } from '@/lib/uploads/client/download'
import {
  MAX_TEXT_PREVIEW_BYTES,
  TEXT_PREVIEW_SIZE_MESSAGE,
} from '@/lib/uploads/client/text-content'
import type { WorkspaceFileRecord } from '@/lib/uploads/contexts/workspace'
import { resolveMediaMimeType } from '@/lib/uploads/utils/file'
import {
  useReresolveFileRecord,
  useWorkspaceFileBinary,
  useWorkspaceFileContent,
  useWorkspaceImageDimensionsAdapter,
} from '@/hooks/queries/workspace-files'
import {
  createWorkspaceFileContentSource,
  type FileContentSource,
  FileContentSourceProvider,
  useFileContentSource,
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

export function isTextEditable(file: {
  type: string
  name: string
  size?: number | null
}): boolean {
  return (
    resolveFileCategory(file.type, file.name) === 'text-editable' &&
    (file.size ?? 0) <= MAX_TEXT_PREVIEW_BYTES
  )
}

export function isPreviewable(file: { type: string; name: string; size?: number | null }): boolean {
  return resolvePreviewType(file.type, file.name) !== null && isTextEditable(file)
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
  /** Receives why a save was refused; text files only. */
  onSaveError?: (error: unknown) => void
  /** Replaces the file's own preview pane, for an owner with a richer view of the file. */
  preview?: ReactNode
  /** Which side of a split the source takes; `end` puts it after the preview. */
  sourceSide?: 'start' | 'end'
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
   * Called with the file id and the markdown document's leading-heading text once the user finishes
   * that heading while the file is still untitled, so the caller can name the file after it. Only wired
   * for the editable markdown editor.
   */
  onDeriveTitleFromHeading?: (fileId: string, headingText: string) => void
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
  onSaveError,
  preview,
  sourceSide,
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
    if (isCsvStreamOnly(file)) {
      return readOnly ? (
        <UnsupportedPreview name={file.name} />
      ) : (
        <CsvTablePreview key={file.id} file={file} workspaceId={workspaceId} />
      )
    }
    if (!isTextEditable(file)) {
      return <UnsupportedPreview name={file.name} reason={TEXT_PREVIEW_SIZE_MESSAGE} />
    }
    if (readOnly) {
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
        onSaveError={onSaveError}
        preview={preview}
        sourceSide={sourceSide}
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
      <pre className='whitespace-pre-wrap break-words font-mono text-[var(--text-body)] text-small'>
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

interface MediaPreviewProps {
  file: WorkspaceFileRecord
  workspaceId: string
  kind: 'audio' | 'video'
}

/**
 * Audio and video preview. Where the content source answers byte ranges the player streams straight
 * from its URL, so playback and seeking start while the file downloads, at any size. Elsewhere the
 * file is fetched whole into a blob first.
 */
const MediaPreview = memo(function MediaPreview({ file, workspaceId, kind }: MediaPreviewProps) {
  const source = useFileContentSource()
  if (!source.servesByteRanges) {
    return <BufferedMediaPreview file={file} workspaceId={workspaceId} kind={kind} />
  }
  /** `v` lets the browser cache the bytes across re-opens; a content write moves the key. */
  const src = source.buildUrl(file.key, {
    version: Number(new Date(file.updatedAt)) || file.size,
  })
  /** Keyed by URL so a re-resolved key starts the player, and its load state, afresh. */
  return (
    <StreamedMediaPlayer key={src} src={src} file={file} workspaceId={workspaceId} kind={kind} />
  )
})

function StreamedMediaPlayer({
  src,
  file,
  workspaceId,
  kind,
}: MediaPreviewProps & { src: string }) {
  const [status, setStatus] = useState<'loading' | 'ready' | 'unplayable' | 'unavailable'>(
    'loading'
  )
  const reresolveRecord = useReresolveFileRecord(workspaceId, file.id)
  const diagnosing = useRef(false)

  /**
   * A media element reports only that it failed, not why, so the URL is asked directly for its
   * first byte, which opens storage. A 404 means the key was replaced; the record is re-resolved,
   * and a moved key re-renders this preview at the new URL. Bytes that are there but would not play
   * are the browser's format support.
   */
  const handleError = useCallback(async () => {
    if (diagnosing.current) return
    diagnosing.current = true
    // boundary-raw-fetch: ranged probe of the binary serve path, which has no contract
    const probe = await fetch(src, { headers: { Range: 'bytes=0-0' }, cache: 'no-store' }).catch(
      () => null
    )
    await probe?.body?.cancel()
    if (probe?.status === 404) await reresolveRecord()
    setStatus(probe?.ok ? 'unplayable' : 'unavailable')
  }, [src, reresolveRecord])

  /**
   * The element starts loading as soon as it is in the document, which can be before hydration
   * attaches its listeners — a small file then finishes before `loadedmetadata` is heard. Reading
   * the element's own state on mount covers what the listeners missed.
   */
  const syncWithElement = useCallback(
    (media: HTMLMediaElement | null) => {
      if (!media || status !== 'loading') return
      if (media.error) void handleError()
      else if (media.readyState >= HTMLMediaElement.HAVE_METADATA) setStatus('ready')
    },
    [status, handleError]
  )

  if (status === 'unplayable') {
    return (
      <UnsupportedPreview
        name={file.name}
        reason={`This ${kind} can't be played in your browser. Use the download button to view it.`}
      />
    )
  }
  if (status === 'unavailable') {
    return <PreviewError label={kind} error='Failed to fetch file content' />
  }

  return (
    <MediaPlayer
      file={file}
      kind={kind}
      src={src}
      loading={status === 'loading'}
      mediaRef={syncWithElement}
      onLoadedMetadata={() => setStatus('ready')}
      onError={handleError}
    />
  )
}

/** Fetches the whole file into a blob, for content sources that send only whole bodies. */
function BufferedMediaPreview({ file, workspaceId, kind }: MediaPreviewProps) {
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

  return <MediaPlayer file={file} kind={kind} src={blobUrl} />
}

interface MediaPlayerProps {
  file: WorkspaceFileRecord
  kind: 'audio' | 'video'
  src: string | null
  /** Covers the player until it can describe the media, for players that load in place. */
  loading?: boolean
  mediaRef?: (media: HTMLMediaElement | null) => void
  onLoadedMetadata?: () => void
  onError?: () => void
}

function MediaPlayer({
  file,
  kind,
  src,
  loading,
  mediaRef,
  onLoadedMetadata,
  onError,
}: MediaPlayerProps) {
  if (kind === 'audio') {
    return (
      <div className='relative flex h-full flex-col items-center justify-center gap-4 bg-[var(--surface-1)] p-8'>
        <div className='flex flex-col items-center gap-2 text-center'>
          <Music className='size-[32px] text-[var(--text-muted)]' />
          <p className='text-[14px] text-[var(--text-primary)]'>{file.name}</p>
        </div>
        {src && (
          // biome-ignore lint/a11y/useMediaCaption: audio from workspace files
          <audio
            ref={mediaRef}
            src={src}
            controls
            className='w-full max-w-[480px]'
            onLoadedMetadata={onLoadedMetadata}
            onError={onError}
          />
        )}
        {loading && PREVIEW_LOADING_OVERLAY}
      </div>
    )
  }

  return (
    <div className='relative flex h-full items-center justify-center bg-[var(--surface-1)]'>
      {src && (
        // biome-ignore lint/a11y/useMediaCaption: video from workspace files
        <video
          ref={mediaRef}
          src={src}
          controls
          className='max-h-full max-w-full'
          onLoadedMetadata={onLoadedMetadata}
          onError={onError}
        />
      )}
      {loading && PREVIEW_LOADING_OVERLAY}
    </div>
  )
}
