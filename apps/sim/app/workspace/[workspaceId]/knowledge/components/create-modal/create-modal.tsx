'use client'

import { useEffect, useRef, useState } from 'react'
import { zodResolver } from '@hookform/resolvers/zod'
import { AlertCircle, CheckCircle2, X } from 'lucide-react'
import { useParams } from 'next/navigation'
import { useForm } from 'react-hook-form'
import { z } from 'zod'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { createLogger } from '@/lib/logs/console/logger'
import { getDocumentIcon } from '@/app/workspace/[workspaceId]/knowledge/components/icons/document-icons'
import type { KnowledgeBaseData } from '@/stores/knowledge/store'
import { useKnowledgeUpload } from '../../hooks/use-knowledge-upload'
import { type TagData, TagInput } from '../tag-input/tag-input'

const logger = createLogger('CreateModal')

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
      .min(50, 'Min chunk size must be at least 50')
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
  const [tags, setTags] = useState<TagData>({})
  const scrollContainerRef = useRef<HTMLDivElement>(null)
  const dropZoneRef = useRef<HTMLDivElement>(null)

  const { uploadFiles } = useKnowledgeUpload({
    onUploadComplete: (uploadedFiles) => {
      logger.info(`Successfully uploaded ${uploadedFiles.length} files`)
    },
  })

  // Cleanup file preview URLs when component unmounts to prevent memory leaks
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
    mode: 'onChange',
  })

  const processFiles = async (fileList: FileList | File[]) => {
    setFileError(null)

    if (!fileList || fileList.length === 0) return

    try {
      const newFiles: FileWithPreview[] = []
      let hasError = false

      for (const file of Array.from(fileList)) {
        // Check file size
        if (file.size > MAX_FILE_SIZE) {
          setFileError(`File ${file.name} is too large. Maximum size is 100MB per file.`)
          hasError = true
          continue
        }

        // Check file type
        if (!ACCEPTED_FILE_TYPES.includes(file.type)) {
          setFileError(
            `File ${file.name} has an unsupported format. Please use PDF, DOC, DOCX, TXT, CSV, XLS, or XLSX.`
          )
          hasError = true
          continue
        }

        // Create file with preview (using file icon since these aren't images)
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
      // Reset the input
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

  // Handle drag events
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
    // Add visual feedback for valid drop zone
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
      // Revoke the URL to avoid memory leaks
      URL.revokeObjectURL(prev[index].preview)
      return prev.filter((_, i) => i !== index)
    })
  }

  const getFileIcon = (mimeType: string, filename: string) => {
    const IconComponent = getDocumentIcon(mimeType, filename)
    return <IconComponent className='h-10 w-8' />
  }

  const formatFileSize = (bytes: number): string => {
    if (bytes === 0) return '0 B'
    const k = 1024
    const sizes = ['B', 'KB', 'MB', 'GB']
    const i = Math.floor(Math.log(bytes) / Math.log(k))
    return `${Number.parseFloat((bytes / k ** i).toFixed(1))} ${sizes[i]}`
  }

  const onSubmit = async (data: FormValues) => {
    setIsSubmitting(true)
    setSubmitStatus(null)

    try {
      // First create the knowledge base
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
        // Add tags to files before upload
        const filesWithTags = files.map((file) => {
          const fileWithTags = file as File & TagData
          Object.assign(fileWithTags, tags)
          return fileWithTags
        })

        const uploadedFiles = await uploadFiles(filesWithTags, newKnowledgeBase.id, {
          chunkSize: data.maxChunkSize,
          minCharactersPerChunk: data.minChunkSize,
          chunkOverlap: data.overlapSize,
          recipe: 'default',
        })

        // Update the knowledge base object with the correct document count
        newKnowledgeBase.docCount = uploadedFiles.length

        logger.info(`Started processing ${uploadedFiles.length} documents in the background`)
      }

      setSubmitStatus({
        type: 'success',
        message: 'Your knowledge base has been created successfully!',
      })
      reset({
        name: '',
        description: '',
        minChunkSize: 100,
        maxChunkSize: 1024,
        overlapSize: 200,
      })
      setTags({})

      // Clean up file previews
      files.forEach((file) => URL.revokeObjectURL(file.preview))
      setFiles([])

      // Call the callback if provided
      if (onKnowledgeBaseCreated) {
        onKnowledgeBaseCreated(newKnowledgeBase)
      }

      // Close modal after a short delay to show success message
      setTimeout(() => {
        onOpenChange(false)
      }, 1500)
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
    <Dialog open={open} onOpenChange={onOpenChange}>
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
              onClick={() => onOpenChange(false)}
            >
              <X className='h-4 w-4' />
              <span className='sr-only'>Close</span>
            </Button>
          </div>
        </DialogHeader>

        <div className='flex flex-1 flex-col overflow-hidden'>
          <form onSubmit={handleSubmit(onSubmit)} className='flex h-full flex-col'>
            {/* Scrollable Content */}
            <div
              ref={scrollContainerRef}
              className='scrollbar-thin scrollbar-thumb-muted-foreground/20 hover:scrollbar-thumb-muted-foreground/25 scrollbar-track-transparent min-h-0 flex-1 overflow-y-auto px-6'
            >
              <div className='flex min-h-full flex-col py-4'>
                {submitStatus && submitStatus.type === 'success' ? (
                  <Alert className='mb-6 border-border border-green-200 bg-green-50 dark:border-green-900 dark:bg-green-950/30'>
                    <div className='flex items-start gap-4 py-1'>
                      <div className='mt-[-1.5px] flex-shrink-0'>
                        <CheckCircle2 className='h-4 w-4 text-green-600 dark:text-green-400' />
                      </div>
                      <div className='mr-4 flex-1 space-y-2'>
                        <AlertTitle className='-mt-0.5 flex items-center justify-between'>
                          <span className='font-medium text-green-600 dark:text-green-400'>
                            Success
                          </span>
                        </AlertTitle>
                        <AlertDescription className='text-green-600 dark:text-green-400'>
                          {submitStatus.message}
                        </AlertDescription>
                      </div>
                    </div>
                  </Alert>
                ) : submitStatus && submitStatus.type === 'error' ? (
                  <Alert variant='destructive' className='mb-6'>
                    <AlertCircle className='h-4 w-4' />
                    <AlertTitle>Error</AlertTitle>
                    <AlertDescription>{submitStatus.message}</AlertDescription>
                  </Alert>
                ) : null}

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
                          placeholder='100'
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

                {/* Tag Input Section */}
                <div className='mt-6'>
                  <TagInput tags={tags} onTagsChange={setTags} disabled={isSubmitting} />
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
                          accept={ACCEPTED_FILE_TYPES.join(',')}
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
                              Supports PDF, DOC, DOCX, TXT, CSV, XLS, XLSX (max 100MB each)
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
                            accept={ACCEPTED_FILE_TYPES.join(',')}
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
                                PDF, DOC, DOCX, TXT, CSV, XLS, XLSX (max 100MB each)
                              </p>
                            </div>
                          </div>
                        </div>

                        {/* File list */}
                        <div className='space-y-2'>
                          {files.map((file, index) => (
                            <div
                              key={index}
                              className='flex items-center gap-3 rounded-md border p-3'
                            >
                              {getFileIcon(file.type, file.name)}
                              <div className='min-w-0 flex-1'>
                                <p className='truncate font-medium text-sm'>{file.name}</p>
                                <p className='text-muted-foreground text-xs'>
                                  {formatFileSize(file.size)}
                                </p>
                              </div>
                              <Button
                                type='button'
                                variant='ghost'
                                size='sm'
                                onClick={() => removeFile(index)}
                                className='h-8 w-8 p-0 text-muted-foreground hover:text-destructive'
                              >
                                <X className='h-4 w-4' />
                              </Button>
                            </div>
                          ))}
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
                <Button variant='outline' onClick={() => onOpenChange(false)} type='button'>
                  Cancel
                </Button>
                <Button
                  type='submit'
                  disabled={isSubmitting}
                  className='bg-[#701FFC] font-[480] text-primary-foreground shadow-[0_0_0_0_#701FFC] transition-all duration-200 hover:bg-[#6518E6] hover:shadow-[0_0_0_4px_rgba(127,47,255,0.15)]'
                >
                  {isSubmitting ? 'Creating...' : 'Create Knowledge Base'}
                </Button>
              </div>
            </div>
          </form>
        </div>
      </DialogContent>
    </Dialog>
  )
}
