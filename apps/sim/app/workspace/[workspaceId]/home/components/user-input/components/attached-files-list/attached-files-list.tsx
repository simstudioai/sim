'use client'

import React, { useState } from 'react'
import { cn, Loader, Tooltip } from '@sim/emcn'
import { X } from '@sim/emcn/icons'
import { getDocumentIcon } from '@/components/icons/document-icons'
import { getFileExtension } from '@/lib/uploads/utils/file-utils'
import type { AttachedFile } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/copilot/components/user-input/hooks/use-file-attachments'

/**
 * Chrome shared by both chip shapes. Both stand 48px tall so a row mixing thumbnails
 * and documents sits on one baseline.
 *
 * Deliberately NOT `chipFilledFillTokens` (`--surface-5` / `dark:--surface-4`): that
 * pair assumes a page background, but this chip sits inside the composer, which is
 * already `--surface-4` in dark mode — reusing it would make the chip invisible against
 * its own container. `--surface-5` steps away from the composer in both themes, and
 * hover steps further away in the direction each theme reads as "raised".
 */
const CHIP_SURFACE =
  'relative cursor-pointer rounded-lg border border-[var(--border)] bg-[var(--surface-5)] transition-colors hover-hover:bg-[var(--surface-active)] dark:hover-hover:bg-[var(--surface-6)]'

/** Height lives on the wrapper so both shapes are the same size by construction. */
const CHIP_HEIGHT = 'h-[48px]'

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
      {/* Both the size and the width cap live here, not on the button: this wrapper
          anchors the remove badge, so sizing it to the button's uncapped max-content
          width would strand the badge far to the right of a long filename. */}
      <div
        className={cn(
          'group relative',
          CHIP_HEIGHT,
          isMedia ? 'w-[48px] shrink-0' : 'min-w-0 max-w-[min(220px,100%)]'
        )}
      >
        <Tooltip.Trigger asChild>
          <button
            type='button'
            className={cn(
              CHIP_SURFACE,
              'size-full',
              isMedia
                ? 'overflow-hidden'
                : // `pr-5` reserves room for the remove badge so it never sits over the
                  // filename.
                  'flex items-center gap-2 py-2 pr-5 pl-2'
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
                {/* Steps again on hover: the chip's own hover fill closes to within
                    7/255 of this badge in light mode, which would erase it during the
                    one interaction where it is being looked at. */}
                <span className='flex size-[32px] shrink-0 items-center justify-center rounded-md bg-[var(--surface-6)] text-[var(--text-icon)] transition-colors group-hover:bg-[var(--surface-7)] dark:bg-[var(--surface-3)] dark:group-hover:bg-[var(--surface-3)]'>
                  <Icon className='size-[16px]' />
                </span>
                <span className='flex min-w-0 flex-col items-start'>
                  <span className='w-full truncate text-[var(--text-body)] text-small leading-tight'>
                    {file.name}
                  </span>
                  {/* The name truncates from the tail, so the extension is often not
                      readable from it — this is the format, not a restatement.
                      `--text-icon`, not `--text-muted`: muted lands at 2.4:1 on this
                      fill in dark mode, well under AA. */}
                  {extension && (
                    <span className='text-[var(--text-icon)] text-caption uppercase leading-tight'>
                      {extension}
                    </span>
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
            // Opaque, not a translucent scrim: a semi-transparent fill composites with
            // whatever sits under it, so the same badge reads differently over a light
            // card than over a photo. An opaque surface plus a border keeps the glyph
            // contrast fixed and gives the badge an edge against any thumbnail.
            className='absolute top-[2px] right-[2px] flex size-[16px] items-center justify-center rounded-full border border-[var(--border)] bg-[var(--surface-1)] text-[var(--text-body)] opacity-0 transition-opacity group-hover:opacity-100'
          >
            <X className='size-[9px]' />
          </button>
        )}
      </div>
      {/* No width or truncation here — Tooltip.Content already caps and wraps, and this
          exists precisely to reveal the name the card truncated. */}
      <Tooltip.Content>{file.name}</Tooltip.Content>
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
