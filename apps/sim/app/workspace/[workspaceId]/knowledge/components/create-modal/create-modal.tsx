'use client'

import { useEffect, useRef, useState } from 'react'
import { zodResolver } from '@hookform/resolvers/zod'
import { AlertCircle, Check, Loader2, X } from 'lucide-react'
import { useParams } from 'next/navigation'
import { useForm } from 'react-hook-form'
import { z } from 'zod'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Progress } from '@/components/ui/progress'
import { Textarea } from '@/components/ui/textarea'
import { createLogger } from '@/lib/logs/console/logger'
import { formatFileSize, validateKnowledgeBaseFile } from '@/lib/uploads/utils/file-utils'
import { ACCEPT_ATTRIBUTE } from '@/lib/uploads/utils/validation'
import { getDocumentIcon } from '@/app/workspace/[workspaceId]/knowledge/components'
import { useKnowledgeUpload } from '@/app/workspace/[workspaceId]/knowledge/hooks/use-knowledge-upload'
import type { KnowledgeBaseData } from '@/stores/knowledge/store'

const logger = createLogger('CreateModal')

interface FileWithPreview extends File {
  preview: string
}

interface CreateModalProps {
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

export function CreateModal({ open, onOpenChange, onKnowledgeBaseCreated }: CreateModalProps) {
  const params = useParams()
  const workspaceId = params.workspaceId as string

  const fileInputRef = useRef<HTMLInputElement>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [submitStatus, setSubmitStatus] = useState<SubmitStatus | null>(null)
  const [files, setFiles] = useState<FileWithPreview[]>([])
  const [fileError, setFileError] = useState<string | null>(null)
  const [isDragging, setIsDragging] = useState(false)
  const [dragCounter, setDragCounter] = useState(0) // Track drag events to handle nested elements

  const scrollContainerRef = useRef<HTMLDivElement>(null)
  const dropZoneRef = useRef<HTMLDivElement>(null)

  const { uploadFiles, isUploading, uploadProgress, uploadError, clearError } = useKnowledgeUpload({
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

  const getFileIcon = (mimeType: string, filename: string) => {
    const IconComponent = getDocumentIcon(mimeType, filename)
    return <IconComponent className='h-10 w-8' />
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
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent
        className='flex h-[74vh] flex-col gap-0 overflow-hidden p-0 sm:max-w-[600px]'
        hideCloseButton
      >
        <DialogHeader className='flex-shrink-0 border-b px-6 py-4'>
          <div className='flex items-center justify-between'>
            <DialogTitle className='font-medium text-lg'>Create Knowledge Base</DialogTitle>
            <Button
              variant='ghost'
              size='icon'
              className='h-8 w-8 p-0'
              onClick={() => handleClose(false)}
            >
              <X className='h-4 w-4' />
              <span className='sr-only'>Close</span>
            </Button>
          </div>
        </DialogHeader>

        <div className='flex flex-1 flex-col overflow-hidden'>
          <form onSubmit={handleSubmit(onSubmit)} className='flex h-full flex-col'>
            {/* Scrollable Content */}
            <div ref={scrollContainerRef} className='min-h-0 flex-1 overflow-y-auto px-6'>
              <div className='flex min-h-full flex-col py-4'>
                {/* Show upload error first, then submit error only if no upload error */}
                {uploadError && (
                  <Alert variant='destructive' className='mb-6'>
                    <AlertCircle className='h-4 w-4' />
                    <AlertTitle>Upload Error</AlertTitle>
                    <AlertDescription>{uploadError.message}</AlertDescription>
                  </Alert>
                )}

                {submitStatus && submitStatus.type === 'error' && !uploadError && (
                  <Alert variant='destructive' className='mb-6'>
                    <AlertCircle className='h-4 w-4' />
                    <AlertTitle>Error</AlertTitle>
                    <AlertDescription>{submitStatus.message}</AlertDescription>
                  </Alert>
                )}

                {/* Form Fields Section - Fixed at top */}
                <div className='flex-shrink-0 space-y-4'>
                  <div className='space-y-2'>
                    <Label htmlFor='name'>Name *</Label>
                    <Input
                      id='name'
                      placeholder='Enter knowledge base name'
                      {...register('name')}
                      className={errors.name ? 'border-red-500' : ''}
                    />
                    {errors.name && (
                      <p className='mt-1 text-red-500 text-sm'>{errors.name.message}</p>
                    )}
                  </div>

                  <div className='space-y-2'>
                    <Label htmlFor='description'>Description</Label>
                    <Textarea
                      id='description'
                      placeholder='Describe what this knowledge base contains (optional)'
                      rows={3}
                      {...register('description')}
                      className={errors.description ? 'border-red-500' : ''}
                    />
                    {errors.description && (
                      <p className='mt-1 text-red-500 text-sm'>{errors.description.message}</p>
                    )}
                  </div>

                  {/* Chunk Configuration Section */}
                  <div className='space-y-4 rounded-lg border p-4'>
                    <h3 className='font-medium text-foreground text-sm'>Chunking Configuration</h3>

                    {/* Min and Max Chunk Size Row */}
                    <div className='grid grid-cols-2 gap-4'>
                      <div className='space-y-2'>
                        <Label htmlFor='minChunkSize'>Min Chunk Size</Label>
                        <Input
                          id='minChunkSize'
                          type='number'
                          placeholder='1'
                          {...register('minChunkSize', { valueAsNumber: true })}
                          className={errors.minChunkSize ? 'border-red-500' : ''}
                          autoComplete='off'
                          data-form-type='other'
                          name='min-chunk-size'
                        />
                        {errors.minChunkSize && (
                          <p className='mt-1 text-red-500 text-xs'>{errors.minChunkSize.message}</p>
                        )}
                      </div>

                      <div className='space-y-2'>
                        <Label htmlFor='maxChunkSize'>Max Chunk Size</Label>
                        <Input
                          id='maxChunkSize'
                          type='number'
                          placeholder='1024'
                          {...register('maxChunkSize', { valueAsNumber: true })}
                          className={errors.maxChunkSize ? 'border-red-500' : ''}
                          autoComplete='off'
                          data-form-type='other'
                          name='max-chunk-size'
                        />
                        {errors.maxChunkSize && (
                          <p className='mt-1 text-red-500 text-xs'>{errors.maxChunkSize.message}</p>
                        )}
                      </div>
                    </div>

                    {/* Overlap Size */}
                    <div className='space-y-2'>
                      <Label htmlFor='overlapSize'>Overlap Size</Label>
                      <Input
                        id='overlapSize'
                        type='number'
                        placeholder='200'
                        {...register('overlapSize', { valueAsNumber: true })}
                        className={errors.overlapSize ? 'border-red-500' : ''}
                        autoComplete='off'
                        data-form-type='other'
                        name='overlap-size'
                      />
                      {errors.overlapSize && (
                        <p className='mt-1 text-red-500 text-xs'>{errors.overlapSize.message}</p>
                      )}
                    </div>

                    <p className='text-muted-foreground text-xs'>
                      Configure how documents are split into chunks for processing. Smaller chunks
                      provide more precise retrieval but may lose context.
                    </p>
                  </div>
                </div>

                {/* File Upload Section - Expands to fill remaining space */}
                <div className='mt-6 flex flex-1 flex-col'>
                  <Label className='mb-2'>Upload Documents</Label>
                  <div className='flex flex-1 flex-col'>
                    {files.length === 0 ? (
                      <div
                        ref={dropZoneRef}
                        onDragEnter={handleDragEnter}
                        onDragOver={handleDragOver}
                        onDragLeave={handleDragLeave}
                        onDrop={handleDrop}
                        onClick={() => fileInputRef.current?.click()}
                        className={`relative flex flex-1 cursor-pointer items-center justify-center rounded-lg border-[1.5px] border-dashed py-8 text-center transition-all duration-200 ${
                          isDragging
                            ? 'border-purple-300 bg-purple-50 shadow-sm'
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
                        <div className='flex flex-col items-center gap-3'>
                          <div className='space-y-1'>
                            <p
                              className={`font-medium text-sm transition-colors duration-200 ${
                                isDragging ? 'text-purple-700' : ''
                              }`}
                            >
                              {isDragging
                                ? 'Drop files here!'
                                : 'Drop files here or click to browse'}
                            </p>
                            <p className='text-muted-foreground text-xs'>
                              Supports PDF, DOC, DOCX, TXT, CSV, XLS, XLSX, MD, PPT, PPTX, HTML,
                              JSON, YAML, YML (max 100MB each)
                            </p>
                          </div>
                        </div>
                      </div>
                    ) : (
                      <div className='flex flex-1 flex-col space-y-2'>
                        {/* Compact drop area at top of file list */}
                        <div
                          ref={dropZoneRef}
                          onDragEnter={handleDragEnter}
                          onDragOver={handleDragOver}
                          onDragLeave={handleDragLeave}
                          onDrop={handleDrop}
                          onClick={() => fileInputRef.current?.click()}
                          className={`cursor-pointer rounded-md border border-dashed p-3 text-center transition-all duration-200 ${
                            isDragging
                              ? 'border-purple-300 bg-purple-50'
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
                          <div className='flex items-center justify-center gap-2'>
                            <div>
                              <p
                                className={`font-medium text-sm transition-colors duration-200 ${
                                  isDragging ? 'text-purple-700' : ''
                                }`}
                              >
                                {isDragging
                                  ? 'Drop more files here!'
                                  : 'Drop more files or click to browse'}
                              </p>
                              <p className='text-muted-foreground text-xs'>
                                PDF, DOC, DOCX, TXT, CSV, XLS, XLSX, MD, PPT, PPTX, HTML (max 100MB
                                each)
                              </p>
                            </div>
                          </div>
                        </div>

                        {/* File list */}
                        <div className='space-y-2'>
                          {files.map((file, index) => {
                            const fileStatus = uploadProgress.fileStatuses?.[index]
                            const isCurrentlyUploading = fileStatus?.status === 'uploading'
                            const isCompleted = fileStatus?.status === 'completed'
                            const isFailed = fileStatus?.status === 'failed'

                            return (
                              <div
                                key={index}
                                className='flex items-center gap-3 rounded-md border p-3'
                              >
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
                                        <Progress
                                          value={fileStatus?.progress || 0}
                                          className='h-1'
                                        />
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
                            )
                          })}
                        </div>
                      </div>
                    )}
                    {fileError && (
                      <Alert variant='destructive' className='mt-2'>
                        <AlertCircle className='h-4 w-4' />
                        <AlertTitle>Error</AlertTitle>
                        <AlertDescription>{fileError}</AlertDescription>
                      </Alert>
                    )}
                  </div>
                </div>
              </div>
            </div>

            {/* Footer */}
            <div className='mt-auto border-t px-6 pt-4 pb-6'>
              <div className='flex justify-between'>
                <Button variant='outline' onClick={() => handleClose(false)} type='button'>
                  Cancel
                </Button>
                <Button
                  type='submit'
                  disabled={isSubmitting || !nameValue?.trim()}
                  className='bg-[var(--brand-primary-hex)] font-[480] text-primary-foreground shadow-[0_0_0_0_var(--brand-primary-hex)] transition-all duration-200 hover:bg-[var(--brand-primary-hover-hex)] hover:shadow-[0_0_0_4px_rgba(127,47,255,0.15)] disabled:opacity-50 disabled:hover:shadow-none'
                >
                  {isSubmitting
                    ? isUploading
                      ? uploadProgress.stage === 'uploading'
                        ? `Uploading ${uploadProgress.filesCompleted}/${uploadProgress.totalFiles}...`
                        : uploadProgress.stage === 'processing'
                          ? 'Processing...'
                          : 'Creating...'
                      : 'Creating...'
                    : 'Create Knowledge Base'}
                </Button>
              </div>
            </div>
          </form>
        </div>
      </DialogContent>
    </Dialog>
  )
}
