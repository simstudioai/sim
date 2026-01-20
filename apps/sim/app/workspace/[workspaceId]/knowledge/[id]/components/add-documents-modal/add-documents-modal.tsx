'use client'

import { useEffect, useRef, useState } from 'react'
import { createLogger } from '@sim/logger'
import { Loader2, RotateCcw, X } from 'lucide-react'
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
import { cn } from '@/lib/core/utils/cn'
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
}

export function AddDocumentsModal({
  open,
  onOpenChange,
  knowledgeBaseId,
  chunkingConfig,
}: AddDocumentsModalProps) {
  const params = useParams()
  const workspaceId = params.workspaceId as string
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [files, setFiles] = useState<FileWithPreview[]>([])
  const [fileError, setFileError] = useState<string | null>(null)
  const [isDragging, setIsDragging] = useState(false)
  const [dragCounter, setDragCounter] = useState(0)
  const [retryingIndexes, setRetryingIndexes] = useState<Set<number>>(new Set())

  const { isUploading, uploadProgress, uploadFiles, uploadError, clearError } = useKnowledgeUpload({
    workspaceId,
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
      logger.info(`Successfully uploaded ${files.length} files`)
      handleClose()
    } catch (error) {
      logger.error('Error uploading files:', error)
    }
  }

  return (
    <Modal open={open} onOpenChange={handleClose}>
      <ModalContent size='md'>
        <ModalHeader>Add Documents</ModalHeader>

        <ModalBody>
          <div className='min-h-0 flex-1 overflow-y-auto'>
            <div className='space-y-[12px]'>
              {fileError && (
                <p className='text-[12px] text-[var(--text-error)] leading-tight'>{fileError}</p>
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
                    '!bg-[var(--surface-1)] hover:!bg-[var(--surface-4)] w-full justify-center border border-[var(--border-1)] border-dashed py-[10px]',
                    isDragging && 'border-[var(--surface-7)]'
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
                      const isFailed = fileStatus?.status === 'failed'
                      const isRetrying = retryingIndexes.has(index)
                      const isProcessing = fileStatus?.status === 'uploading' || isRetrying

                      return (
                        <div
                          key={index}
                          className={cn(
                            'flex items-center gap-2 rounded-[4px] border p-[8px]',
                            isFailed && !isRetrying && 'border-[var(--text-error)]'
                          )}
                        >
                          <span
                            className={cn(
                              'min-w-0 flex-1 truncate text-[12px]',
                              isFailed && !isRetrying && 'text-[var(--text-error)]'
                            )}
                            title={file.name}
                          >
                            {file.name}
                          </span>
                          <span className='flex-shrink-0 text-[11px] text-[var(--text-muted)]'>
                            {formatFileSize(file.size)}
                          </span>
                          <div className='flex flex-shrink-0 items-center gap-1'>
                            {isProcessing ? (
                              <Loader2 className='h-4 w-4 animate-spin text-[var(--text-muted)]' />
                            ) : (
                              <>
                                {isFailed && (
                                  <Button
                                    type='button'
                                    variant='ghost'
                                    className='h-4 w-4 p-0'
                                    onClick={() => handleRetryFile(index)}
                                    disabled={isUploading}
                                  >
                                    <RotateCcw className='h-3 w-3' />
                                  </Button>
                                )}
                                <Button
                                  type='button'
                                  variant='ghost'
                                  className='h-4 w-4 p-0'
                                  onClick={() => removeFile(index)}
                                  disabled={isUploading}
                                >
                                  <X className='h-3.5 w-3.5' />
                                </Button>
                              </>
                            )}
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
          <div className='flex w-full items-center justify-between gap-[12px]'>
            {uploadError ? (
              <p className='min-w-0 flex-1 truncate text-[12px] text-[var(--text-error)] leading-tight'>
                {uploadError.message}
              </p>
            ) : (
              <div />
            )}
            <div className='flex flex-shrink-0 gap-[8px]'>
              <Button variant='default' onClick={handleClose} type='button' disabled={isUploading}>
                Cancel
              </Button>
              <Button
                variant='tertiary'
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
            </div>
          </div>
        </ModalFooter>
      </ModalContent>
    </Modal>
  )
}
