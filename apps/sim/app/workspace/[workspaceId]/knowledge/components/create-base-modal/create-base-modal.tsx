'use client'

import { memo, useEffect, useState } from 'react'
import { zodResolver } from '@hookform/resolvers/zod'
import {
  Button,
  Checkbox,
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
  cn,
  Loader,
  toast,
} from '@sim/emcn'
import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { X } from 'lucide-react'
import { useParams } from 'next/navigation'
import { type FieldErrors, useForm } from 'react-hook-form'
import { z } from 'zod'
import type { StrategyOptions } from '@/lib/chunkers/types'
import { KNOWLEDGE_BASE_DESCRIPTION_MAX_LENGTH } from '@/lib/knowledge/constants'
import { formatFileSize, validateKnowledgeBaseFile } from '@/lib/uploads/utils/file-utils'
import { ACCEPT_ATTRIBUTE } from '@/lib/uploads/utils/validation'
import { useKnowledgeUpload } from '@/app/workspace/[workspaceId]/knowledge/hooks/use-knowledge-upload'
import { useCreateKnowledgeBase, useDeleteKnowledgeBase } from '@/hooks/queries/kb/knowledge'

const logger = createLogger('CreateBaseModal')

interface CreateBaseModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Folder the new base is created into; omit/null for the workspace root. */
  folderId?: string | null
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
    description: z
      .string()
      .max(
        KNOWLEDGE_BASE_DESCRIPTION_MAX_LENGTH,
        `Description must be ${KNOWLEDGE_BASE_DESCRIPTION_MAX_LENGTH} characters or less`
      )
      .optional(),
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
  folderId,
}: CreateBaseModalProps) {
  const params = useParams()
  const workspaceId = params.workspaceId as string

  const createKnowledgeBaseMutation = useCreateKnowledgeBase(workspaceId)
  const deleteKnowledgeBaseMutation = useDeleteKnowledgeBase(workspaceId)

  const [submitStatus, setSubmitStatus] = useState<SubmitStatus | null>(null)
  const [files, setFiles] = useState<File[]>([])
  const [fileError, setFileError] = useState<string | null>(null)

  const { uploadFiles, isUploading, uploadProgress, uploadError, clearError } = useKnowledgeUpload({
    workspaceId,
  })

  const handleClose = (open: boolean) => {
    if (!open) {
      clearError()
    }
    onOpenChange(open)
  }

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
      const newFiles: File[] = []
      let hasError = false

      for (const file of selectedFiles) {
        const validationError = validateKnowledgeBaseFile(file)
        if (validationError) {
          setFileError(validationError)
          hasError = true
          continue
        }

        newFiles.push(file)
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
    setFiles((prev) => prev.filter((_, i) => i !== index))
  }

  const isSubmitting =
    createKnowledgeBaseMutation.isPending || deleteKnowledgeBaseMutation.isPending || isUploading

  const onInvalid = (formErrors: FieldErrors<FormInputValues>) => {
    const firstMessage = Object.values(formErrors).find(
      (fieldError) => typeof fieldError?.message === 'string'
    )?.message
    toast.error(
      typeof firstMessage === 'string' ? firstMessage : 'Please fix the highlighted fields'
    )
  }

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
        folderId: folderId ?? undefined,
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

      <form onSubmit={handleSubmit(onSubmit, onInvalid)} className='flex min-h-0 flex-1 flex-col'>
        <button type='submit' hidden disabled={isSubmitting || !nameValue?.trim()} />
        <ChipModalBody>
          <input
            type='text'
            name='fakeusernameremembered'
            autoComplete='username'
            className='-left-[9999px] pointer-events-none absolute opacity-0'
            tabIndex={-1}
            readOnly
          />

          <ChipModalField type='custom' title='Name'>
            <ChipInput
              placeholder='Enter knowledge base name'
              {...register('name')}
              error={Boolean(errors.name)}
              autoComplete='off'
              autoCorrect='off'
              autoCapitalize='off'
              data-lpignore='true'
              data-form-type='other'
            />
          </ChipModalField>

          <ChipModalField type='custom' title='Description' error={errors.description?.message}>
            <ChipTextarea
              placeholder='Describe this knowledge base (optional)'
              rows={4}
              {...register('description')}
              error={Boolean(errors.description)}
            />
          </ChipModalField>

          <div className='flex gap-3'>
            <ChipModalField type='custom' title='Min Chunk Size (characters)' className='flex-1'>
              <ChipInput
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
            </ChipModalField>

            <ChipModalField type='custom' title='Max Chunk Size (tokens)' className='flex-1'>
              <ChipInput
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
            </ChipModalField>
          </div>

          <ChipModalField
            type='custom'
            title='Overlap (tokens)'
            hint='1 token ≈ 4 characters. Max chunk size and overlap are in tokens.'
          >
            <ChipInput
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
          </ChipModalField>

          <ChipModalField
            type='custom'
            title='Chunking Strategy'
            hint='Auto detects the best strategy based on file content type.'
          >
            <ChipCombobox
              options={STRATEGY_COMBOBOX_OPTIONS}
              value={strategyValue}
              onChange={(value) => setValue('strategy', value as FormValues['strategy'])}
              dropdownWidth='trigger'
              align='start'
            />
          </ChipModalField>

          {strategyValue === 'regex' && (
            <>
              <ChipModalField
                type='custom'
                title='Regex Pattern'
                error={errors.regexPattern?.message}
                hint='Text will be split at each match of this regex pattern.'
              >
                <ChipInput
                  placeholder='e.g. \\n\\n or (?<=\\})\\s*(?=\\{)'
                  {...register('regexPattern')}
                  error={Boolean(errors.regexPattern)}
                  autoComplete='off'
                  data-form-type='other'
                />
              </ChipModalField>

              <ChipModalField
                type='custom'
                title='Chunk Boundaries'
                hint='Preserve boundaries exactly. Recommended when each match is a discrete record (e.g. one QA pair per chunk).'
              >
                <label
                  htmlFor='regexStrictBoundaries'
                  className='flex cursor-pointer items-center gap-2'
                >
                  <Checkbox
                    id='regexStrictBoundaries'
                    checked={regexStrictBoundariesValue}
                    onCheckedChange={(checked) =>
                      setValue('regexStrictBoundaries', checked === true)
                    }
                  />
                  <span className='text-[var(--text-primary)] text-sm'>
                    Each match is its own chunk (don&apos;t merge)
                  </span>
                </label>
              </ChipModalField>
            </>
          )}

          {strategyValue === 'recursive' && (
            <ChipModalField
              type='custom'
              title='Custom Separators (optional)'
              hint='Comma-separated list of delimiters in priority order. Leave empty for default separators.'
            >
              <ChipInput
                placeholder='e.g. \n\n, \n, . ,  '
                {...register('customSeparators')}
                autoComplete='off'
                data-form-type='other'
              />
            </ChipModalField>
          )}

          <ChipModalField
            type='file'
            title='Upload Documents'
            accept={ACCEPT_ATTRIBUTE}
            multiple
            onChange={processFiles}
            description='PDF, DOC, DOCX, TXT, CSV, XLS, XLSX, MD, PPT, PPTX, HTML, JSONL (max 100MB each)'
            error={fileError}
          />

          {files.length > 0 && (
            <ChipModalField type='custom' title='Selected Files'>
              <div className='space-y-2'>
                {files.map((file, index) => {
                  const fileStatus = uploadProgress.fileStatuses?.[index]
                  const isFailed = fileStatus?.status === 'failed'
                  const isProcessing = fileStatus?.status === 'uploading'

                  return (
                    <div
                      key={`${file.name}-${file.size}`}
                      className={cn(
                        'flex items-center gap-2 rounded-sm border p-2',
                        isFailed && 'border-[var(--text-error)]'
                      )}
                    >
                      <span
                        className={cn(
                          'min-w-0 flex-1 truncate text-caption',
                          isFailed && 'text-[var(--text-error)]'
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
                          <Button
                            type='button'
                            variant='ghost'
                            className='size-4 p-0'
                            onClick={() => removeFile(index)}
                            disabled={isUploading}
                          >
                            <X className='size-3.5' />
                          </Button>
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>
            </ChipModalField>
          )}

          <ChipModalError>{uploadError?.message || submitStatus?.message}</ChipModalError>
        </ChipModalBody>

        <ChipModalFooter
          onCancel={() => handleClose(false)}
          cancelDisabled={isSubmitting}
          primaryAction={{
            label: isSubmitting
              ? isUploading
                ? uploadProgress.stage === 'uploading'
                  ? `Uploading ${uploadProgress.filesCompleted}/${uploadProgress.totalFiles}...`
                  : uploadProgress.stage === 'processing'
                    ? 'Processing...'
                    : 'Creating...'
                : 'Creating...'
              : 'Create',
            onClick: handleSubmit(onSubmit, onInvalid),
            disabled: isSubmitting || !nameValue?.trim(),
          }}
        />
      </form>
    </ChipModal>
  )
})
