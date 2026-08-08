'use client'

import React, { useState } from 'react'
import { cn, Loader } from '@sim/emcn'
import { X } from '@sim/emcn/icons'
import { getDocumentIcon } from '@/components/icons/document-icons'
import { getFileExtension } from '@/lib/uploads/utils/file-utils'
import type { AttachedFile } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/copilot/components/user-input/hooks/use-file-attachments'

/**
 * Chrome shared by both chip shapes. Not `chipFilledFillTokens` — its dark fill is
 * `--surface-4`, which is the composer's own background.
 */
const CHIP_SURFACE =
  'relative cursor-pointer rounded-lg border border-[var(--border)] bg-[var(--surface-5)] transition-colors hover-hover:bg-[var(--surface-active)] dark:hover-hover:bg-[var(--surface-6)]'

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
 * One attachment: media renders as a thumbnail, anything else as a labelled card.
 * Shape keys off the media type, not preview presence — a HEIC has no preview until its
 * server derivative lands, and flipping shape mid-upload would jump the layout.
 */
const AttachedFileChip = React.memo(function AttachedFileChip({
  file,
  onFileClick,
  onRemoveFile,
}: AttachedFileChipProps) {
  const Icon = getDocumentIcon(file.type, file.name)
  const isVideo = file.type.startsWith('video/')
  const isMedia = isVideo || file.type.startsWith('image/')
  const extension = getFileExtension(file.name)
  const [previewFailed, setPreviewFailed] = useState(false)

  return (
    /* Owns the width cap: it anchors the remove badge, which a max-content button would strand. */
    <div
      className={cn(
        'group relative',
        isMedia ? 'size-[48px] shrink-0' : 'h-[48px] min-w-0 max-w-[min(220px,100%)]'
      )}
    >
      <button
        type='button'
        className={cn(
          CHIP_SURFACE,
          'size-full',
          isMedia ? 'overflow-hidden' : 'flex items-center gap-2 py-[7px] pr-5 pl-2'
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
                  onError={() => setPreviewFailed(true)}
                  className='relative size-full object-cover'
                />
              ))}
          </>
        ) : (
          <>
            {/* Fill is constant — the chip's own hover is the only hover affordance. It
                sits a step below `--surface-6` in light mode so the chip's hover fill
                (`--surface-active`) cannot close on it. */}
            <span className='flex size-[32px] shrink-0 items-center justify-center rounded-md bg-[var(--surface-7)] text-[var(--text-icon)] dark:bg-[var(--surface-3)]'>
              <Icon className='size-[16px]' />
            </span>
            <span className='flex min-w-0 flex-col items-start'>
              <span className='w-full truncate text-[var(--text-body)] text-small leading-tight'>
                {file.name}
              </span>
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
      {!file.uploading && (
        <button
          type='button'
          onClick={(e) => {
            e.stopPropagation()
            onRemoveFile(file.id)
          }}
          aria-label={`Remove ${file.name}`}
          /* Always visible: reveal-on-hover would hide it from touch and from keyboard
             focus, and `hover-hover` cannot express "while the chip is hovered" from
             here anyway — it carries its own `&:hover`, so it binds to this element. */
          className='absolute top-[2px] right-[2px] flex size-[16px] items-center justify-center rounded-full border border-[var(--border)] bg-[var(--surface-2)] text-[var(--text-body)]'
        >
          <X className='size-[10px]' />
        </button>
      )}
    </div>
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
