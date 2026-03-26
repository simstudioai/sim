'use client'

import React from 'react'
import { Loader2, X } from 'lucide-react'
import { Tooltip } from '@/components/emcn'
import { getDocumentIcon } from '@/components/icons/document-icons'
import type { AttachedFile } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/copilot/components/user-input/hooks/use-file-attachments'

interface AttachedFilesListProps {
  attachedFiles: AttachedFile[]
  onFileClick: (file: AttachedFile) => void
  onRemoveFile: (id: string) => void
}

export const AttachedFilesList = React.memo(function AttachedFilesList({
  attachedFiles,
  onFileClick,
  onRemoveFile,
}: AttachedFilesListProps) {
  if (attachedFiles.length === 0) return null

  return (
    <div className='mb-[6px] flex flex-wrap gap-[6px]'>
      {attachedFiles.map((file) => {
        const isImage = file.type.startsWith('image/')
        return (
          <Tooltip.Root key={file.id}>
            <Tooltip.Trigger asChild>
              <div
                className='group relative h-[56px] w-[56px] flex-shrink-0 cursor-pointer overflow-hidden rounded-[8px] border border-[var(--border-1)] bg-[var(--surface-5)] hover:bg-[var(--surface-4)]'
                onClick={() => onFileClick(file)}
              >
                {isImage && file.previewUrl ? (
                  <img
                    src={file.previewUrl}
                    alt={file.name}
                    className='h-full w-full object-cover'
                  />
                ) : (
                  <div className='flex h-full w-full flex-col items-center justify-center gap-[2px] text-[var(--text-icon)]'>
                    {(() => {
                      const Icon = getDocumentIcon(file.type, file.name)
                      return <Icon className='h-[18px] w-[18px]' />
                    })()}
                    <span className='max-w-[48px] truncate px-[2px] text-[9px] text-[var(--text-muted)]'>
                      {file.name.split('.').pop()}
                    </span>
                  </div>
                )}
                {file.uploading && (
                  <div className='absolute inset-0 flex items-center justify-center bg-black/50'>
                    <Loader2 className='h-[14px] w-[14px] animate-spin text-white' />
                  </div>
                )}
                {!file.uploading && (
                  <button
                    type='button'
                    onClick={(e) => {
                      e.stopPropagation()
                      onRemoveFile(file.id)
                    }}
                    className='absolute top-[2px] right-[2px] flex h-[16px] w-[16px] items-center justify-center rounded-full bg-black/60 opacity-0 group-hover:opacity-100'
                  >
                    <X className='h-[10px] w-[10px] text-white' />
                  </button>
                )}
              </div>
            </Tooltip.Trigger>
            <Tooltip.Content side='top'>
              <p className='max-w-[200px] truncate'>{file.name}</p>
            </Tooltip.Content>
          </Tooltip.Root>
        )
      })}
    </div>
  )
})
