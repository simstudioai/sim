'use client'

import { useCallback, useEffect, useState } from 'react'
import { createLogger } from '@sim/logger'
import { RotateCcw, X } from 'lucide-react'
import { useParams } from 'next/navigation'
import { useTranslations } from 'next-intl'
import {
  Button,
  ChipModal,
  ChipModalBody,
  ChipModalError,
  ChipModalField,
  ChipModalFooter,
  ChipModalHeader,
  Loader,
} from '@/components/emcn'
import { cn } from '@/lib/core/utils/cn'
import { formatFileSize, validateKnowledgeBaseFile } from '@/lib/uploads/utils/file-utils'
import { ACCEPT_ATTRIBUTE } from '@/lib/uploads/utils/validation'
import { useKnowledgeUpload } from '@/app/workspace/[workspaceId]/knowledge/hooks/use-knowledge-upload'

const logger = createLogger('AddDocumentsModal')

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
  const tI18n = useTranslations('auto')
  const t = useTranslations('auto')
  const params = useParams()
  const workspaceId = params.workspaceId as string
  const [files, setFiles] = useState<File[]>([])
  const [fileError, setFileError] = useState<string | null>(null)
  const [retryingIndexes, setRetryingIndexes] = useState<Set<number>>(() => new Set())

  const { isUploading, uploadProgress, uploadFiles, uploadError, clearError } = useKnowledgeUpload({
    workspaceId,
  })

  useEffect(() => {
    if (open) {
      setFiles([])
      setFileError(null)
      setRetryingIndexes(new Set())
      clearError()
    }
  }, [open, clearError])

  /** Handles close with upload guard */
  const handleOpenChange = useCallback(
    (newOpen: boolean) => {
      if (!newOpen) {
        if (isUploading) return
        setFiles([])
        setFileError(null)
        clearError()
        setRetryingIndexes(new Set())
      }
      onOpenChange(newOpen)
    },
    [isUploading, clearError, onOpenChange]
  )

  const handleClose = () => {
    handleOpenChange(false)
  }

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

  const handleRetryFile = async (index: number) => {
    const fileToRetry = files[index]
    if (!fileToRetry) return

    setRetryingIndexes((prev) => new Set(prev).add(index))

    try {
      await uploadFiles([fileToRetry], knowledgeBaseId, {
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
        recipe: 'default',
      })
      logger.info(`Successfully uploaded ${files.length} files`)
      handleClose()
    } catch (error) {
      logger.error('Error uploading files:', error)
    }
  }

  return (
    <ChipModal
      open={open}
      onOpenChange={handleOpenChange}
      srTitle={tI18n('new_documents')}
      size='md'
    >
      <ChipModalHeader onClose={() => handleOpenChange(false)}>
        {t('new_documents')}
      </ChipModalHeader>

      <ChipModalBody>
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
            <div className='flex flex-col gap-2'>
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
                              onClick={() => handleRetryFile(index)}
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
          </ChipModalField>
        )}

        {uploadError && <ChipModalError>{uploadError.message}</ChipModalError>}
      </ChipModalBody>

      <ChipModalFooter
        onCancel={handleClose}
        cancelDisabled={isUploading}
        primaryAction={{
          label: isUploading
            ? uploadProgress.stage === 'uploading'
              ? `Uploading ${uploadProgress.filesCompleted}/${uploadProgress.totalFiles}...`
              : uploadProgress.stage === 'processing'
                ? 'Processing...'
                : 'Uploading...'
            : 'Upload',
          onClick: handleUpload,
          disabled: files.length === 0 || isUploading,
        }}
      />
    </ChipModal>
  )
}
