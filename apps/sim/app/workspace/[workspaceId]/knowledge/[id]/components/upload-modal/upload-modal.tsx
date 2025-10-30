'use client'

import { useRef, useState } from 'react'
import { AlertCircle, Check, Loader2, X } from 'lucide-react'
import { useParams } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { Progress } from '@/components/ui/progress'
import { createLogger } from '@/lib/logs/console/logger'
import { formatFileSize, validateKnowledgeBaseFile } from '@/lib/uploads/utils/file-utils'
import { ACCEPT_ATTRIBUTE } from '@/lib/uploads/utils/validation'
import { getDocumentIcon } from '@/app/workspace/[workspaceId]/knowledge/components'
import { useKnowledgeUpload } from '@/app/workspace/[workspaceId]/knowledge/hooks/use-knowledge-upload'

const logger = createLogger('UploadModal')

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
  const params = useParams()
  const workspaceId = params.workspaceId as string
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [files, setFiles] = useState<FileWithPreview[]>([])

  const [fileError, setFileError] = useState<string | null>(null)
  const [isDragging, setIsDragging] = useState(false)

  const { isUploading, uploadProgress, uploadError, uploadFiles, clearError } = useKnowledgeUpload({
    workspaceId,
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
    clearError()
    setIsDragging(false)
    onOpenChange(false)
  }

  const validateFile = (file: File): string | null => {
    return validateKnowledgeBaseFile(file)
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

  const getFileIcon = (mimeType: string, filename: string) => {
    const IconComponent = getDocumentIcon(mimeType, filename)
    return <IconComponent className='h-10 w-8' />
  }

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className='flex max-h-[95vh] flex-col overflow-hidden sm:max-w-[600px]'>
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
                  accept={ACCEPT_ATTRIBUTE}
                  onChange={handleFileChange}
                  className='hidden'
                  multiple
                />
                <div className='space-y-2'>
                  <p className='font-medium text-sm'>
                    {isDragging ? 'Drop files here!' : 'Drop files here or click to browse'}
                  </p>
                  <p className='text-muted-foreground text-xs'>
                    Supports PDF, DOC, DOCX, TXT, CSV, XLS, XLSX, MD, PPT, PPTX, HTML, JSON, YAML,
                    YML (max 100MB each)
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
                    accept={ACCEPT_ATTRIBUTE}
                    onChange={handleFileChange}
                    className='hidden'
                    multiple
                  />
                  <p className='text-sm'>
                    {isDragging ? 'Drop more files here!' : 'Drop more files or click to browse'}
                  </p>
                </div>

                <div className='max-h-80 space-y-2 overflow-auto'>
                  {files.map((file, index) => {
                    const fileStatus = uploadProgress.fileStatuses?.[index]
                    const isCurrentlyUploading = fileStatus?.status === 'uploading'
                    const isCompleted = fileStatus?.status === 'completed'
                    const isFailed = fileStatus?.status === 'failed'

                    return (
                      <div key={index} className='rounded-md border p-3'>
                        <div className='flex items-center gap-3'>
                          {getFileIcon(file.type, file.name)}
                          <div className='min-w-0 flex-1'>
                            <div className='flex items-center gap-2'>
                              {isCurrentlyUploading && (
                                <Loader2 className='h-4 w-4 animate-spin text-[var(--brand-primary-hex)]' />
                              )}
                              {isCompleted && <Check className='h-4 w-4 text-green-500' />}
                              {isFailed && <X className='h-4 w-4 text-red-500' />}
                              <p className='truncate font-medium text-sm'>{file.name}</p>
                            </div>
                            <div className='flex items-center gap-2'>
                              <p className='text-muted-foreground text-xs'>
                                {formatFileSize(file.size)}
                              </p>
                              {isCurrentlyUploading && (
                                <div className='min-w-0 max-w-32 flex-1'>
                                  <Progress value={fileStatus?.progress || 0} className='h-1' />
                                </div>
                              )}
                            </div>
                            {isFailed && fileStatus?.error && (
                              <p className='mt-1 text-red-500 text-xs'>{fileStatus.error}</p>
                            )}
                          </div>
                          <Button
                            type='button'
                            variant='ghost'
                            size='sm'
                            onClick={() => removeFile(index)}
                            disabled={isUploading}
                            className='h-8 w-8 p-0 text-muted-foreground hover:text-destructive'
                          >
                            <X className='h-4 w-4' />
                          </Button>
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>
            )}

            {/* Show upload error first, then file error only if no upload error */}
            {uploadError && (
              <div className='rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2'>
                <div className='flex items-start gap-2'>
                  <AlertCircle className='mt-0.5 h-4 w-4 shrink-0 text-destructive' />
                  <div className='flex-1 text-destructive text-sm'>{uploadError.message}</div>
                </div>
              </div>
            )}

            {fileError && !uploadError && (
              <div className='rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-destructive text-sm'>
                {fileError}
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className='flex justify-between border-t pt-4'>
          <div className='flex gap-3' />
          <div className='flex gap-3'>
            <Button variant='outline' onClick={handleClose} disabled={isUploading}>
              Cancel
            </Button>
            <Button
              onClick={handleUpload}
              disabled={files.length === 0 || isUploading}
              className='bg-[var(--brand-primary-hex)] font-[480] text-primary-foreground shadow-[0_0_0_0_var(--brand-primary-hex)] transition-all duration-200 hover:bg-[var(--brand-primary-hover-hex)] hover:shadow-[0_0_0_4px_rgba(127,47,255,0.15)]'
            >
              {isUploading
                ? uploadProgress.stage === 'uploading'
                  ? `Uploading ${uploadProgress.filesCompleted + 1}/${uploadProgress.totalFiles}...`
                  : uploadProgress.stage === 'processing'
                    ? 'Processing...'
                    : 'Uploading...'
                : `Upload ${files.length} file${files.length !== 1 ? 's' : ''}`}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
