'use client'

import { type ReactNode, Suspense, useMemo } from 'react'
import dynamic from 'next/dynamic'
import { CsvTablePreview } from '@/components/file-viewer/csv-table-preview'
import { resolveFileCategory } from '@/components/file-viewer/file-category'
import styles from '@/components/file-viewer/file-viewer.module.css'
import { ImagePreview } from '@/components/file-viewer/image-preview'
import { MediaPreview } from '@/components/file-viewer/media-preview'
import { PdfPreview } from '@/components/file-viewer/pdf-preview'
import { PreviewPanel } from '@/components/file-viewer/preview-panel'
import {
  PreviewError,
  resolvePreviewError,
  UnsupportedPreview,
} from '@/components/file-viewer/preview-shared'
import { resolvePreviewType } from '@/components/file-viewer/preview-type'
import type { FileEditingProps, PreviewMode } from '@/components/file-viewer/types'
import {
  MAX_TEXT_PREVIEW_BYTES,
  TEXT_PREVIEW_SIZE_MESSAGE,
} from '@/lib/uploads/client/text-content'
import {
  useWorkspaceFileContent,
  useWorkspaceImageDimensionsAdapter,
} from '@/hooks/queries/workspace-files'
import {
  createWorkspaceFileContentSource,
  type FileContentSource,
  FileContentSourceProvider,
} from '@/hooks/use-file-content-source'

const DocxPreview = dynamic(
  () => import('@/components/file-viewer/docx-preview').then((module) => module.DocxPreview),
  { ssr: false }
)

const PptxPreview = dynamic(
  () => import('@/components/file-viewer/pptx-preview').then((module) => module.PptxPreview),
  { ssr: false }
)

const TextEditor = dynamic(
  () => import('@/components/file-viewer/text-editor').then((module) => module.TextEditor),
  { ssr: false }
)

const XlsxPreview = dynamic(
  () => import('@/components/file-viewer/xlsx-preview').then((module) => module.XlsxPreview),
  { ssr: false }
)

const RichMarkdownEditor = dynamic(
  () =>
    import('@/components/file-viewer/rich-markdown-editor/rich-markdown-editor').then(
      (module) => module.RichMarkdownEditor
    ),
  { ssr: false }
)

/**
 * CSVs up to this size load whole into the editor, editable with an inline preview. A larger one
 * would exhaust the tab on `response.text()`, so it shows a streamed, read-only first page instead.
 */
const CSV_INLINE_EDIT_MAX_BYTES = 5 * 1024 * 1024

interface FileShape {
  type: string
  name: string
  size?: number | null
}

/** A text file small enough to open in an editor. */
export function isTextEditable(file: FileShape): boolean {
  return (
    resolveFileCategory(file.type, file.name) === 'text-editable' &&
    (file.size ?? 0) <= MAX_TEXT_PREVIEW_BYTES
  )
}

/** An editable text file with a rendered view: a page, table, image, diagram or chart. */
export function isPreviewable(file: FileShape): boolean {
  return resolvePreviewType(file.type, file.name) !== null && isTextEditable(file)
}

/** Markdown opens in the rich editor, which has no source, split or preview modes of its own. */
export function isMarkdownFile(file: FileShape): boolean {
  return resolvePreviewType(file.type, file.name) === 'markdown'
}

/** A CSV too large for the editor shows only its streamed preview: nothing to edit or toggle. */
export function isCsvStreamOnly(file: FileShape): boolean {
  return (
    resolvePreviewType(file.type, file.name) === 'csv' &&
    (file.size ?? 0) > CSV_INLINE_EDIT_MAX_BYTES
  )
}

interface FileViewerProps extends FileEditingProps {
  /** How a text file shows; defaults to its source. */
  previewMode?: PreviewMode
  /**
   * Where the file's bytes come from. Defaults to the workspace's own serve route; the public share
   * page passes its token-scoped source. Descendants, such as embedded images, read it from context.
   */
  contentSource?: FileContentSource
  /**
   * A reader with no editing affordances, as on the public share page: markdown reads in the rich
   * editor without its controls, a previewable text file in its preview and any other in plain text.
   */
  readOnly?: boolean
  /** Replaces the file's own preview pane, for an owner with a richer view of the file. */
  preview?: ReactNode
  /** Which side of a split the source takes; `end` puts it after the preview. */
  sourceSide?: 'start' | 'end'
  /** Offers the file itself where there is nothing to show of it here. */
  onDownload?: () => void
  /** Live collaborative editing, for markdown. */
  collaborative?: boolean
  /** Names a still-untitled markdown file after the heading its editor reports. */
  onDeriveTitleFromHeading?: (fileId: string, headingText: string) => void
  /** Lets an open markdown file claim Cmd/Ctrl+F for find-in-document. */
  enableFind?: boolean
  /** Receives why a save was refused; text files only. */
  onSaveError?: (error: unknown) => void
}

/**
 * The right viewer or editor for a file: text and code in the source editor, markdown in the rich
 * editor, and documents, images, media and spreadsheets in their previews.
 */
export function FileViewer({ contentSource, ...props }: FileViewerProps) {
  // A caller's own source leaves the workspace adapter unused; its `workspaceId` may be a share token.
  const imageDimensions = useWorkspaceImageDimensionsAdapter(props.workspaceId, {
    enabled: !contentSource,
  })
  const source = useMemo(
    () => contentSource ?? createWorkspaceFileContentSource(props.workspaceId, imageDimensions),
    [contentSource, props.workspaceId, imageDimensions]
  )
  return (
    <FileContentSourceProvider value={source}>
      <div className={styles.viewer}>
        <Suspense fallback={null}>
          <FileViewerContent {...props} />
        </Suspense>
      </div>
    </FileContentSourceProvider>
  )
}

function FileViewerContent({
  file,
  workspaceId,
  canEdit,
  readOnly = false,
  previewMode = 'editor',
  onDownload,
  collaborative,
  onDeriveTitleFromHeading,
  enableFind,
  onSaveError,
  preview,
  sourceSide,
  ...editing
}: Omit<FileViewerProps, 'contentSource'>) {
  const category = resolveFileCategory(file.type, file.name)

  if (category === 'text-editable') {
    if (isCsvStreamOnly(file))
      return readOnly ? (
        <UnsupportedPreview name={file.name} onDownload={onDownload} />
      ) : (
        <CsvTablePreview key={file.id} file={file} workspaceId={workspaceId} />
      )
    if (!isTextEditable(file))
      return (
        <UnsupportedPreview
          name={file.name}
          reason={TEXT_PREVIEW_SIZE_MESSAGE}
          onDownload={onDownload}
        />
      )
    if (readOnly)
      return isMarkdownFile(file) ? (
        <RichMarkdownEditor
          key={file.id}
          file={file}
          workspaceId={workspaceId}
          canEdit={false}
          enableFind={enableFind}
        />
      ) : (
        <ReadOnlyTextPreview file={file} workspaceId={workspaceId} />
      )
    if (isMarkdownFile(file))
      return (
        <RichMarkdownEditor
          key={file.id}
          file={file}
          workspaceId={workspaceId}
          canEdit={canEdit}
          collaborative={collaborative}
          onDeriveTitleFromHeading={onDeriveTitleFromHeading}
          enableFind={enableFind}
          {...editing}
        />
      )
    return (
      <TextEditor
        file={file}
        workspaceId={workspaceId}
        canEdit={canEdit}
        previewMode={previewMode}
        onSaveError={onSaveError}
        preview={preview}
        sourceSide={sourceSide}
        {...editing}
      />
    )
  }
  if (category === 'iframe-previewable')
    return <PdfPreview key={file.id} file={file} workspaceId={workspaceId} />
  if (category === 'image-previewable')
    return <ImagePreview key={file.key} file={file} onDownload={onDownload} />
  if (category === 'audio-previewable' || category === 'video-previewable')
    return (
      <MediaPreview
        key={file.id}
        file={file}
        workspaceId={workspaceId}
        kind={category === 'audio-previewable' ? 'audio' : 'video'}
        onDownload={onDownload}
      />
    )
  if (category === 'docx-previewable')
    return <DocxPreview key={file.id} file={file} workspaceId={workspaceId} />
  if (category === 'pptx-previewable')
    return <PptxPreview key={file.id} file={file} workspaceId={workspaceId} />
  if (category === 'xlsx-previewable')
    return <XlsxPreview key={file.id} file={file} workspaceId={workspaceId} />
  return <UnsupportedPreview name={file.name} onDownload={onDownload} />
}

/**
 * A text file for a reader without write access: a previewable type in its rendered view, anything
 * else as plain text. Reads through the active content source, so it serves share links too.
 */
function ReadOnlyTextPreview({
  file,
  workspaceId,
}: Pick<FileEditingProps, 'file' | 'workspaceId'>) {
  const { data: content, error } = useWorkspaceFileContent(workspaceId, file.id, file.key)
  const resolvedError = resolvePreviewError(error instanceof Error ? error : null, null)
  if (resolvedError) return <PreviewError label='file' error={resolvedError} />
  if (content == null) return null
  if (resolvePreviewType(file.type, file.name))
    return (
      <div className={styles.readOnly}>
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
  return (
    <div className={styles.readOnly}>
      <pre className={styles.plainText}>{content}</pre>
    </div>
  )
}
