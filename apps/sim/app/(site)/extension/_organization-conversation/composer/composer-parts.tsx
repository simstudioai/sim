'use client'

import type { ReactNode } from 'react'
import { AttachedFilesList } from '@/components/mothership-chat/user-input/components/attached-files-list/attached-files-list'
import { DropOverlay } from '@/components/mothership-chat/user-input/components/drop-overlay/drop-overlay'
import { ASSISTANT_IMAGE_ACCEPT_ATTRIBUTE } from '@/lib/uploads/shared/assistant-images'
import { MOTHERSHIP_ACCEPT_ATTRIBUTE } from '@/lib/uploads/utils/validation'
import type { ConversationComposerProps } from '@/app/(site)/extension/_organization-conversation/composer/use-composer'

interface ComposerAttachmentsProps {
  files: ConversationComposerProps['files']
  additional?: ReactNode
}

/** The attached files, with whatever else the view attaches beside them. */
export function ComposerAttachments({ files, additional }: ComposerAttachmentsProps) {
  if (!files.attachedFiles.length && !additional) return null
  return (
    <AttachedFilesList
      attachedFiles={files.attachedFiles}
      onFileClick={files.handleFileClick}
      onRemoveFile={files.removeFile}
      additionalAttachments={additional}
    />
  )
}

interface ComposerFileTargetsProps {
  files: ConversationComposerProps['files']
  imagesOnly: boolean
}

/** The hidden picker and the drop overlay every composer view holds. */
export function ComposerFileTargets({ files, imagesOnly }: ComposerFileTargetsProps) {
  return (
    <>
      <input
        ref={files.fileInputRef}
        type='file'
        accept={imagesOnly ? ASSISTANT_IMAGE_ACCEPT_ATTRIBUTE : MOTHERSHIP_ACCEPT_ATTRIBUTE}
        onChange={files.handleFileChange}
        className='hidden'
        multiple
      />
      {files.isDragging && <DropOverlay imagesOnly={imagesOnly} />}
    </>
  )
}

/** Keeps the field below a quarter of a phone's viewport, and a screenful elsewhere. */
export const COMPOSER_FIELD_HEIGHT_CLASSES =
  'max-h-[200px] max-md:max-h-[min(200px,calc(var(--mobile-viewport-height,100dvh)*0.25))]'
