'use client'

import { useCallback, useEffect, useState } from 'react'
import { createLogger } from '@sim/logger'
import {
  Button,
  Input,
  Modal,
  ModalBody,
  ModalContent,
  ModalFooter,
  ModalHeader,
} from '@/components/emcn'
import { getFileExtension, getMimeTypeFromExtension } from '@/lib/uploads/utils/file-utils'
import { useUploadWorkspaceFile } from '@/hooks/queries/workspace-files'

const logger = createLogger('CreateFileModal')

interface CreateFileModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onCreated: (fileId: string) => void
  workspaceId: string
}

export function CreateFileModal({
  open,
  onOpenChange,
  onCreated,
  workspaceId,
}: CreateFileModalProps) {
  const uploadFile = useUploadWorkspaceFile()

  const [filename, setFilename] = useState('untitled.md')
  const [error, setError] = useState('')

  const handleCreate = useCallback(async () => {
    const trimmed = filename.trim()
    if (!trimmed) {
      setError('Filename is required')
      return
    }

    if (!trimmed.includes('.')) {
      setError('Filename must have an extension')
      return
    }

    setError('')

    try {
      const ext = getFileExtension(trimmed)
      const mimeType = getMimeTypeFromExtension(ext)
      const blob = new Blob([''], { type: mimeType })
      const file = new File([blob], trimmed, { type: mimeType })

      const result = await uploadFile.mutateAsync({ workspaceId, file })
      const fileId = result.file?.id

      if (fileId) {
        onOpenChange(false)
        onCreated(fileId)
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to create file'
      setError(message)
      logger.error('Failed to create file:', err)
    }
  }, [filename, workspaceId, onOpenChange, onCreated])

  useEffect(() => {
    if (open) {
      setFilename('untitled.md')
      setError('')
    }
  }, [open])

  return (
    <Modal open={open} onOpenChange={onOpenChange}>
      <ModalContent size='sm'>
        <ModalHeader>New file</ModalHeader>
        <ModalBody>
          <div className='flex flex-col gap-[8px]'>
            <label
              htmlFor='create-file-name'
              className='font-medium text-[13px] text-[var(--text-body)]'
            >
              Filename
            </label>
            <Input
              id='create-file-name'
              value={filename}
              onChange={(e) => {
                setFilename(e.target.value)
                setError('')
              }}
              placeholder='untitled.md'
              autoFocus
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  handleCreate()
                }
              }}
            />
          </div>
        </ModalBody>
        <ModalFooter>
          <div className='flex w-full items-center justify-between gap-[12px]'>
            {error && <p className='min-w-0 truncate text-[12px] text-red-500'>{error}</p>}
            <div className='ml-auto flex flex-shrink-0 gap-[8px]'>
              <Button variant='outline' onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button onClick={handleCreate} disabled={uploadFile.isPending}>
                {uploadFile.isPending ? 'Creating...' : 'Create'}
              </Button>
            </div>
          </div>
        </ModalFooter>
      </ModalContent>
    </Modal>
  )
}
