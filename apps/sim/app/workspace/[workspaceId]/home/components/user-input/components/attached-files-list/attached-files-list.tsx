'use client'

import React, { useState } from 'react'
import { cn, Loader, Tooltip } from '@sim/emcn'
import { X } from '@sim/emcn/icons'
import { getDocumentIcon } from '@/components/icons/document-icons'
import { getFileExtension } from '@/lib/uploads/utils/file-utils'
import type { AttachedFile } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/copilot/components/user-input/hooks/use-file-attachments'

/**
 * Chrome shared by both chip shapes, borrowed from the chip family's filled field so a
 * hand-rolled card still reads as part of the system. Both shapes stand 48px tall, so a
 * row mixing thumbnails and documents sits on one baseline.
 */
const CHIP_SURFACE =
  'relative h-[48px] cursor-pointer rounded-[10px] border border-[var(--border)] bg-[var(--surface-5)] transition-colors dark:bg-[var(--surface-4)] hover-hover:bg-[var(--surface-active)]'

interface AttachedFilesListProps {
  attachedFiles: AttachedFile[]
  onFileClick: (file: AttachedFile) => void
  onRemoveFile: (id: string) => void
}

interface AttachedFileChipProps {
  file: AttachedFile
  onFileClick: (file: AttachedFile) => void
  onRemoveFile: (id: string) => void
}

/**
 * One attachment.
 *
 * Media renders as a thumbnail; everything else renders as a labelled card — icon
 * badge, filename, file type. A document has no thumbnail worth showing, and the
 * filename is the thing worth reading.
 */
const AttachedFileChip = React.memo(function AttachedFileChip({
  file,
  onFileClick,
  onRemoveFile,
}: AttachedFileChipProps) {
  const Icon = getDocumentIcon(file.type, file.name)
  const isVideo = file.type.startsWith('video/')
  // Keyed off the type, not the presence of a preview: a HEIC has no preview until its
  // upload finishes, and flipping shape mid-upload would jump the layout.
  const isMedia = isVideo || file.type.startsWith('image/')
  const extension = getFileExtension(file.name)
  const [previewFailed, setPreviewFailed] = useState(false)

  return (
    <Tooltip.Root>
      <div className='group relative flex-shrink-0'>
        <Tooltip.Trigger asChild>
          <button
            type='button'
            className={cn(
              CHIP_SURFACE,
              isMedia
                ? 'w-[48px] overflow-hidden'
                : 'flex max-w-[220px] items-center gap-2 py-2 pr-3 pl-2'
            )}
            onClick={() => onFileClick(file)}
          >
            {isMedia ? (
              <>
                <span className='absolute inset-0 flex items-center justify-center text-[var(--text-icon)]'>
                  <Icon className='size-[18px]' />
                </span>
                {file.previewUrl &&
                  !previewFailed &&
                  (isVideo ? (
                    <video
                      src={file.previewUrl}
                      muted
                      playsInline
                      preload='metadata'
                      className='relative size-full object-cover'
                    />
                  ) : (
                    <img
                      src={file.previewUrl}
                      alt={file.name}
                      // A HEIC whose server-side transcode failed comes back as bytes the
                      // browser still cannot decode. Dropping the image reveals the type
                      // icon beneath instead of a broken glyph.
                      onError={() => setPreviewFailed(true)}
                      className='relative size-full object-cover'
                    />
                  ))}
              </>
            ) : (
              <>
                <span className='flex size-[32px] shrink-0 items-center justify-center rounded-[8px] bg-[var(--surface-6)] text-[var(--text-icon)] dark:bg-[var(--surface-3)]'>
                  <Icon className='size-[16px]' />
                </span>
                <span className='flex min-w-0 flex-col items-start'>
                  <span className='w-full truncate text-[var(--text-body)] text-small'>
                    {file.name}
                  </span>
                  {/* The name truncates, so the extension is genuinely not readable from
                      it — this is the format, not a restatement of the label. */}
                  {extension && (
                    <span className='text-[var(--text-muted)] text-xs uppercase'>{extension}</span>
                  )}
                </span>
              </>
            )}
            {file.uploading && (
              <span className='absolute inset-0 flex items-center justify-center rounded-[inherit] bg-[var(--surface-5)]/70 dark:bg-[var(--surface-4)]/70'>
                <Loader className='size-[14px] text-[var(--text-icon)]' animate />
              </span>
            )}
          </button>
        </Tooltip.Trigger>
        {!file.uploading && (
          <button
            type='button'
            onClick={(e) => {
              e.stopPropagation()
              onRemoveFile(file.id)
            }}
            aria-label={`Remove ${file.name}`}
            className='-top-[5px] -right-[5px] absolute flex size-[16px] items-center justify-center rounded-full border border-[var(--border)] bg-[var(--surface-6)] text-[var(--text-icon)] opacity-0 transition-opacity group-hover:opacity-100 dark:bg-[var(--surface-3)]'
          >
            <X className='size-[9px]' />
          </button>
        )}
      </div>
      <Tooltip.Content side='top'>
        <p className='max-w-[200px] truncate'>{file.name}</p>
      </Tooltip.Content>
    </Tooltip.Root>
  )
})

export const AttachedFilesList = React.memo(function AttachedFilesList({
  attachedFiles,
  onFileClick,
  onRemoveFile,
}: AttachedFilesListProps) {
  if (attachedFiles.length === 0) return null

  return (
    <div className='mb-1.5 flex flex-wrap items-center gap-1.5'>
      {attachedFiles.map((file) => (
        <AttachedFileChip
          key={file.id}
          file={file}
          onFileClick={onFileClick}
          onRemoveFile={onRemoveFile}
        />
      ))}
    </div>
  )
})
