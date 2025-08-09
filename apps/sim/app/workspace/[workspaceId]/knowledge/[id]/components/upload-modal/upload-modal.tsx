'use client'

import { useRef, useState } from 'react'
import { X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { createLogger } from '@/lib/logs/console/logger'
import { useKnowledgeUpload } from '@/app/workspace/[workspaceId]/knowledge/hooks/use-knowledge-upload'

const logger = createLogger('UploadModal')

const MAX_FILE_SIZE = 100 * 1024 * 1024 // 100MB
const ACCEPTED_FILE_TYPES = [
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'text/plain',
  'text/csv',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
]

interface FileWithPreview extends File {
  preview: string
}

interface UploadModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  knowledgeBaseId: string
  chunkingConfig?: {
    maxSize: number
    minSize: number
    overlap: number
  }
  onUploadComplete?: () => void
}

export function UploadModal({
  open,
  onOpenChange,
  knowledgeBaseId,
  chunkingConfig,
  onUploadComplete,
}: UploadModalProps) {
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [files, setFiles] = useState<FileWithPreview[]>([])

  const [fileError, setFileError] = useState<string | null>(null)
  const [isDragging, setIsDragging] = useState(false)

  const { isUploading, uploadProgress, uploadFiles } = useKnowledgeUpload({
    onUploadComplete: () => {
      logger.info(`Successfully uploaded ${files.length} files`)
      onUploadComplete?.()
      handleClose()
    },
  })

  const handleClose = () => {
    if (isUploading) return // Prevent closing during upload

    setFiles([])
    setFileError(null)
    setIsDragging(false)
    onOpenChange(false)
  }

  const validateFile = (file: File): string | null => {
    if (file.size > MAX_FILE_SIZE) {
      return `File "${file.name}" is too large. Maximum size is 100MB.`
    }
    if (!ACCEPTED_FILE_TYPES.includes(file.type)) {
      return `File "${file.name}" has an unsupported format. Please use PDF, DOC, DOCX, TXT, CSV, XLS, or XLSX files.`
    }
    return null
  }

  const processFiles = (fileList: FileList | File[]) => {
    setFileError(null)
    const newFiles: FileWithPreview[] = []

    for (const file of Array.from(fileList)) {
      const error = validateFile(file)
      if (error) {
        setFileError(error)
        return
      }

      const fileWithPreview = Object.assign(file, {
        preview: URL.createObjectURL(file),
      })
      newFiles.push(fileWithPreview)
    }

    setFiles((prev) => [...prev, ...newFiles])
  }

  const removeFile = (index: number) => {
    setFiles((prev) => {
      const newFiles = [...prev]
      const removedFile = newFiles.splice(index, 1)[0]
      if (removedFile.preview) {
        URL.revokeObjectURL(removedFile.preview)
      }
      return newFiles
    })
  }

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      processFiles(e.target.files)
    }
  }

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setIsDragging(true)
  }

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setIsDragging(false)
  }

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setIsDragging(false)

    if (e.dataTransfer.files) {
      processFiles(e.dataTransfer.files)
    }
  }

  const handleUpload = async () => {
    if (files.length === 0) return

    try {
      await uploadFiles(files, knowledgeBaseId, {
        chunkSize: chunkingConfig?.maxSize || 1024,
        minCharactersPerChunk: chunkingConfig?.minSize || 1,
        chunkOverlap: chunkingConfig?.overlap || 200,
        recipe: 'default',
      })
    } catch (error) {
      logger.error('Error uploading files:', error)
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className='flex max-h-[90vh] max-w-2xl flex-col overflow-hidden'>
        <DialogHeader>
          <DialogTitle>Upload Documents</DialogTitle>
        </DialogHeader>

        <div className='flex-1 space-y-6 overflow-auto'>
          {/* File Upload Section */}
          <div className='space-y-3'>
            <Label>Select Files</Label>

            {files.length === 0 ? (
              <div
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
                onDrop={handleDrop}
                onClick={() => fileInputRef.current?.click()}
                className={`relative flex cursor-pointer items-center justify-center rounded-lg border-2 border-dashed p-8 text-center transition-colors ${
                  isDragging
                    ? 'border-primary bg-primary/5'
                    : 'border-muted-foreground/25 hover:border-muted-foreground/40 hover:bg-muted/10'
                }`}
              >
                <input
                  ref={fileInputRef}
                  type='file'
                  accept={ACCEPTED_FILE_TYPES.join(',')}
                  onChange={handleFileChange}
                  className='hidden'
                  multiple
                />
                <div className='space-y-2'>
                  <p className='font-medium text-sm'>
                    {isDragging ? 'Drop files here!' : 'Drop files here or click to browse'}
                  </p>
                  <p className='text-muted-foreground text-xs'>
                    Supports PDF, DOC, DOCX, TXT, CSV, XLS, XLSX (max 100MB each)
                  </p>
                </div>
              </div>
            ) : (
              <div className='space-y-2'>
                <div
                  onDragOver={handleDragOver}
                  onDragLeave={handleDragLeave}
                  onDrop={handleDrop}
                  onClick={() => fileInputRef.current?.click()}
                  className={`cursor-pointer rounded-md border border-dashed p-3 text-center transition-colors ${
                    isDragging
                      ? 'border-primary bg-primary/5'
                      : 'border-muted-foreground/25 hover:border-muted-foreground/40'
                  }`}
                >
                  <input
                    ref={fileInputRef}
                    type='file'
                    accept={ACCEPTED_FILE_TYPES.join(',')}
                    onChange={handleFileChange}
                    className='hidden'
                    multiple
                  />
                  <p className='text-sm'>
                    {isDragging ? 'Drop more files here!' : 'Add more files'}
                  </p>
                </div>

                <div className='max-h-40 space-y-2 overflow-auto'>
                  {files.map((file, index) => (
                    <div
                      key={index}
                      className='flex items-center justify-between rounded-md border p-3'
                    >
                      <div className='min-w-0 flex-1'>
                        <p className='truncate font-medium text-sm'>{file.name}</p>
                        <p className='text-muted-foreground text-xs'>
                          {(file.size / 1024 / 1024).toFixed(2)} MB
                        </p>
                      </div>
                      <Button
                        type='button'
                        variant='ghost'
                        size='sm'
                        onClick={() => removeFile(index)}
                        disabled={isUploading}
                        className='h-8 w-8 p-0'
                      >
                        <X className='h-4 w-4' />
                      </Button>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {fileError && <p className='text-destructive text-sm'>{fileError}</p>}
          </div>
        </div>

        {/* Footer */}
        <div className='flex justify-end gap-3 border-t pt-4'>
          <Button variant='outline' onClick={handleClose} disabled={isUploading}>
            Cancel
          </Button>
          <Button onClick={handleUpload} disabled={files.length === 0 || isUploading}>
            {isUploading
              ? uploadProgress.stage === 'uploading'
                ? `Uploading ${uploadProgress.filesCompleted + 1}/${uploadProgress.totalFiles}...`
                : uploadProgress.stage === 'processing'
                  ? 'Processing...'
                  : 'Uploading...'
              : `Upload ${files.length} file${files.length !== 1 ? 's' : ''}`}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
