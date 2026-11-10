'use client'

import { useState } from 'react'
import { AttachmentGrid } from '@sim/emcn/attachments'
import { Checkbox } from '@sim/emcn/checkbox'
import { SelectField, TextAreaField, TextField } from '@sim/emcn/field'
import { FileField } from '@sim/emcn/field/file-field'
import { Modal } from '@sim/emcn/modal'
import { generateId } from '@sim/utils/id'
import { toast } from '@/lib/toast/sink'
import styles from '@/app/(product)/workspace/[workspaceId]/knowledge/_components/create-base-modal/create-base-modal.module.css'
import {
  ACCEPT_ATTRIBUTE,
  assertMultiFileUploadAdmission,
  formatFileSize,
  KNOWLEDGE_BASE_DESCRIPTION_MAX_LENGTH,
  MAX_CHUNKING_SEPARATOR_LENGTH,
  MAX_CHUNKING_SEPARATORS,
  MultiFileUploadAdmissionError,
  useCreateKnowledgeBase,
  useDeleteKnowledgeBase,
  useKnowledgeUpload,
  validateKnowledgeBaseFile,
} from '@/platform/lib/data/knowledge'

const STRATEGIES = [
  { value: 'auto', label: 'Auto (detect from content)' },
  { value: 'text', label: 'Text (word boundary splitting)' },
  { value: 'recursive', label: 'Recursive (configurable separators)' },
  { value: 'sentence', label: 'Sentence' },
  { value: 'token', label: 'Token (fixed-size)' },
  { value: 'regex', label: 'Regex (custom pattern)' },
] as const

type Strategy = (typeof STRATEGIES)[number]['value']

interface Draft {
  name: string
  description: string
  minChunkSize: string
  maxChunkSize: string
  overlapSize: string
  strategy: Strategy
  regexPattern: string
  strictBoundaries: boolean
  separators: string
}

const EMPTY_DRAFT: Draft = {
  name: '',
  description: '',
  minChunkSize: '100',
  maxChunkSize: '1024',
  overlapSize: '200',
  strategy: 'auto',
  regexPattern: '',
  strictBoundaries: false,
  separators: '',
}

type Errors = Partial<Record<keyof Draft | 'files', string>>

/** The comma-separated separator field, as the list the API receives. */
function parseSeparators(value: string) {
  if (!value.trim()) return []
  return value
    .split(',')
    .map((separator) => separator.trim().replace(/\\n/g, '\n').replace(/\\t/g, '\t'))
}

/** The same rules as legacy's form schema, field by field. */
function validate(draft: Draft): Errors {
  const errors: Errors = {}
  const min = Number(draft.minChunkSize)
  const max = Number(draft.maxChunkSize)
  const overlap = Number(draft.overlapSize)
  if (!draft.name.trim()) errors.name = 'Name is required'
  else if (draft.name.length > 100) errors.name = 'Name must be less than 100 characters'
  if (draft.description.length > KNOWLEDGE_BASE_DESCRIPTION_MAX_LENGTH)
    errors.description = `Description must be ${KNOWLEDGE_BASE_DESCRIPTION_MAX_LENGTH} characters or less`
  if (!Number.isFinite(min) || min < 1) errors.minChunkSize = 'Min chunk size must be at least 1'
  else if (min > 2000) errors.minChunkSize = 'Min chunk size must be less than 2000 characters'
  if (!Number.isFinite(max) || max < 100)
    errors.maxChunkSize = 'Max chunk size must be at least 100'
  else if (max > 4000) errors.maxChunkSize = 'Max chunk size must be less than 4000 tokens'
  if (!Number.isFinite(overlap) || overlap < 0) errors.overlapSize = 'Overlap must be non-negative'
  else if (overlap > 500) errors.overlapSize = 'Overlap must be less than 500 tokens'
  if (!errors.minChunkSize && !errors.maxChunkSize && min >= max * 4)
    errors.minChunkSize =
      'Min chunk size (characters) must be less than max chunk size (tokens × 4)'
  if (!errors.overlapSize && !errors.maxChunkSize && overlap >= max)
    errors.overlapSize = 'Overlap must be less than max chunk size'
  if (draft.strategy === 'regex' && !draft.regexPattern.trim())
    errors.regexPattern = 'Regex pattern is required when using the regex strategy'
  if (draft.strategy === 'recursive') {
    const separators = parseSeparators(draft.separators)
    if (separators.length > MAX_CHUNKING_SEPARATORS)
      errors.separators = `At most ${MAX_CHUNKING_SEPARATORS} separators are allowed`
    else if (separators.some((separator) => separator.length > MAX_CHUNKING_SEPARATOR_LENGTH))
      errors.separators = `Each separator must be ${MAX_CHUNKING_SEPARATOR_LENGTH} characters or less`
  }
  return errors
}

interface CreateBaseModalProps {
  workspaceId: string
  open: boolean
  onOpenChange: (open: boolean) => void
  /** The folder the list shows, so the new base appears where the reader is looking. */
  folderId: string | null
}

/**
 * New knowledge base: a name, an optional description, the chunking configuration and optional
 * first documents. When the upload fails the new base is deleted again, so nothing half-made stays.
 */
export function CreateBaseModal({
  workspaceId,
  open,
  onOpenChange,
  folderId,
}: CreateBaseModalProps) {
  const createBase = useCreateKnowledgeBase()
  const deleteBase = useDeleteKnowledgeBase()
  const upload = useKnowledgeUpload({ workspaceId })
  const [draft, setDraft] = useState(EMPTY_DRAFT)
  const [files, setFiles] = useState<{ id: string; file: File }[]>([])
  const [errors, setErrors] = useState<Errors>({})
  const [attempted, setAttempted] = useState(false)
  const [shownOpen, setShownOpen] = useState(open)
  if (shownOpen !== open) {
    setShownOpen(open)
    if (open) {
      setDraft(EMPTY_DRAFT)
      setFiles([])
      setErrors({})
      setAttempted(false)
    }
  }

  const update = <K extends keyof Draft>(key: K, value: Draft[K]) => {
    const next = { ...draft, [key]: value }
    setDraft(next)
    if (attempted) setErrors((current) => ({ ...validate(next), files: current.files }))
  }

  const addFiles = (chosen: File[]) => {
    if (!chosen.length) return
    try {
      assertMultiFileUploadAdmission(chosen, { existingFiles: files.map((entry) => entry.file) })
      const rejected = chosen.map(validateKnowledgeBaseFile).find(Boolean)
      if (rejected) {
        setErrors((current) => ({ ...current, files: rejected }))
        return
      }
      setErrors((current) => ({ ...current, files: undefined }))
      setFiles((current) => [...current, ...chosen.map((file) => ({ id: generateId(), file }))])
    } catch (error) {
      setErrors((current) => ({
        ...current,
        files:
          error instanceof MultiFileUploadAdmissionError
            ? error.message
            : 'An error occurred while processing files. Please try again.',
      }))
    }
  }

  const progress = upload.uploadProgress
  const confirmLabel = upload.isUploading
    ? progress.stage === 'uploading'
      ? `Uploading ${progress.filesCompleted}/${progress.totalFiles}…`
      : progress.stage === 'processing'
        ? 'Processing…'
        : 'Creating…'
    : createBase.isPending || deleteBase.isPending
      ? 'Creating…'
      : 'Create knowledge base'

  return (
    <Modal
      open={open}
      onOpenChange={(next) => {
        if (!next) upload.clearError()
        onOpenChange(next)
      }}
      title='New knowledge base'
      confirmLabel={confirmLabel}
      confirmDisabled={!draft.name.trim()}
      onConfirm={async () => {
        setAttempted(true)
        const found = validate(draft)
        setErrors((current) => ({ ...found, files: current.files }))
        if (Object.keys(found).length) return false
        const strategyOptions =
          draft.strategy === 'regex' && draft.regexPattern
            ? {
                pattern: draft.regexPattern,
                ...(draft.strictBoundaries && { strictBoundaries: true }),
              }
            : draft.strategy === 'recursive' && draft.separators.trim()
              ? { separators: parseSeparators(draft.separators) }
              : undefined
        const base = await createBase.mutateAsync({
          name: draft.name,
          description: draft.description || undefined,
          workspaceId,
          folderId,
          chunkingConfig: {
            maxSize: Number(draft.maxChunkSize),
            minSize: Number(draft.minChunkSize),
            overlap: Number(draft.overlapSize),
            ...(draft.strategy !== 'auto' && { strategy: draft.strategy }),
            ...(strategyOptions && { strategyOptions }),
          },
        })
        if (!files.length) return
        try {
          await upload.uploadFiles(
            files.map((entry) => entry.file),
            base.id,
            { recipe: 'default' }
          )
        } catch (error) {
          await deleteBase
            .mutateAsync({ knowledgeBaseId: base.id })
            .catch(() => toast.error(`${base.name} was created, but its upload failed`))
          throw error
        }
      }}
    >
      <TextField
        label='Name'
        placeholder='Enter knowledge base name'
        value={draft.name}
        onChange={(value) => update('name', value)}
        error={errors.name}
        autoComplete='off'
        required
      />
      <TextAreaField
        label='Description'
        optional
        placeholder='Describe this knowledge base'
        value={draft.description}
        onChange={(value) => update('description', value)}
        error={errors.description}
      />
      <div className={styles.pair}>
        <TextField
          label='Min chunk size (characters)'
          placeholder='100'
          type='number'
          inputMode='numeric'
          value={draft.minChunkSize}
          onChange={(value) => update('minChunkSize', value)}
          error={errors.minChunkSize}
        />
        <TextField
          label='Max chunk size (tokens)'
          placeholder='1024'
          type='number'
          inputMode='numeric'
          value={draft.maxChunkSize}
          onChange={(value) => update('maxChunkSize', value)}
          error={errors.maxChunkSize}
        />
      </div>
      <TextField
        label='Overlap (tokens)'
        placeholder='200'
        type='number'
        inputMode='numeric'
        hint='1 token ≈ 4 characters. Max chunk size and overlap are in tokens.'
        value={draft.overlapSize}
        onChange={(value) => update('overlapSize', value)}
        error={errors.overlapSize}
      />
      <SelectField
        label='Chunking strategy'
        hint='Auto detects the best strategy based on file content type.'
        options={STRATEGIES}
        value={draft.strategy}
        onValueChange={(value) => update('strategy', value)}
      />
      {draft.strategy === 'regex' && (
        <>
          <TextField
            label='Regex pattern'
            placeholder='e.g. \n\n or (?<=\})\s*(?=\{)'
            value={draft.regexPattern}
            onChange={(value) => update('regexPattern', value)}
            error={errors.regexPattern}
            autoComplete='off'
          />
          <Checkbox
            label="Each match is its own chunk (don't merge)"
            description='Preserve boundaries exactly. Recommended when each match is a discrete record, such as one QA pair per chunk.'
            checked={draft.strictBoundaries}
            onCheckedChange={(checked) => update('strictBoundaries', checked)}
          />
        </>
      )}
      {draft.strategy === 'recursive' && (
        <TextField
          label='Custom separators'
          optional
          placeholder='e.g. \n\n, \n, . '
          hint={`Comma-separated delimiters in priority order, up to ${MAX_CHUNKING_SEPARATORS}. Leave empty for the default separators.`}
          value={draft.separators}
          onChange={(value) => update('separators', value)}
          error={errors.separators}
          autoComplete='off'
        />
      )}
      <FileField
        label='Upload documents'
        optional
        multiple
        accept={ACCEPT_ATTRIBUTE}
        prompt='Choose files or drag them here'
        hint='PDF, DOC, DOCX, TXT, CSV, XLS, XLSX, MD, PPT, PPTX, HTML, JSONL (max 20 files, 100MB each, 500MB total)'
        error={errors.files}
        disabled={upload.isUploading}
        onFilesChange={addFiles}
      />
      {files.length > 0 && (
        <AttachmentGrid
          label='Selected files'
          layout='list'
          attachments={files.map((entry, index) => ({
            id: entry.id,
            name: entry.file.name,
            description:
              upload.uploadProgress.fileStatuses?.[index]?.status === 'failed'
                ? 'Failed'
                : formatFileSize(entry.file.size),
            kind: 'pdf' as const,
          }))}
          onRemove={
            upload.isUploading
              ? undefined
              : (id) => setFiles((current) => current.filter((entry) => entry.id !== id))
          }
        />
      )}
    </Modal>
  )
}
