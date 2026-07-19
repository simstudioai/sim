'use client'

import { memo, useMemo, useState } from 'react'
import { ChipLink } from '@sim/emcn'
import { Download, FileX } from '@sim/emcn/icons'
import { Music } from 'lucide-react'
import dynamic from 'next/dynamic'
import { CsvTablePreview } from '@/components/resources/file-view/components/csv-table-preview/csv-table-preview'
import { DocxPreview } from '@/components/resources/file-view/components/docx-preview/docx-preview'
import { ImagePreview } from '@/components/resources/file-view/components/image-preview/image-preview'
import type { PdfDocumentSource } from '@/components/resources/file-view/components/pdf-viewer/pdf-viewer'
import { PptxPreview } from '@/components/resources/file-view/components/pptx-preview/pptx-preview'
import {
  PreviewPanel,
  resolvePreviewType,
} from '@/components/resources/file-view/components/preview-panel/preview-panel'
import {
  PREVIEW_LOADING_OVERLAY,
  PreviewError,
  PreviewErrorBoundary,
  PreviewLoadingFrame,
  resolvePreviewError,
} from '@/components/resources/file-view/components/preview-shared/preview-shared'
import { TextEditor } from '@/components/resources/file-view/components/text-editor/text-editor'
import { XlsxPreview } from '@/components/resources/file-view/components/xlsx-preview/xlsx-preview'
import { useDocPreviewBinary } from '@/components/resources/file-view/hooks/use-doc-preview-binary'
import { resolveFileCategory } from '@/components/resources/file-view/utils/file-category'
import { ResourceEmptyState } from '@/components/resources/resource-empty-state'
import { ResourceProvider, useResourceOfKind } from '@/components/resources/resource-provider'
import { getFileExtension, getMimeTypeFromExtension } from '@/lib/uploads/utils/file-utils'
import { useWorkspaceFileContent, useWorkspaceFileRecord } from '@/hooks/queries/workspace-files'
import type { ResourceGrants, ResourceHost, ResourceSource, UnavailableReason } from '@/resources'
import {
  type FileViewRecord,
  fileContentUrl,
  fileWorkspaceId,
  shareFileRecord,
} from '@/resources/file-source'

const PdfViewerCore = dynamic(
  () =>
    import('@/components/resources/file-view/components/pdf-viewer').then((m) => m.PdfViewerCore),
  {
    ssr: false,
  }
)

const RichMarkdownEditor = dynamic(
  () =>
    import(
      '@/components/resources/file-view/components/rich-markdown-editor/rich-markdown-editor'
    ).then((m) => m.RichMarkdownEditor),
  { ssr: false, loading: () => <PreviewLoadingFrame className='flex flex-1 flex-col' /> }
)

/**
 * CSVs at or below this size load fully into the editor (editable, with an inline preview).
 * Larger CSVs would OOM the browser on `response.text()`, so they render a read-only,
 * server-streamed preview of the first rows instead (see {@link CsvTablePreview}).
 */
const CSV_INLINE_EDIT_MAX_BYTES = 5 * 1024 * 1024

/**
 * Source mime for a generated document's *program* — the editable text of a
 * `.pptx`/`.docx`/`.pdf` an agent writes is the builder script, not the compiled
 * artifact.
 */
const GENERATED_SOURCE_MIME_BY_EXTENSION: Record<string, string> = {
  pptx: 'text/x-pptxgenjs',
  docx: 'text/x-docxjs',
  pdf: 'text/x-pdflibjs',
}

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

/**
 * Live agent output for the file on screen. One optional object rather than five
 * loose props, because they are only ever set together and only this view has
 * them — no other resource streams.
 */
export interface FileViewStreaming {
  /** The text streamed so far, or `undefined` once the stream settles. */
  content?: string
  /** The agent holds the write lock: the surface stays read-only even after the stream ends. */
  isAgentEditing?: boolean
  /**
   * True when the stream delivers complete full-file snapshots (an `append`/`patch` edit built on
   * the existing file) rather than a from-scratch rebuild (`create`/`update`). Incremental
   * snapshots are applied live; a rebuild is only revealed while it extends what is shown.
   */
  isIncremental?: boolean
  disableAutoScroll?: boolean
  /** Remounts the editor when the agent starts a new turn against the same file. */
  contextKey?: string
  /**
   * Name of a file the agent is creating that has no record yet. The renderer is
   * chosen from it and the surface holds only the streamed text — there are no
   * bytes to fetch until the agent's write lands.
   */
  fileName?: string
}

export interface FileViewProps {
  source: ResourceSource<'file'>
  grants: ResourceGrants
  host: ResourceHost
  /**
   * Render a reading surface with no editor at all: text files render through
   * {@link PreviewPanel} (or a plain `<pre>`) rather than a disabled
   * {@link TextEditor}.
   *
   * Not derivable from `grants.write` — a workspace member who cannot edit still
   * gets the full editor chrome (syntax highlighting, split preview) on the Files
   * page, while an embedded or shared file is a reading surface for everyone.
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
  streaming?: FileViewStreaming
  /**
   * How this host moves the viewer — the router half of `host`. Supplied by a
   * host that owns a router (`router.push`); omitted by a `'public'` one, where
   * mentions and in-document links resolve to `null` anyway and stay inert.
   */
  onNavigate?: (path: string) => void
}

/** The record for a file an agent is writing that does not exist yet. */
function streamingFileRecord(fileName: string): FileViewRecord {
  const extension = getFileExtension(fileName)
  return {
    id: 'streaming-file',
    name: fileName,
    type: GENERATED_SOURCE_MIME_BY_EXTENSION[extension] ?? getMimeTypeFromExtension(extension),
    key: '',
    size: 0,
    updatedAt: new Date(0),
    folderId: null,
  }
}

/**
 * Renders one file's real contents — PDFs, images, docx, xlsx, pptx, markdown,
 * CSV, and code — from whichever address its {@link ResourceSource} carries, so
 * the same view serves the Files page, an embedded panel, and an anonymous share.
 */
export function FileView({ source, grants, host, onNavigate, ...props }: FileViewProps) {
  const shared = useMemo(() => (source.via === 'share' ? shareFileRecord(source) : null), [source])
  const streamingName = props.streaming?.fileName
  const streaming = useMemo(
    () => (streamingName ? streamingFileRecord(streamingName) : null),
    [streamingName]
  )
  /**
   * Both of these describe the file without a lookup — a share carries its
   * server-resolved seed, and an agent-written file exists only in the stream.
   * Resolving them here keeps {@link WorkspaceFileView}, and therefore the
   * workspace record query, off the page entirely when neither address applies.
   */
  const known = shared ?? streaming

  return (
    <ResourceProvider source={source} grants={grants} host={host} onNavigate={onNavigate}>
      {known ? <FileViewContent file={known} {...props} /> : <WorkspaceFileView {...props} />}
    </ResourceProvider>
  )
}

type FileViewSurfaceProps = Omit<FileViewProps, 'source' | 'grants' | 'host' | 'onNavigate'>

/**
 * Resolves the workspace record for the addressed file. The record comes from the
 * shared active-files query, so a surface that already listed the workspace's
 * files reads it straight from cache.
 */
function WorkspaceFileView(props: FileViewSurfaceProps) {
  const { source, host } = useResourceOfKind('file')
  const workspaceId = fileWorkspaceId(source) ?? ''
  const fileId = source.via === 'workspace' ? source.resourceId : ''
  const { data, isPending, isFetching, isError } = useWorkspaceFileRecord(workspaceId, fileId)
  const record = data ?? null

  /**
   * A background refetch that has not yet produced the record still reads as
   * pending — a file created moments ago must not flash "not found" while the
   * invalidated list is in flight.
   */
  if (isPending || (isFetching && !record)) {
    return <PreviewLoadingFrame className='h-full' tone='surface' />
  }

  if (!record) {
    /**
     * A failed lookup is not a missing file. Reporting an outage as a deletion
     * sends the viewer off to re-wire something that is still perfectly valid.
     */
    const reason: UnavailableReason = isError ? 'transient' : 'missing'
    return (
      <ResourceEmptyState
        icon={FileX}
        // A panel sits inside a frame that already names what it is showing; a
        // page has to say so itself.
        title={
          host === 'panel'
            ? undefined
            : reason === 'transient'
              ? 'File unavailable'
              : 'File not found'
        }
        description={source.unavailableCopy(reason)}
      />
    )
  }

  return <FileViewContent key={record.id} file={record} {...props} />
}

function FileViewContent({
  file,
  readOnly = false,
  previewMode,
  autoFocus,
  onDirtyChange,
  onSaveStatusChange,
  saveRef,
  discardRef,
  streaming,
}: FileViewSurfaceProps & { file: FileViewRecord }) {
  const { source, grants } = useResourceOfKind('file')
  const canEdit = grants.write
  const category = resolveFileCategory(file.type, file.name)

  if (category === 'text-editable') {
    if (readOnly) {
      // ReadOnlyTextPreview loads the whole file as text; a large CSV would OOM the
      // browser. CsvTablePreview's streamed fallback is workspace-only, so on the
      // read-only path a large CSV is download-only.
      if (isCsvStreamOnly(file)) {
        return <UnsupportedPreview file={file} />
      }
      // Markdown renders through the inline rich editor (non-editable) so a shared or
      // embedded file matches the in-app reading experience; canEdit={false} disables
      // autosave, the bubble menu, and every other editing affordance.
      if (isMarkdownFile(file)) {
        return <RichMarkdownEditor key={file.id} file={file} canEdit={false} />
      }
      return <ReadOnlyTextPreview file={file} />
    }
    // A large CSV can't be loaded whole into the editor (the browser OOMs on the full text).
    // Render a streamed, read-only preview of the first rows + an "Import as a table" path
    // instead. That route is workspace-authenticated, so a share falls back to download-only.
    if (isCsvStreamOnly(file)) {
      return fileWorkspaceId(source) ? (
        <CsvTablePreview key={file.id} file={file} />
      ) : (
        <UnsupportedPreview file={file} />
      )
    }

    if (isMarkdownFile(file)) {
      return (
        <RichMarkdownEditor
          key={file.id}
          file={file}
          canEdit={canEdit}
          autoFocus={autoFocus}
          onDirtyChange={onDirtyChange}
          onSaveStatusChange={onSaveStatusChange}
          saveRef={saveRef}
          discardRef={discardRef}
          streaming={streaming}
        />
      )
    }

    return (
      <TextEditor
        file={file}
        canEdit={canEdit}
        previewMode={previewMode ?? 'editor'}
        autoFocus={autoFocus}
        onDirtyChange={onDirtyChange}
        onSaveStatusChange={onSaveStatusChange}
        saveRef={saveRef}
        discardRef={discardRef}
        streaming={streaming}
      />
    )
  }

  if (category === 'iframe-previewable') {
    return <IframePreview key={file.id} file={file} />
  }

  if (category === 'image-previewable') {
    return <ImagePreview key={file.key} file={file} />
  }

  if (category === 'audio-previewable') {
    return <MediaPreview key={file.id} file={file} kind='audio' />
  }

  if (category === 'video-previewable') {
    return <MediaPreview key={file.id} file={file} kind='video' />
  }

  if (category === 'docx-previewable') {
    return <DocxPreview key={file.id} file={file} />
  }

  if (category === 'pptx-previewable') {
    return <PptxPreview key={file.id} file={file} />
  }

  if (category === 'xlsx-previewable') {
    return <XlsxPreview key={file.id} file={file} />
  }

  return <UnsupportedPreview file={file} />
}

/**
 * Read-only text/markdown/code preview. Renders rich types (markdown, csv, svg,
 * mermaid, html) through {@link PreviewPanel} and plain text/code in a `<pre>`.
 * Fetches content through the mounted source, so it works for both workspace
 * files and public share links.
 */
const ReadOnlyTextPreview = memo(function ReadOnlyTextPreview({ file }: { file: FileViewRecord }) {
  const { source } = useResourceOfKind('file')
  const { data: content, isLoading, error } = useWorkspaceFileContent(source, file.id, file.key)

  const resolvedError = resolvePreviewError((error as Error | null) ?? null, null)
  if (resolvedError) return <PreviewError label='file' error={resolvedError} />
  if (isLoading || content == null) return <PreviewLoadingFrame className='h-full' tone='surface' />

  if (resolvePreviewType(file.type, file.name)) {
    return (
      <div className='h-full min-h-0 w-full overflow-auto'>
        <PreviewPanel
          content={content}
          mimeType={file.type}
          filename={file.name}
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

const IframePreview = memo(function IframePreview({ file }: { file: FileViewRecord }) {
  const preview = useDocPreviewBinary(file)

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

/**
 * Audio and video, played straight from the content URL.
 *
 * Deliberately NOT fetched: the element streams the object itself, so playback
 * starts on the first bytes and a seek costs one short ranged request. The
 * previous implementation downloaded the whole file and played it from a
 * `blob:` URL — the only reason the scrubber worked, since the routes advertised
 * no `Accept-Ranges` — which put an entire video in the JS heap before the first
 * frame. The routes byte-serve now, so the element does this correctly and for
 * free.
 *
 * `preload='metadata'` fetches only enough to know the duration, so mounting a
 * long video costs one small request rather than a buffer.
 */
const MediaPreview = memo(function MediaPreview({
  file,
  kind,
}: {
  file: FileViewRecord
  kind: 'audio' | 'video'
}) {
  const { source } = useResourceOfKind('file')
  const [failed, setFailed] = useState(false)

  /** Versioned so an edited file busts the browser's media cache. */
  const src = file.key
    ? fileContentUrl(source, file.key, { version: file.updatedAt.getTime() })
    : null

  if (!src || failed) {
    return <PreviewError label={kind} error={`This ${kind} could not be played.`} />
  }

  if (kind === 'audio') {
    return (
      <div className='flex h-full flex-col items-center justify-center gap-4 bg-[var(--surface-1)] p-8'>
        <div className='flex flex-col items-center gap-2 text-center'>
          <Music className='size-[32px] text-[var(--text-muted)]' strokeWidth={1.5} />
          <p className='font-medium text-[14px] text-[var(--text-primary)]'>{file.name}</p>
        </div>
        {/* biome-ignore lint/a11y/useMediaCaption: audio from workspace files */}
        <audio
          src={src}
          controls
          preload='metadata'
          onError={() => setFailed(true)}
          className='w-full max-w-[480px]'
        />
      </div>
    )
  }

  /**
   * The element fills the pane and letterboxes the frame, rather than sizing
   * itself to the video.
   *
   * A `<video>` reports an intrinsic 300x150 until its metadata arrives, so
   * `max-h-full max-w-full` — which sizes *to* the intrinsics — paints a small
   * box and snaps to full size once the first bytes land. Driving the box from
   * the pane instead makes the layout independent of load state, and
   * `object-contain` keeps the aspect ratio honest inside it.
   */
  return (
    <div className='flex h-full items-center justify-center bg-[var(--surface-1)]'>
      {/* biome-ignore lint/a11y/useMediaCaption: video from workspace files */}
      <video
        src={src}
        controls
        preload='metadata'
        onError={() => setFailed(true)}
        className='h-full w-full object-contain'
      />
    </div>
  )
})

/**
 * The dead end for a file no renderer handles — an archive, an installer, a
 * columnar dataset. It carries its own download link rather than pointing at a
 * button in the surrounding chrome: this view is mounted on surfaces that draw
 * no chrome at all (the fullscreen file route, an interface's file module), and
 * telling a visitor to press a button that is not on the page strands them with
 * no way to reach the bytes.
 */
const UnsupportedPreview = memo(function UnsupportedPreview({ file }: { file: FileViewRecord }) {
  const { source } = useResourceOfKind('file')
  const ext = getFileExtension(file.name)
  const href = file.key
    ? fileContentUrl(source, file.key, { version: file.updatedAt.getTime() })
    : null

  return (
    <div className='flex flex-1 flex-col items-center justify-center gap-[8px]'>
      <p className='font-medium text-[14px] text-[var(--text-primary)]'>
        Preview not available{ext ? ` for .${ext} files` : ' for this file'}
      </p>
      {href ? (
        <ChipLink href={href} download={file.name} leftIcon={Download} className='mt-[4px]'>
          Download
        </ChipLink>
      ) : (
        <p className='text-[13px] text-[var(--text-muted)]'>This file has no content yet</p>
      )}
    </div>
  )
})
