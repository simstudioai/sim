'use client'

import { useState } from 'react'
import { IconButton } from '@sim/emcn/button'
import { FileField } from '@sim/emcn/field/file-field'
import { Modal } from '@sim/emcn/modal'
import { OverflowText } from '@sim/emcn/overflow-text'
import { useScrollEdges } from '@sim/emcn/scroll-area/use-scroll-edges'
import { Spinner, StatusText } from '@sim/emcn/status'
import { getErrorMessage } from '@sim/utils/errors'
import { toRecord } from '@sim/utils/object'
import styles from '@/app/(product)/workspace/[workspaceId]/knowledge/[knowledgeBaseId]/_components/add-documents-modal/add-documents-modal.module.css'
import {
  ACCEPT_ATTRIBUTE,
  assertMultiFileUploadAdmission,
  formatFileSize,
  MultiFileUploadAdmissionError,
  useKnowledgeUpload,
  validateKnowledgeBaseFile,
} from '@/platform/lib/data/knowledge'

const SUPPORTED =
  'PDF, DOC, DOCX, TXT, CSV, XLS, XLSX, MD, PPTX, HTML, JSON, JSONL and YAML. Up to 20 files, 100 MB each and 500 MB in all.'

/** The files a partly failed upload could not send; the rest arrived and leave the list. */
function failedFiles(details: unknown): File[] {
  const failed = toRecord(details).failedFiles
  if (!Array.isArray(failed)) return []
  return failed.flatMap((entry) => {
    const file = toRecord(entry).file
    return file instanceof File ? [file] : []
  })
}

interface AddDocumentsModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  workspaceId: string
  knowledgeBaseId: string
}

/**
 * Uploads documents into a base: up to 20 at once, each through a signed upload session, three in
 * parallel. Each file shows its own progress; one that fails can be retried on its own, and nothing
 * closes the dialog while files are on their way.
 */
export function AddDocumentsModal({
  open,
  onOpenChange,
  workspaceId,
  knowledgeBaseId,
}: AddDocumentsModalProps) {
  const filesEdges = useScrollEdges<HTMLUListElement>()
  const [files, setFiles] = useState<File[]>([])
  const [failed, setFailed] = useState<ReadonlySet<File>>(() => new Set())
  const [batch, setBatch] = useState<readonly File[]>([])
  const [fileError, setFileError] = useState<string>()
  const upload = useKnowledgeUpload({ workspaceId })
  const [wasOpen, setWasOpen] = useState(open)
  if (wasOpen !== open) {
    setWasOpen(open)
    if (open) {
      setFiles([])
      setFailed(new Set())
      setFileError(undefined)
      upload.clearError()
    }
  }

  function add(chosen: File[]) {
    if (chosen.length === 0) return
    try {
      assertMultiFileUploadAdmission(chosen, { existingFiles: files })
    } catch (error) {
      setFileError(
        error instanceof MultiFileUploadAdmissionError
          ? error.message
          : 'These files could not be added. Try again.'
      )
      return
    }
    const problems = chosen.map((file) => validateKnowledgeBaseFile(file)).filter(Boolean)
    if (problems[0]) {
      setFileError(problems[0])
      return
    }
    setFileError(undefined)
    setFiles((current) => [...current, ...chosen])
  }

  function remove(file: File) {
    setFiles((current) => current.filter((entry) => entry !== file))
    setFailed((current) => {
      const next = new Set(current)
      next.delete(file)
      return next
    })
  }

  async function send(targets: File[]) {
    setBatch(targets)
    try {
      await upload.uploadFiles(targets, knowledgeBaseId, { recipe: 'default' })
      setFiles((current) => current.filter((file) => !targets.includes(file)))
      setFailed((current) => new Set([...current].filter((file) => !targets.includes(file))))
    } catch (error) {
      const left = failedFiles(toRecord(error).details)
      if (left.length > 0) {
        setFiles((current) =>
          current.filter((file) => !targets.includes(file) || left.includes(file))
        )
        setFailed((current) => new Set([...current, ...left]))
      }
      throw new Error(getErrorMessage(error, 'The documents could not be uploaded.'))
    } finally {
      setBatch([])
    }
  }

  const progress = upload.uploadProgress
  const label = upload.isUploading
    ? progress.stage === 'uploading'
      ? `Uploading ${progress.filesCompleted}/${progress.totalFiles}…`
      : progress.stage === 'processing'
        ? 'Processing…'
        : 'Uploading…'
    : 'Upload'

  return (
    <Modal
      open={open}
      onOpenChange={(next) => {
        if (!next && upload.isUploading) return
        onOpenChange(next)
      }}
      title='New documents'
      confirmLabel={label}
      confirmDisabled={files.length === 0}
      pending={upload.isUploading}
      onConfirm={() => send(files)}
    >
      <FileField
        label='Documents'
        accept={ACCEPT_ATTRIBUTE}
        multiple
        prompt='Choose files or drag them here'
        hint={SUPPORTED}
        error={fileError}
        disabled={upload.isUploading}
        onFilesChange={add}
      />
      {files.length > 0 && (
        <ul ref={filesEdges} className={styles.files} aria-label='Selected files'>
          {files.map((file) => {
            const index = batch.indexOf(file)
            const status = index >= 0 ? progress.fileStatuses?.[index] : undefined
            const sending = status?.status === 'uploading' || status?.status === 'pending'
            const isFailed = status?.status === 'failed' || (failed.has(file) && !sending)
            return (
              <li key={`${file.name}-${file.size}-${file.lastModified}`} className={styles.file}>
                <span className={styles.name} data-type='T060'>
                  <OverflowText text={file.name}>{file.name}</OverflowText>
                </span>
                <span className={styles.detail} data-type='T060'>
                  {sending && status?.progress !== undefined
                    ? `${Math.round(status.progress)}%`
                    : formatFileSize(file.size, { includeBytes: true })}
                </span>
                {isFailed && <StatusText label='Failed' intent='danger' />}
                <span className={styles.actions}>
                  {sending ? (
                    <Spinner />
                  ) : (
                    <>
                      {isFailed && (
                        <IconButton
                          label={`Retry ${file.name}`}
                          icon='I055'
                          disabled={upload.isUploading}
                          onClick={() => void send([file]).catch(() => {})}
                        />
                      )}
                      <IconButton
                        label={`Remove ${file.name}`}
                        icon='I105'
                        disabled={upload.isUploading}
                        onClick={() => remove(file)}
                      />
                    </>
                  )}
                </span>
              </li>
            )
          })}
        </ul>
      )}
    </Modal>
  )
}
