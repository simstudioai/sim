'use client'

import { Suspense, useMemo } from 'react'
import dynamic from 'next/dynamic'
import { CsvTablePreview } from '@/app/(product)/workspace/[workspaceId]/files/_components/file-viewer/csv-table-preview'
import styles from '@/app/(product)/workspace/[workspaceId]/files/_components/file-viewer/file-viewer.module.css'
import { ImagePreview } from '@/app/(product)/workspace/[workspaceId]/files/_components/file-viewer/image-preview'
import { MediaPreview } from '@/app/(product)/workspace/[workspaceId]/files/_components/file-viewer/media-preview'
import { PdfPreview } from '@/app/(product)/workspace/[workspaceId]/files/_components/file-viewer/pdf-preview'
import { UnsupportedPreview } from '@/app/(product)/workspace/[workspaceId]/files/_components/file-viewer/preview-shared'
import { resolvePreviewType } from '@/app/(product)/workspace/[workspaceId]/files/_components/file-viewer/preview-type'
import type {
  FileEditingProps,
  PreviewMode,
} from '@/app/(product)/workspace/[workspaceId]/files/_components/file-viewer/types'
import {
  createWorkspaceFileContentSource,
  FileContentSourceProvider,
  MAX_TEXT_PREVIEW_BYTES,
  resolveFileCategory,
  TEXT_PREVIEW_SIZE_MESSAGE,
  useWorkspaceImageDimensionsAdapter,
} from '@/platform/lib/data/files'

const DocxPreview = dynamic(
  () =>
    import(
      '@/app/(product)/workspace/[workspaceId]/files/_components/file-viewer/docx-preview'
    ).then((module) => module.DocxPreview),
  { ssr: false }
)

const PptxPreview = dynamic(
  () =>
    import(
      '@/app/(product)/workspace/[workspaceId]/files/_components/file-viewer/pptx-preview'
    ).then((module) => module.PptxPreview),
  { ssr: false }
)

const TextEditor = dynamic(
  () =>
    import(
      '@/app/(product)/workspace/[workspaceId]/files/_components/file-viewer/text-editor'
    ).then((module) => module.TextEditor),
  { ssr: false }
)

const XlsxPreview = dynamic(
  () =>
    import(
      '@/app/(product)/workspace/[workspaceId]/files/_components/file-viewer/xlsx-preview'
    ).then((module) => module.XlsxPreview),
  { ssr: false }
)

const RichMarkdownEditor = dynamic(
  () =>
    import(
      '@/app/(product)/workspace/[workspaceId]/files/_components/file-viewer/rich-markdown-editor/rich-markdown-editor'
    ).then((module) => module.RichMarkdownEditor),
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
  previewMode: PreviewMode
  /** Offers the file itself where there is nothing to show of it here. */
  onDownload?: () => void
  /** Live collaborative editing, for markdown. */
  collaborative?: boolean
  /** Names a still-untitled markdown file after the heading its editor reports. */
  onDeriveTitleFromHeading?: (fileId: string, headingText: string) => void
  /** Lets an open markdown file claim Cmd/Ctrl+F for find-in-document. */
  enableFind?: boolean
}

/**
 * The right viewer or editor for a workspace file: text and code in the source editor, markdown in
 * the rich editor, and documents, images, media and spreadsheets in their previews.
 */
export function FileViewer(props: FileViewerProps) {
  const imageDimensions = useWorkspaceImageDimensionsAdapter(props.workspaceId)
  const source = useMemo(
    () => createWorkspaceFileContentSource(props.workspaceId, imageDimensions),
    [props.workspaceId, imageDimensions]
  )
  return (
    <FileContentSourceProvider value={source}>
      <div className={styles.viewer}>
        <Suspense fallback={null}>
          <FileViewerContent
            file={props.file}
            workspaceId={props.workspaceId}
            canEdit={props.canEdit}
            previewMode={props.previewMode}
            autoFocus={props.autoFocus}
            onDirtyChange={props.onDirtyChange}
            onSaveStatusChange={props.onSaveStatusChange}
            saveRef={props.saveRef}
            downloadSourceRef={props.downloadSourceRef}
            discardRef={props.discardRef}
            onDownload={props.onDownload}
            collaborative={props.collaborative}
            onDeriveTitleFromHeading={props.onDeriveTitleFromHeading}
            enableFind={props.enableFind}
          />
        </Suspense>
      </div>
    </FileContentSourceProvider>
  )
}

function FileViewerContent({
  file,
  workspaceId,
  canEdit,
  previewMode,
  autoFocus,
  onDirtyChange,
  onSaveStatusChange,
  saveRef,
  downloadSourceRef,
  discardRef,
  onDownload,
  collaborative,
  onDeriveTitleFromHeading,
  enableFind,
}: FileViewerProps) {
  const category = resolveFileCategory(file.type, file.name)

  if (category === 'text-editable') {
    if (isCsvStreamOnly(file)) return <CsvTablePreview file={file} workspaceId={workspaceId} />
    if (!isTextEditable(file))
      return (
        <UnsupportedPreview
          name={file.name}
          reason={TEXT_PREVIEW_SIZE_MESSAGE}
          onDownload={onDownload}
        />
      )
    if (isMarkdownFile(file))
      return (
        <RichMarkdownEditor
          file={file}
          workspaceId={workspaceId}
          canEdit={canEdit}
          autoFocus={autoFocus}
          onDirtyChange={onDirtyChange}
          onSaveStatusChange={onSaveStatusChange}
          saveRef={saveRef}
          downloadSourceRef={downloadSourceRef}
          discardRef={discardRef}
          collaborative={collaborative}
          onDeriveTitleFromHeading={onDeriveTitleFromHeading}
          enableFind={enableFind}
        />
      )
    return (
      <TextEditor
        file={file}
        workspaceId={workspaceId}
        canEdit={canEdit}
        previewMode={previewMode}
        autoFocus={autoFocus}
        onDirtyChange={onDirtyChange}
        onSaveStatusChange={onSaveStatusChange}
        saveRef={saveRef}
        downloadSourceRef={downloadSourceRef}
        discardRef={discardRef}
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
