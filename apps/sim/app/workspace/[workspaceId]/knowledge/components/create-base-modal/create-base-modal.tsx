'use client'

import { useEffect, useRef, useState } from 'react'
import { zodResolver } from '@hookform/resolvers/zod'
import { AlertCircle, Loader2, RotateCcw, X } from 'lucide-react'
import { useParams } from 'next/navigation'
import { useForm } from 'react-hook-form'
import { z } from 'zod'
import { Button, Input, Label, Textarea } from '@/components/emcn'
import {
  Modal,
  ModalBody,
  ModalContent,
  ModalFooter,
  ModalHeader,
} from '@/components/emcn/components/modal/modal'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { cn } from '@/lib/core/utils/cn'
import { createLogger } from '@/lib/logs/console/logger'
import { formatFileSize, validateKnowledgeBaseFile } from '@/lib/uploads/utils/file-utils'
import { ACCEPT_ATTRIBUTE } from '@/lib/uploads/utils/validation'
import { useKnowledgeUpload } from '@/app/workspace/[workspaceId]/knowledge/hooks/use-knowledge-upload'
import type { KnowledgeBaseData } from '@/stores/knowledge/store'

const logger = createLogger('CreateBaseModal')

interface FileWithPreview extends File {
  preview: string
}

interface CreateBaseModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onKnowledgeBaseCreated?: (knowledgeBase: KnowledgeBaseData) => void
}

const FormSchema = z
  .object({
    name: z
      .string()
      .min(1, 'Name is required')
      .max(100, 'Name must be less than 100 characters')
      .refine((value) => value.trim().length > 0, 'Name cannot be empty'),
    description: z.string().max(500, 'Description must be less than 500 characters').optional(),
    minChunkSize: z
      .number()
      .min(1, 'Min chunk size must be at least 1')
      .max(2000, 'Min chunk size must be less than 2000'),
    maxChunkSize: z
      .number()
      .min(100, 'Max chunk size must be at least 100')
      .max(4000, 'Max chunk size must be less than 4000'),
    overlapSize: z
      .number()
      .min(0, 'Overlap size must be non-negative')
      .max(500, 'Overlap size must be less than 500'),
  })
  .refine((data) => data.minChunkSize < data.maxChunkSize, {
    message: 'Min chunk size must be less than max chunk size',
    path: ['minChunkSize'],
  })

type FormValues = z.infer<typeof FormSchema>

interface SubmitStatus {
  type: 'success' | 'error'
  message: string
}

export function CreateBaseModal({
  open,
  onOpenChange,
  onKnowledgeBaseCreated,
}: CreateBaseModalProps) {
  const params = useParams()
  const workspaceId = params.workspaceId as string

  const fileInputRef = useRef<HTMLInputElement>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [submitStatus, setSubmitStatus] = useState<SubmitStatus | null>(null)
  const [files, setFiles] = useState<FileWithPreview[]>([])
  const [fileError, setFileError] = useState<string | null>(null)
  const [isDragging, setIsDragging] = useState(false)
  const [dragCounter, setDragCounter] = useState(0)
  const [retryingIndexes, setRetryingIndexes] = useState<Set<number>>(new Set())

  const scrollContainerRef = useRef<HTMLDivElement>(null)

  const { uploadFiles, isUploading, uploadProgress, clearError } = useKnowledgeUpload({
    workspaceId,
    onUploadComplete: (uploadedFiles) => {
      logger.info(`Successfully uploaded ${uploadedFiles.length} files`)
    },
  })

  const handleClose = (open: boolean) => {
    if (!open) {
      clearError()
    }
    onOpenChange(open)
  }

  useEffect(() => {
    return () => {
      files.forEach((file) => {
        if (file.preview) {
          URL.revokeObjectURL(file.preview)
        }
      })
    }
  }, [files])

  const {
    register,
    handleSubmit,
    reset,
    watch,
    formState: { errors },
  } = useForm<FormValues>({
    resolver: zodResolver(FormSchema),
    defaultValues: {
      name: '',
      description: '',
      minChunkSize: 1,
      maxChunkSize: 1024,
      overlapSize: 200,
    },
    mode: 'onSubmit',
  })

  const nameValue = watch('name')

  useEffect(() => {
    if (open) {
      setSubmitStatus(null)
      setFileError(null)
      setFiles([])
      setIsDragging(false)
      setDragCounter(0)
      setRetryingIndexes(new Set())
      reset({
        name: '',
        description: '',
        minChunkSize: 1,
        maxChunkSize: 1024,
        overlapSize: 200,
      })
    }
  }, [open, reset])

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

  const onSubmit = async (data: FormValues) => {
    setIsSubmitting(true)
    setSubmitStatus(null)

    try {
      const knowledgeBasePayload = {
        name: data.name,
        description: data.description || undefined,
        workspaceId: workspaceId,
        chunkingConfig: {
          maxSize: data.maxChunkSize,
          minSize: data.minChunkSize,
          overlap: data.overlapSize,
        },
      }

      const response = await fetch('/api/knowledge', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(knowledgeBasePayload),
      })

      if (!response.ok) {
        const errorData = await response.json()
        throw new Error(errorData.error || 'Failed to create knowledge base')
      }

      const result = await response.json()

      if (!result.success) {
        throw new Error(result.error || 'Failed to create knowledge base')
      }

      const newKnowledgeBase = result.data

      if (files.length > 0) {
        newKnowledgeBase.docCount = files.length

        if (onKnowledgeBaseCreated) {
          onKnowledgeBaseCreated(newKnowledgeBase)
        }

        const uploadedFiles = await uploadFiles(files, newKnowledgeBase.id, {
          chunkSize: data.maxChunkSize,
          minCharactersPerChunk: data.minChunkSize,
          chunkOverlap: data.overlapSize,
          recipe: 'default',
        })

        logger.info(`Successfully uploaded ${uploadedFiles.length} files`)
        logger.info(`Started processing ${uploadedFiles.length} documents in the background`)
      } else {
        if (onKnowledgeBaseCreated) {
          onKnowledgeBaseCreated(newKnowledgeBase)
        }
      }

      files.forEach((file) => URL.revokeObjectURL(file.preview))
      setFiles([])

      handleClose(false)
    } catch (error) {
      logger.error('Error creating knowledge base:', error)
      setSubmitStatus({
        type: 'error',
        message: error instanceof Error ? error.message : 'An unknown error occurred',
      })
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <Modal open={open} onOpenChange={handleClose}>
      <ModalContent>
        <ModalHeader>Create Knowledge Base</ModalHeader>

        <form onSubmit={handleSubmit(onSubmit)} className='flex min-h-0 flex-1 flex-col'>
          <ModalBody className='!pb-[16px]'>
            <div ref={scrollContainerRef} className='min-h-0 flex-1 overflow-y-auto'>
              <div className='space-y-[12px]'>
                {submitStatus && submitStatus.type === 'error' && (
                  <Alert variant='destructive'>
                    <AlertCircle className='h-4 w-4' />
                    <AlertTitle>Error</AlertTitle>
                    <AlertDescription>{submitStatus.message}</AlertDescription>
                  </Alert>
                )}

                <div className='flex flex-col gap-[8px]'>
                  <Label htmlFor='name'>Name</Label>
                  <Input
                    id='name'
                    placeholder='Enter knowledge base name'
                    {...register('name')}
                    className={cn(errors.name && 'border-[var(--text-error)]')}
                  />
                </div>

                <div className='flex flex-col gap-[8px]'>
                  <Label htmlFor='description'>Description</Label>
                  <Textarea
                    id='description'
                    placeholder='Describe this knowledge base (optional)'
                    rows={3}
                    {...register('description')}
                    className={cn(errors.description && 'border-[var(--text-error)]')}
                  />
                </div>

                <div className='space-y-[12px] rounded-[6px] bg-[var(--surface-6)] px-[12px] py-[14px]'>
                  <div className='grid grid-cols-2 gap-[12px]'>
                    <div className='flex flex-col gap-[8px]'>
                      <Label htmlFor='minChunkSize'>Min Chunk Size</Label>
                      <Input
                        id='minChunkSize'
                        placeholder='1'
                        {...register('minChunkSize', { valueAsNumber: true })}
                        className={cn(errors.minChunkSize && 'border-[var(--text-error)]')}
                        autoComplete='off'
                        data-form-type='other'
                        name='min-chunk-size'
                      />
                    </div>

                    <div className='flex flex-col gap-[8px]'>
                      <Label htmlFor='maxChunkSize'>Max Chunk Size</Label>
                      <Input
                        id='maxChunkSize'
                        placeholder='1024'
                        {...register('maxChunkSize', { valueAsNumber: true })}
                        className={cn(errors.maxChunkSize && 'border-[var(--text-error)]')}
                        autoComplete='off'
                        data-form-type='other'
                        name='max-chunk-size'
                      />
                    </div>
                  </div>

                  <div className='flex flex-col gap-[8px]'>
                    <Label htmlFor='overlapSize'>Overlap Size</Label>
                    <Input
                      id='overlapSize'
                      placeholder='200'
                      {...register('overlapSize', { valueAsNumber: true })}
                      className={cn(errors.overlapSize && 'border-[var(--text-error)]')}
                      autoComplete='off'
                      data-form-type='other'
                      name='overlap-size'
                    />
                  </div>
                </div>

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
                        const isFailed = fileStatus?.status === 'failed'
                        const isRetrying = retryingIndexes.has(index)
                        const isProcessing = fileStatus?.status === 'uploading' || isRetrying

                        return (
                          <div
                            key={index}
                            className='flex items-center gap-2 rounded-[4px] border p-[8px]'
                          >
                            {isFailed && !isRetrying && (
                              <AlertCircle className='h-4 w-4 flex-shrink-0 text-[var(--text-error)]' />
                            )}
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
                              {isFailed && !isRetrying && (
                                <Button
                                  type='button'
                                  variant='ghost'
                                  className='h-4 w-4 p-0 text-[var(--text-muted)] hover:text-[var(--text-primary)]'
                                  onClick={() => {
                                    setRetryingIndexes((prev) => new Set(prev).add(index))
                                    removeFile(index)
                                  }}
                                  disabled={isUploading}
                                >
                                  <RotateCcw className='h-3.5 w-3.5' />
                                </Button>
                              )}
                              {isProcessing ? (
                                <Loader2 className='h-4 w-4 animate-spin text-[var(--text-muted)]' />
                              ) : (
                                <Button
                                  type='button'
                                  variant='ghost'
                                  className='h-4 w-4 p-0'
                                  onClick={() => removeFile(index)}
                                  disabled={isUploading}
                                >
                                  <X className='h-3.5 w-3.5' />
                                </Button>
                              )}
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  </div>
                )}

                {fileError && (
                  <Alert variant='destructive'>
                    <AlertCircle className='h-4 w-4' />
                    <AlertTitle>Error</AlertTitle>
                    <AlertDescription>{fileError}</AlertDescription>
                  </Alert>
                )}
              </div>
            </div>
          </ModalBody>

          <ModalFooter>
            <Button
              variant='default'
              onClick={() => handleClose(false)}
              type='button'
              disabled={isSubmitting}
            >
              Cancel
            </Button>
            <Button variant='primary' type='submit' disabled={isSubmitting || !nameValue?.trim()}>
              {isSubmitting
                ? isUploading
                  ? uploadProgress.stage === 'uploading'
                    ? `Uploading ${uploadProgress.filesCompleted}/${uploadProgress.totalFiles}...`
                    : uploadProgress.stage === 'processing'
                      ? 'Processing...'
                      : 'Creating...'
                  : 'Creating...'
                : 'Create'}
            </Button>
          </ModalFooter>
        </form>
      </ModalContent>
    </Modal>
  )
}
