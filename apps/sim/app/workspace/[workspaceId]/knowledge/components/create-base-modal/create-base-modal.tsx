'use client'

import { memo, useEffect, useState } from 'react'
import { zodResolver } from '@hookform/resolvers/zod'
import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { X } from 'lucide-react'
import { useParams } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { useForm } from 'react-hook-form'
import { z } from 'zod'
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
  Loader,
} from '@/components/emcn'
import type { StrategyOptions } from '@/lib/chunkers/types'
import { cn } from '@/lib/core/utils/cn'
import { formatFileSize, validateKnowledgeBaseFile } from '@/lib/uploads/utils/file-utils'
import { ACCEPT_ATTRIBUTE } from '@/lib/uploads/utils/validation'
import { useKnowledgeUpload } from '@/app/workspace/[workspaceId]/knowledge/hooks/use-knowledge-upload'
import { useCreateKnowledgeBase, useDeleteKnowledgeBase } from '@/hooks/queries/kb/knowledge'

const logger = createLogger('CreateBaseModal')

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
  const tI18n = useTranslations('auto')
  const t = useTranslations('auto')
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
    <ChipModal
      open={open}
      onOpenChange={handleClose}
      srTitle={tI18n('create_knowledge_base')}
      size='lg'
    >
      <ChipModalHeader onClose={() => handleClose(false)}>
        {t('create_knowledge_base')}
      </ChipModalHeader>

      <form onSubmit={handleSubmit(onSubmit)} className='flex min-h-0 flex-1 flex-col'>
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

          <ChipModalField type='custom' title={t('name')}>
            <ChipInput
              placeholder={t('enter_knowledge_base_name')}
              {...register('name')}
              error={Boolean(errors.name)}
              autoComplete='off'
              autoCorrect='off'
              autoCapitalize='off'
              data-lpignore='true'
              data-form-type='other'
            />
          </ChipModalField>

          <ChipModalField type='custom' title={t('description')}>
            <ChipTextarea
              placeholder={t('describe_this_knowledge_base_optional')}
              rows={4}
              {...register('description')}
              error={Boolean(errors.description)}
            />
          </ChipModalField>

          <div className='flex gap-3'>
            <ChipModalField type='custom' title={t('min_chunk_size_characters')} className='flex-1'>
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

            <ChipModalField type='custom' title={t('max_chunk_size_tokens')} className='flex-1'>
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
            title={t('overlap_tokens')}
            hint={t('1_token_4_characters_max_chunk')}
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
            title={t('chunking_strategy')}
            hint={t('auto_detects_the_best_strategy_based')}
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
                title={t('regex_pattern')}
                error={errors.regexPattern?.message}
                hint={t('text_will_be_split_at_each')}
              >
                <ChipInput
                  placeholder={t('e_g_n_n_or_s')}
                  {...register('regexPattern')}
                  error={Boolean(errors.regexPattern)}
                  autoComplete='off'
                  data-form-type='other'
                />
              </ChipModalField>

              <ChipModalField
                type='custom'
                title={t('chunk_boundaries')}
                hint={t('preserve_boundaries_exactly_recommended_when_eac')}
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
                    {t('each_match_is_its_own_chunk')}
                  </span>
                </label>
              </ChipModalField>
            </>
          )}

          {strategyValue === 'recursive' && (
            <ChipModalField
              type='custom'
              title={t('custom_separators_optional')}
              hint={t('comma_separated_list_of_delimiters_in')}
            >
              <ChipInput
                placeholder={t('e_g_n_n_n')}
                {...register('customSeparators')}
                autoComplete='off'
                data-form-type='other'
              />
            </ChipModalField>
          )}

          <ChipModalField
            type='file'
            title={t('upload_documents')}
            accept={ACCEPT_ATTRIBUTE}
            multiple
            onChange={processFiles}
            description={t('pdf_doc_docx_txt_csv_xls')}
            error={fileError}
          />

          {files.length > 0 && (
            <ChipModalField type='custom' title={t('selected_files')}>
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
            onClick: handleSubmit(onSubmit),
            disabled: isSubmitting || !nameValue?.trim(),
          }}
        />
      </form>
    </ChipModal>
  )
})
