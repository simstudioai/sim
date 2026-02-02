'use client'

import { useEffect, useRef, useState } from 'react'
import { zodResolver } from '@hookform/resolvers/zod'
import { createLogger } from '@sim/logger'
import { Loader2, RotateCcw, X } from 'lucide-react'
import { useParams } from 'next/navigation'
import { useForm } from 'react-hook-form'
import { z } from 'zod'
import {
  Button,
  Input,
  Label,
  Modal,
  ModalBody,
  ModalContent,
  ModalFooter,
  ModalHeader,
  Textarea,
} from '@/components/emcn'
import { cn } from '@/lib/core/utils/cn'
import { formatFileSize, validateKnowledgeBaseFile } from '@/lib/uploads/utils/file-utils'
import { ACCEPT_ATTRIBUTE } from '@/lib/uploads/utils/validation'
import { useKnowledgeUpload } from '@/app/workspace/[workspaceId]/knowledge/hooks/use-knowledge-upload'
import { useCreateKnowledgeBase, useDeleteKnowledgeBase } from '@/hooks/queries/knowledge'

const logger = createLogger('CreateBaseModal')

interface FileWithPreview extends File {
  preview: string
}

interface CreateBaseModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

const FormSchema = z
  .object({
    name: z
      .string()
      .min(1, 'Name is required')
      .max(100, 'Name must be less than 100 characters')
      .refine((value) => value.trim().length > 0, 'Name cannot be empty'),
    description: z.string().max(500, 'Description must be less than 500 characters').optional(),
    /** Minimum chunk size in characters */
    minChunkSize: z
      .number()
      .min(1, 'Min chunk size must be at least 1 character')
      .max(2000, 'Min chunk size must be less than 2000 characters'),
    /** Maximum chunk size in tokens (1 token ≈ 4 characters) */
    maxChunkSize: z
      .number()
      .min(100, 'Max chunk size must be at least 100 tokens')
      .max(4000, 'Max chunk size must be less than 4000 tokens'),
    /** Overlap between chunks in tokens */
    overlapSize: z
      .number()
      .min(0, 'Overlap must be non-negative')
      .max(500, 'Overlap must be less than 500 tokens'),
  })
  .refine(
    (data) => {
      // Convert maxChunkSize from tokens to characters for comparison (1 token ≈ 4 chars)
      const maxChunkSizeInChars = data.maxChunkSize * 4
      return data.minChunkSize < maxChunkSizeInChars
    },
    {
      message: 'Min chunk size (characters) must be less than max chunk size (tokens × 4)',
      path: ['minChunkSize'],
    }
  )

type FormValues = z.infer<typeof FormSchema>

interface SubmitStatus {
  type: 'success' | 'error'
  message: string
}

export function CreateBaseModal({ open, onOpenChange }: CreateBaseModalProps) {
  const params = useParams()
  const workspaceId = params.workspaceId as string

  const createKnowledgeBaseMutation = useCreateKnowledgeBase(workspaceId)
  const deleteKnowledgeBaseMutation = useDeleteKnowledgeBase(workspaceId)

  const fileInputRef = useRef<HTMLInputElement>(null)
  const [submitStatus, setSubmitStatus] = useState<SubmitStatus | null>(null)
  const [files, setFiles] = useState<FileWithPreview[]>([])
  const [fileError, setFileError] = useState<string | null>(null)
  const [isDragging, setIsDragging] = useState(false)
  const [dragCounter, setDragCounter] = useState(0)
  const [retryingIndexes, setRetryingIndexes] = useState<Set<number>>(new Set())

  const scrollContainerRef = useRef<HTMLDivElement>(null)

  const { uploadFiles, isUploading, uploadProgress, uploadError, clearError } = useKnowledgeUpload({
    workspaceId,
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
      minChunkSize: 100,
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
        minChunkSize: 100,
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

  const isSubmitting =
    createKnowledgeBaseMutation.isPending || deleteKnowledgeBaseMutation.isPending || isUploading

  const onSubmit = async (data: FormValues) => {
    setSubmitStatus(null)

    try {
      const newKnowledgeBase = await createKnowledgeBaseMutation.mutateAsync({
        name: data.name,
        description: data.description || undefined,
        workspaceId: workspaceId,
        chunkingConfig: {
          maxSize: data.maxChunkSize,
          minSize: data.minChunkSize,
          overlap: data.overlapSize,
        },
      })

      if (files.length > 0) {
        try {
          const uploadedFiles = await uploadFiles(files, newKnowledgeBase.id, {
            chunkSize: data.maxChunkSize,
            minCharactersPerChunk: data.minChunkSize,
            chunkOverlap: data.overlapSize,
            recipe: 'default',
          })

          logger.info(`Successfully uploaded ${uploadedFiles.length} files`)
          logger.info(`Started processing ${uploadedFiles.length} documents in the background`)
        } catch (uploadError) {
          logger.error('File upload failed, deleting knowledge base:', uploadError)
          try {
            await deleteKnowledgeBaseMutation.mutateAsync({
              knowledgeBaseId: newKnowledgeBase.id,
            })
            logger.info(`Deleted orphaned knowledge base: ${newKnowledgeBase.id}`)
          } catch (deleteError) {
            logger.error('Failed to delete orphaned knowledge base:', deleteError)
          }
          throw uploadError
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
    }
  }

  return (
    <Modal open={open} onOpenChange={handleClose}>
      <ModalContent size='lg'>
        <ModalHeader>Create Knowledge Base</ModalHeader>

        <form onSubmit={handleSubmit(onSubmit)} className='flex min-h-0 flex-1 flex-col'>
          <ModalBody>
            <div ref={scrollContainerRef} className='min-h-0 flex-1 overflow-y-auto'>
              <div className='space-y-[12px]'>
                <div className='flex flex-col gap-[8px]'>
                  <Label htmlFor='kb-name'>Name</Label>
                  {/* Hidden decoy fields to prevent browser autofill */}
                  <input
                    type='text'
                    name='fakeusernameremembered'
                    autoComplete='username'
                    style={{
                      position: 'absolute',
                      left: '-9999px',
                      opacity: 0,
                      pointerEvents: 'none',
                    }}
                    tabIndex={-1}
                    readOnly
                  />
                  <Input
                    id='kb-name'
                    placeholder='Enter knowledge base name'
                    {...register('name')}
                    className={cn(errors.name && 'border-[var(--text-error)]')}
                    autoComplete='off'
                    autoCorrect='off'
                    autoCapitalize='off'
                    data-lpignore='true'
                    data-form-type='other'
                  />
                </div>

                <div className='flex flex-col gap-[8px]'>
                  <Label htmlFor='description'>Description</Label>
                  <Textarea
                    id='description'
                    placeholder='Describe this knowledge base (optional)'
                    rows={4}
                    {...register('description')}
                    className={cn(errors.description && 'border-[var(--text-error)]')}
                  />
                </div>

                <div className='grid grid-cols-2 gap-[12px]'>
                  <div className='flex flex-col gap-[8px]'>
                    <Label htmlFor='minChunkSize'>Min Chunk Size (characters)</Label>
                    <Input
                      id='minChunkSize'
                      placeholder='100'
                      {...register('minChunkSize', { valueAsNumber: true })}
                      className={cn(errors.minChunkSize && 'border-[var(--text-error)]')}
                      autoComplete='off'
                      data-form-type='other'
                      name='min-chunk-size'
                    />
                  </div>

                  <div className='flex flex-col gap-[8px]'>
                    <Label htmlFor='maxChunkSize'>Max Chunk Size (tokens)</Label>
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
                  <Label htmlFor='overlapSize'>Overlap (tokens)</Label>
                  <Input
                    id='overlapSize'
                    placeholder='200'
                    {...register('overlapSize', { valueAsNumber: true })}
                    className={cn(errors.overlapSize && 'border-[var(--text-error)]')}
                    autoComplete='off'
                    data-form-type='other'
                    name='overlap-size'
                  />
                  <p className='text-[11px] text-[var(--text-muted)]'>
                    1 token ≈ 4 characters. Max chunk size and overlap are in tokens.
                  </p>
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
                                      onClick={() => {
                                        setRetryingIndexes((prev) => new Set(prev).add(index))
                                        removeFile(index)
                                      }}
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

                {fileError && (
                  <p className='text-[12px] text-[var(--text-error)] leading-tight'>{fileError}</p>
                )}
              </div>
            </div>
          </ModalBody>

          <ModalFooter>
            <div className='flex w-full items-center justify-between gap-[12px]'>
              {submitStatus?.type === 'error' || uploadError ? (
                <p className='min-w-0 flex-1 truncate text-[12px] text-[var(--text-error)] leading-tight'>
                  {uploadError?.message || submitStatus?.message}
                </p>
              ) : (
                <div />
              )}
              <div className='flex flex-shrink-0 gap-[8px]'>
                <Button
                  variant='default'
                  onClick={() => handleClose(false)}
                  type='button'
                  disabled={isSubmitting}
                >
                  Cancel
                </Button>
                <Button
                  variant='tertiary'
                  type='submit'
                  disabled={isSubmitting || !nameValue?.trim()}
                >
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
              </div>
            </div>
          </ModalFooter>
        </form>
      </ModalContent>
    </Modal>
  )
}
