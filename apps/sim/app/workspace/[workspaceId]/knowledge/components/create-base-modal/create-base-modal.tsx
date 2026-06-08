'use client'

import { memo, useEffect, useRef, useState } from 'react'
import { zodResolver } from '@hookform/resolvers/zod'
import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { RotateCcw, X } from 'lucide-react'
import { useParams } from 'next/navigation'
import { useForm } from 'react-hook-form'
import { z } from 'zod'
import {
  Button,
  Checkbox,
  Chip,
  ChipCombobox,
  ChipInput,
  ChipModal,
  ChipModalBody,
  ChipModalError,
  ChipModalField,
  ChipModalFooter,
  ChipModalHeader,
  ChipTextarea,
  type ComboboxOption,
  Label,
  Loader,
} from '@/components/emcn'
import type { StrategyOptions } from '@/lib/chunkers/types'
import { cn } from '@/lib/core/utils/cn'
import { formatFileSize, validateKnowledgeBaseFile } from '@/lib/uploads/utils/file-utils'
import { ACCEPT_ATTRIBUTE } from '@/lib/uploads/utils/validation'
import { useKnowledgeUpload } from '@/app/workspace/[workspaceId]/knowledge/hooks/use-knowledge-upload'
import { useCreateKnowledgeBase, useDeleteKnowledgeBase } from '@/hooks/queries/kb/knowledge'

const logger = createLogger('CreateBaseModal')

interface FileWithPreview extends File {
  preview: string
}

interface CreateBaseModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

const STRATEGY_OPTIONS = [
  { value: 'auto', label: 'Auto (detect from content)' },
  { value: 'text', label: 'Text (word boundary splitting)' },
  { value: 'recursive', label: 'Recursive (configurable separators)' },
  { value: 'sentence', label: 'Sentence' },
  { value: 'token', label: 'Token (fixed-size)' },
  { value: 'regex', label: 'Regex (custom pattern)' },
] as const

const STRATEGY_COMBOBOX_OPTIONS: ComboboxOption[] = STRATEGY_OPTIONS.map((o) => ({
  label: o.label,
  value: o.value,
}))

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
      .min(1, 'Min chunk size must be at least 1 character')
      .max(2000, 'Min chunk size must be less than 2000 characters'),
    maxChunkSize: z
      .number()
      .min(100, 'Max chunk size must be at least 100 tokens')
      .max(4000, 'Max chunk size must be less than 4000 tokens'),
    overlapSize: z
      .number()
      .min(0, 'Overlap must be non-negative')
      .max(500, 'Overlap must be less than 500 tokens'),
    strategy: z.enum(['auto', 'text', 'regex', 'recursive', 'sentence', 'token']).default('auto'),
    regexPattern: z.string().optional(),
    regexStrictBoundaries: z.boolean().default(false),
    customSeparators: z.string().optional(),
  })
  .refine(
    (data) => {
      const maxChunkSizeInChars = data.maxChunkSize * 4
      return data.minChunkSize < maxChunkSizeInChars
    },
    {
      message: 'Min chunk size (characters) must be less than max chunk size (tokens × 4)',
      path: ['minChunkSize'],
    }
  )
  .refine(
    (data) => {
      return data.overlapSize < data.maxChunkSize
    },
    {
      message: 'Overlap must be less than max chunk size',
      path: ['overlapSize'],
    }
  )
  .refine(
    (data) => {
      if (data.strategy === 'regex' && !data.regexPattern?.trim()) {
        return false
      }
      return true
    },
    {
      message: 'Regex pattern is required when using the regex strategy',
      path: ['regexPattern'],
    }
  )

type FormInputValues = z.input<typeof FormSchema>
type FormValues = z.output<typeof FormSchema>

interface SubmitStatus {
  type: 'success' | 'error'
  message: string
}

export const CreateBaseModal = memo(function CreateBaseModal({
  open,
  onOpenChange,
}: CreateBaseModalProps) {
  const params = useParams()
  const workspaceId = params.workspaceId as string

  const createKnowledgeBaseMutation = useCreateKnowledgeBase(workspaceId)
  const deleteKnowledgeBaseMutation = useDeleteKnowledgeBase(workspaceId)

  const [submitStatus, setSubmitStatus] = useState<SubmitStatus | null>(null)
  const [files, setFiles] = useState<FileWithPreview[]>([])
  const [fileError, setFileError] = useState<string | null>(null)
  const [retryingIndexes, setRetryingIndexes] = useState<Set<number>>(() => new Set())

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
    setValue,
    formState: { errors },
  } = useForm<FormInputValues, unknown, FormValues>({
    resolver: zodResolver(FormSchema),
    defaultValues: {
      name: '',
      description: '',
      minChunkSize: 100,
      maxChunkSize: 1024,
      overlapSize: 200,
      strategy: 'auto',
      regexPattern: '',
      regexStrictBoundaries: false,
      customSeparators: '',
    },
    mode: 'onSubmit',
  })

  const nameValue = watch('name')
  const strategyValue = watch('strategy')
  const regexStrictBoundariesValue = watch('regexStrictBoundaries')

  useEffect(() => {
    if (open) {
      setSubmitStatus(null)
      setFileError(null)
      setFiles([])
      setRetryingIndexes(new Set())
      reset({
        name: '',
        description: '',
        minChunkSize: 100,
        maxChunkSize: 1024,
        overlapSize: 200,
        strategy: 'auto',
        regexPattern: '',
        regexStrictBoundaries: false,
        customSeparators: '',
      })
    }
  }, [open, reset])

  const processFiles = (selectedFiles: File[]) => {
    setFileError(null)

    if (!selectedFiles || selectedFiles.length === 0) return

    try {
      const newFiles: FileWithPreview[] = []
      let hasError = false

      for (const file of selectedFiles) {
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
      const strategyOptions: StrategyOptions | undefined =
        data.strategy === 'regex' && data.regexPattern
          ? {
              pattern: data.regexPattern,
              ...(data.regexStrictBoundaries && { strictBoundaries: true }),
            }
          : data.strategy === 'recursive' && data.customSeparators?.trim()
            ? {
                separators: data.customSeparators
                  .split(',')
                  .map((s) => s.trim().replace(/\\n/g, '\n').replace(/\\t/g, '\t')),
              }
            : undefined

      const newKnowledgeBase = await createKnowledgeBaseMutation.mutateAsync({
        name: data.name,
        description: data.description || undefined,
        workspaceId: workspaceId,
        chunkingConfig: {
          maxSize: data.maxChunkSize,
          minSize: data.minChunkSize,
          overlap: data.overlapSize,
          ...(data.strategy !== 'auto' && { strategy: data.strategy }),
          ...(strategyOptions && { strategyOptions }),
        },
      })

      if (files.length > 0) {
        try {
          const uploadedFiles = await uploadFiles(files, newKnowledgeBase.id, {
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
        message: getErrorMessage(error, 'An unknown error occurred'),
      })
    }
  }

  return (
    <ChipModal open={open} onOpenChange={handleClose} srTitle='Create Knowledge Base' size='lg'>
      <ChipModalHeader onClose={() => handleClose(false)}>Create Knowledge Base</ChipModalHeader>

      <form onSubmit={handleSubmit(onSubmit)} className='flex min-h-0 flex-1 flex-col'>
        <ChipModalBody className='max-h-[70vh] overflow-y-auto'>
          <div ref={scrollContainerRef} className='min-h-0 flex-1'>
            <div className='space-y-3'>
              <div className='flex flex-col gap-2'>
                <Label htmlFor='kb-name'>Name</Label>
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
                <ChipInput
                  id='kb-name'
                  placeholder='Enter knowledge base name'
                  {...register('name')}
                  error={Boolean(errors.name)}
                  autoComplete='off'
                  autoCorrect='off'
                  autoCapitalize='off'
                  data-lpignore='true'
                  data-form-type='other'
                />
              </div>

              <div className='flex flex-col gap-2'>
                <Label htmlFor='description'>Description</Label>
                <ChipTextarea
                  id='description'
                  placeholder='Describe this knowledge base (optional)'
                  rows={4}
                  {...register('description')}
                  error={Boolean(errors.description)}
                />
              </div>

              <div className='grid grid-cols-2 gap-3'>
                <div className='flex flex-col gap-2'>
                  <Label htmlFor='minChunkSize'>Min Chunk Size (characters)</Label>
                  <ChipInput
                    id='minChunkSize'
                    type='number'
                    min={1}
                    max={2000}
                    step={1}
                    placeholder='100'
                    {...register('minChunkSize', { valueAsNumber: true })}
                    error={Boolean(errors.minChunkSize)}
                    autoComplete='off'
                    data-form-type='other'
                  />
                </div>

                <div className='flex flex-col gap-2'>
                  <Label htmlFor='maxChunkSize'>Max Chunk Size (tokens)</Label>
                  <ChipInput
                    id='maxChunkSize'
                    type='number'
                    min={100}
                    max={4000}
                    step={1}
                    placeholder='1024'
                    {...register('maxChunkSize', { valueAsNumber: true })}
                    error={Boolean(errors.maxChunkSize)}
                    autoComplete='off'
                    data-form-type='other'
                  />
                </div>
              </div>

              <div className='flex flex-col gap-2'>
                <Label htmlFor='overlapSize'>Overlap (tokens)</Label>
                <ChipInput
                  id='overlapSize'
                  type='number'
                  min={0}
                  max={500}
                  step={1}
                  placeholder='200'
                  {...register('overlapSize', { valueAsNumber: true })}
                  error={Boolean(errors.overlapSize)}
                  autoComplete='off'
                  data-form-type='other'
                />
                <p className='text-[var(--text-muted)] text-xs'>
                  1 token ≈ 4 characters. Max chunk size and overlap are in tokens.
                </p>
              </div>

              <div className='flex flex-col gap-2'>
                <Label>Chunking Strategy</Label>
                <ChipCombobox
                  options={STRATEGY_COMBOBOX_OPTIONS}
                  value={strategyValue}
                  onChange={(value) => setValue('strategy', value as FormValues['strategy'])}
                  dropdownWidth='trigger'
                  align='start'
                />
                <p className='text-[var(--text-muted)] text-xs'>
                  Auto detects the best strategy based on file content type.
                </p>
              </div>

              {strategyValue === 'regex' && (
                <div className='flex flex-col gap-2'>
                  <Label htmlFor='regexPattern'>Regex Pattern</Label>
                  <ChipInput
                    id='regexPattern'
                    placeholder='e.g. \\n\\n or (?<=\\})\\s*(?=\\{)'
                    {...register('regexPattern')}
                    error={Boolean(errors.regexPattern)}
                    autoComplete='off'
                    data-form-type='other'
                  />
                  {errors.regexPattern && (
                    <p className='text-[var(--text-error)] text-xs'>
                      {errors.regexPattern.message}
                    </p>
                  )}
                  <p className='text-[var(--text-muted)] text-xs'>
                    Text will be split at each match of this regex pattern.
                  </p>
                  <label
                    htmlFor='regexStrictBoundaries'
                    className='mt-1 flex cursor-pointer items-start gap-2'
                  >
                    <Checkbox
                      id='regexStrictBoundaries'
                      checked={regexStrictBoundariesValue}
                      onCheckedChange={(checked) =>
                        setValue('regexStrictBoundaries', checked === true)
                      }
                      className='mt-0.5'
                    />
                    <div className='flex flex-col gap-0.5'>
                      <span className='text-[var(--text-primary)] text-sm'>
                        Each match is its own chunk (don&apos;t merge)
                      </span>
                      <span className='text-[var(--text-muted)] text-xs'>
                        Preserve boundaries exactly. Recommended when each match is a discrete
                        record (e.g. one QA pair per chunk).
                      </span>
                    </div>
                  </label>
                </div>
              )}

              {strategyValue === 'recursive' && (
                <div className='flex flex-col gap-2'>
                  <Label htmlFor='customSeparators'>Custom Separators (optional)</Label>
                  <ChipInput
                    id='customSeparators'
                    placeholder='e.g. \n\n, \n, . ,  '
                    {...register('customSeparators')}
                    autoComplete='off'
                    data-form-type='other'
                  />
                  <p className='text-[var(--text-muted)] text-xs'>
                    Comma-separated list of delimiters in priority order. Leave empty for default
                    separators.
                  </p>
                </div>
              )}

              <ChipModalField
                type='file'
                title='Upload Documents'
                accept={ACCEPT_ATTRIBUTE}
                multiple
                onChange={processFiles}
                description='PDF, DOC, DOCX, TXT, CSV, XLS, XLSX, MD, PPT, PPTX, HTML, JSONL (max 100MB each)'
                flush
              />

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
                          key={`${file.name}-${file.size}`}
                          className={cn(
                            'flex items-center gap-2 rounded-sm border p-2',
                            isFailed && !isRetrying && 'border-[var(--text-error)]'
                          )}
                        >
                          <span
                            className={cn(
                              'min-w-0 flex-1 truncate text-caption',
                              isFailed && !isRetrying && 'text-[var(--text-error)]'
                            )}
                            title={file.name}
                          >
                            {file.name}
                          </span>
                          <span className='flex-shrink-0 text-[var(--text-muted)] text-xs'>
                            {formatFileSize(file.size)}
                          </span>
                          <div className='flex flex-shrink-0 items-center gap-1'>
                            {isProcessing ? (
                              <Loader className='size-4 text-[var(--text-muted)]' animate />
                            ) : (
                              <>
                                {isFailed && (
                                  <Button
                                    type='button'
                                    variant='ghost'
                                    className='size-4 p-0'
                                    onClick={() => {
                                      setRetryingIndexes((prev) => new Set(prev).add(index))
                                      removeFile(index)
                                    }}
                                    disabled={isUploading}
                                  >
                                    <RotateCcw className='size-3' />
                                  </Button>
                                )}
                                <Button
                                  type='button'
                                  variant='ghost'
                                  className='size-4 p-0'
                                  onClick={() => removeFile(index)}
                                  disabled={isUploading}
                                >
                                  <X className='size-3.5' />
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
                <p className='text-[var(--text-error)] text-caption leading-tight'>{fileError}</p>
              )}
            </div>
          </div>

          <ChipModalError>{uploadError?.message || submitStatus?.message}</ChipModalError>
        </ChipModalBody>

        <ChipModalFooter>
          <Chip
            variant='filled'
            flush
            onClick={() => handleClose(false)}
            type='button'
            disabled={isSubmitting}
          >
            Cancel
          </Chip>
          <Chip variant='primary' flush type='submit' disabled={isSubmitting || !nameValue?.trim()}>
            {isSubmitting
              ? isUploading
                ? uploadProgress.stage === 'uploading'
                  ? `Uploading ${uploadProgress.filesCompleted}/${uploadProgress.totalFiles}...`
                  : uploadProgress.stage === 'processing'
                    ? 'Processing...'
                    : 'Creating...'
                : 'Creating...'
              : 'Create'}
          </Chip>
        </ChipModalFooter>
      </form>
    </ChipModal>
  )
})
