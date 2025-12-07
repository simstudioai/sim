'use client'

import { useEffect, useRef, useState } from 'react'
import { AlertCircle, Check, Loader2, RotateCcw, X } from 'lucide-react'
import { useParams } from 'next/navigation'
import {
  Button,
  Label,
  Modal,
  ModalBody,
  ModalContent,
  ModalFooter,
  ModalHeader,
} from '@/components/emcn'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Progress } from '@/components/ui/progress'
import { cn } from '@/lib/core/utils/cn'
import { createLogger } from '@/lib/logs/console/logger'
import { formatFileSize, validateKnowledgeBaseFile } from '@/lib/uploads/utils/file-utils'
import { ACCEPT_ATTRIBUTE } from '@/lib/uploads/utils/validation'
import { useKnowledgeUpload } from '@/app/workspace/[workspaceId]/knowledge/hooks/use-knowledge-upload'

const logger = createLogger('AddDocumentsModal')

interface FileWithPreview extends File {
  preview: string
}

interface AddDocumentsModalProps {
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

export function AddDocumentsModal({
  open,
  onOpenChange,
  knowledgeBaseId,
  chunkingConfig,
  onUploadComplete,
}: AddDocumentsModalProps) {
  const params = useParams()
  const workspaceId = params.workspaceId as string
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [files, setFiles] = useState<FileWithPreview[]>([])
  const [fileError, setFileError] = useState<string | null>(null)
  const [isDragging, setIsDragging] = useState(false)
  const [dragCounter, setDragCounter] = useState(0)
  const [retryingIndexes, setRetryingIndexes] = useState<Set<number>>(new Set())

  const { isUploading, uploadProgress, uploadError, uploadFiles, clearError } = useKnowledgeUpload({
    workspaceId,
    onUploadComplete: () => {
      logger.info(`Successfully uploaded ${files.length} files`)
      onUploadComplete?.()
      handleClose()
    },
  })

  useEffect(() => {
    return () => {
      files.forEach((file) => {
        if (file.preview) {
          URL.revokeObjectURL(file.preview)
        }
      })
    }
  }, [files])

  useEffect(() => {
    if (open) {
      setFiles([])
      setFileError(null)
      setIsDragging(false)
      setDragCounter(0)
      setRetryingIndexes(new Set())
      clearError()
    }
  }, [open, clearError])

  const handleClose = () => {
    if (isUploading) return
    setFiles([])
    setFileError(null)
    clearError()
    setIsDragging(false)
    setDragCounter(0)
    setRetryingIndexes(new Set())
    onOpenChange(false)
  }

  const processFiles = async (fileList: FileList | File[]) => {
    setFileError(null)

    if (!fileList || fileList.length === 0) return

    try {
      const newFiles: FileWithPreview[] = []
      let hasError = false

      for (const file of Array.from(fileList)) {
        const validationError = validateKnowledgeBaseFile(file)
        if (validationError) {
          setFileError(validationError)
          hasError = true
          continue
        }

        const fileWithPreview = Object.assign(file, {
          preview: URL.createObjectURL(file),
        }) as FileWithPreview

        newFiles.push(fileWithPreview)
      }

      if (!hasError && newFiles.length > 0) {
        setFiles((prev) => [...prev, ...newFiles])
      }
    } catch (error) {
      logger.error('Error processing files:', error)
      setFileError('An error occurred while processing files. Please try again.')
    } finally {
      if (fileInputRef.current) {
        fileInputRef.current.value = ''
      }
    }
  }

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      await processFiles(e.target.files)
    }
  }

  const handleDragEnter = (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setDragCounter((prev) => {
      const newCount = prev + 1
      if (newCount === 1) {
        setIsDragging(true)
      }
      return newCount
    })
  }

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setDragCounter((prev) => {
      const newCount = prev - 1
      if (newCount === 0) {
        setIsDragging(false)
      }
      return newCount
    })
  }

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    e.dataTransfer.dropEffect = 'copy'
  }

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setIsDragging(false)
    setDragCounter(0)

    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      await processFiles(e.dataTransfer.files)
    }
  }

  const removeFile = (index: number) => {
    setFiles((prev) => {
      URL.revokeObjectURL(prev[index].preview)
      return prev.filter((_, i) => i !== index)
    })
  }

  const handleRetryFile = async (index: number) => {
    const fileToRetry = files[index]
    if (!fileToRetry) return

    setRetryingIndexes((prev) => new Set(prev).add(index))

    try {
      await uploadFiles([fileToRetry], knowledgeBaseId, {
        chunkSize: chunkingConfig?.maxSize || 1024,
        minCharactersPerChunk: chunkingConfig?.minSize || 1,
        chunkOverlap: chunkingConfig?.overlap || 200,
        recipe: 'default',
      })
      removeFile(index)
    } catch (error) {
      logger.error('Error retrying file upload:', error)
    } finally {
      setRetryingIndexes((prev) => {
        const newSet = new Set(prev)
        newSet.delete(index)
        return newSet
      })
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
    <Modal open={open} onOpenChange={handleClose}>
      <ModalContent>
        <ModalHeader>Add Documents</ModalHeader>

        <ModalBody className='!pb-[16px]'>
          <div className='min-h-0 flex-1 overflow-y-auto'>
            <div className='space-y-[12px]'>
              {uploadError && (
                <Alert variant='destructive'>
                  <AlertCircle className='h-4 w-4' />
                  <AlertTitle>Upload Error</AlertTitle>
                  <AlertDescription>{uploadError.message}</AlertDescription>
                </Alert>
              )}

              {fileError && !uploadError && (
                <Alert variant='destructive'>
                  <AlertCircle className='h-4 w-4' />
                  <AlertTitle>Error</AlertTitle>
                  <AlertDescription>{fileError}</AlertDescription>
                </Alert>
              )}

              <div className='flex flex-col gap-[8px]'>
                <Label>Upload Documents</Label>
                <Button
                  type='button'
                  variant='default'
                  onClick={() => fileInputRef.current?.click()}
                  onDragEnter={handleDragEnter}
                  onDragOver={handleDragOver}
                  onDragLeave={handleDragLeave}
                  onDrop={handleDrop}
                  className={cn(
                    '!bg-[var(--surface-1)] hover:!bg-[var(--surface-4)] w-full justify-center border border-[var(--c-575757)] border-dashed py-[10px]',
                    isDragging && 'border-[var(--brand-primary-hex)]'
                  )}
                >
                  <input
                    ref={fileInputRef}
                    type='file'
                    accept={ACCEPT_ATTRIBUTE}
                    onChange={handleFileChange}
                    className='hidden'
                    multiple
                  />
                  <div className='flex flex-col gap-[2px] text-center'>
                    <span className='text-[var(--text-primary)]'>
                      {isDragging ? 'Drop files here' : 'Drop files here or click to browse'}
                    </span>
                    <span className='text-[11px] text-[var(--text-tertiary)]'>
                      PDF, DOC, DOCX, TXT, CSV, XLS, XLSX, MD, PPT, PPTX, HTML (max 100MB each)
                    </span>
                  </div>
                </Button>
              </div>

              {files.length > 0 && (
                <div className='space-y-2'>
                  <Label>Selected Files</Label>
                  <div className='space-y-2'>
                    {files.map((file, index) => {
                      const fileStatus = uploadProgress.fileStatuses?.[index]
                      const isCurrentlyUploading = fileStatus?.status === 'uploading'
                      const isCompleted = fileStatus?.status === 'completed'
                      const isFailed = fileStatus?.status === 'failed'
                      const isRetrying = retryingIndexes.has(index)

                      return (
                        <div
                          key={index}
                          className='flex items-center justify-between rounded-[4px] border p-[8px]'
                        >
                          <div className='flex min-w-0 flex-1 items-center gap-2'>
                            {(isCurrentlyUploading || isRetrying) && (
                              <Loader2 className='h-4 w-4 flex-shrink-0 animate-spin text-[var(--brand-primary-hex)]' />
                            )}
                            {isCompleted && (
                              <Check className='h-4 w-4 flex-shrink-0 text-[var(--brand-tertiary)]' />
                            )}
                            {isFailed && !isRetrying && (
                              <AlertCircle className='h-4 w-4 flex-shrink-0 text-[var(--text-error)]' />
                            )}
                            <span
                              className={cn(
                                'max-w-[200px] truncate text-[12px]',
                                isFailed && !isRetrying && 'text-[var(--text-error)]'
                              )}
                              title={file.name}
                            >
                              {file.name}
                            </span>
                            <span className='flex-shrink-0 text-[11px] text-[var(--text-muted)]'>
                              {formatFileSize(file.size)}
                            </span>
                            {isCurrentlyUploading && (
                              <div className='min-w-0 max-w-24 flex-1'>
                                <Progress value={fileStatus?.progress || 0} className='h-1' />
                              </div>
                            )}
                          </div>
                          <div className='flex items-center gap-1'>
                            {isFailed && !isRetrying && (
                              <Button
                                type='button'
                                variant='ghost'
                                className='h-4 w-4 p-0 text-[var(--text-muted)] hover:text-[var(--text-primary)]'
                                onClick={() => handleRetryFile(index)}
                                disabled={isUploading}
                              >
                                <RotateCcw className='h-3.5 w-3.5' />
                              </Button>
                            )}
                            <Button
                              type='button'
                              variant='ghost'
                              className='h-4 w-4 p-0'
                              onClick={() => removeFile(index)}
                              disabled={isUploading || isRetrying}
                            >
                              <X className='h-3.5 w-3.5' />
                            </Button>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </div>
              )}
            </div>
          </div>
        </ModalBody>

        <ModalFooter>
          <Button variant='default' onClick={handleClose} type='button' disabled={isUploading}>
            Cancel
          </Button>
          <Button
            variant='primary'
            type='button'
            onClick={handleUpload}
            disabled={files.length === 0 || isUploading}
          >
            {isUploading
              ? uploadProgress.stage === 'uploading'
                ? `Uploading ${uploadProgress.filesCompleted}/${uploadProgress.totalFiles}...`
                : uploadProgress.stage === 'processing'
                  ? 'Processing...'
                  : 'Uploading...'
              : 'Upload'}
          </Button>
        </ModalFooter>
      </ModalContent>
    </Modal>
  )
}
