'use client'

import { type ChangeEvent, useRef } from 'react'
import { Spinner } from '@sim/emcn/status'
import { useActiveSearchTarget } from '@/platform/app/(shell)/workspace/[workspaceId]/workflows/_components/editor/active-search-target/active-search-target'
import { FilePicker } from '@/platform/app/(shell)/workspace/[workspaceId]/workflows/_components/editor/file-upload/file-picker'
import { FileRow } from '@/platform/app/(shell)/workspace/[workspaceId]/workflows/_components/editor/file-upload/file-row'
import styles from '@/platform/app/(shell)/workspace/[workspaceId]/workflows/_components/editor/file-upload/file-upload.module.css'
import { getWorkflowSearchLabelHighlight } from '@/platform/app/(shell)/workspace/[workspaceId]/workflows/_components/editor/formatted-text/search-highlight'
import {
  type FileUploadValue,
  formatUploadedFileSize,
  useFileUpload,
} from '@/platform/lib/data/workflow-editor/uploads'

const DEFAULT_MAX_SIZE_MB = 10

interface FileUploadProps {
  blockId: string
  subBlockId: string
  /** Comma-separated MIME types, wildcards or extensions; `*` accepts every file. */
  acceptedTypes?: string
  multiple?: boolean
  /** In megabytes. */
  maxSize?: number
  /** Blocks new uploads (and unpublishable workspace files) unless S3 or Blob is configured. */
  requiresCloudStorage?: boolean
  /** A sibling folder field narrowing the picker, and the switch saying whether it descends. */
  folderScope?: { fieldId: string; recursiveFieldId?: string }
  isPreview?: boolean
  previewValue?: unknown
  disabled?: boolean
  /** Controlled value; with `onValueChange` the sub-block store is left alone. */
  value?: FileUploadValue
  onValueChange?: (value: FileUploadValue) => void
}

/** Shortens a long file name in the middle, keeping its start and its extension. */
function truncateMiddle(text: string, start = 28, end = 18): string {
  if (!text) return ''
  if (text.length <= start + end + 3) return text
  return `${text.slice(0, start)}...${text.slice(-end)}`
}

/**
 * The file-upload sub-block: uploads to workspace storage, picks existing workspace files with
 * server search, and lists what the block holds with removal. Single mode shows the chosen file
 * with a compact Replace picker; multiple mode lists every file above an Add picker.
 */
export function FileUpload({
  blockId,
  subBlockId,
  acceptedTypes = '*',
  multiple = false,
  maxSize = DEFAULT_MAX_SIZE_MB,
  requiresCloudStorage = false,
  folderScope,
  isPreview = false,
  previewValue,
  disabled = false,
  value,
  onValueChange,
}: FileUploadProps) {
  const fileInputRef = useRef<HTMLInputElement>(null)
  const activeSearchTarget = useActiveSearchTarget()
  const upload = useFileUpload({
    blockId,
    subBlockId,
    acceptedTypes,
    multiple,
    maxSize,
    requiresCloudStorage,
    folderScope,
    isPreview,
    previewValue,
    disabled,
    value,
    onValueChange,
  })
  const { files, uploadingFiles, picker } = upload
  const isUploading = uploadingFiles.length > 0
  const controlsDisabled = isPreview || disabled

  function openFileDialog() {
    const input = fileInputRef.current
    if (upload.uploadBlocked || !input) return
    input.value = ''
    input.click()
  }

  function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    const selected = event.target.files
    if (!selected || selected.length === 0) return
    void upload.uploadFiles(Array.from(selected))
  }

  const uploadingNames = new Set(uploadingFiles.map((file) => file.name))
  const [singleFile] = files
  const singleLabel = singleFile ? truncateMiddle(singleFile.name, 20, 12) : ''

  return (
    <div
      role='presentation'
      className={styles.fileUpload}
      onClick={(event) => event.stopPropagation()}
    >
      <input
        ref={fileInputRef}
        type='file'
        hidden
        accept={acceptedTypes}
        multiple={multiple}
        tabIndex={-1}
        onChange={handleFileChange}
      />

      {upload.showCloudStorageWarning && (
        <p className={styles.note} data-type='T052'>
          Cloud storage (S3 or Blob) is required for file uploads. Configure S3_BUCKET_NAME and
          AWS_REGION, or Azure Blob env vars.
        </p>
      )}
      {upload.showFolderScopeNotice && (
        <p className={styles.note} data-type='T052'>
          Choose one available folder to upload a new file. Existing files can still be selected.
        </p>
      )}
      {upload.uploadError && (
        <p className={styles.error} data-type='T052' role='alert'>
          {upload.uploadError.message}
        </p>
      )}

      {((multiple && files.length > 0) || isUploading) && (
        <div className={styles.files}>
          {multiple &&
            files.map((file, index) => {
              if (uploadingNames.has(file.name)) return null
              const label = truncateMiddle(file.name)
              return (
                <FileRow
                  key={file.path || `${file.name}-${index}`}
                  name={file.name}
                  label={label}
                  sizeLabel={formatUploadedFileSize(file.size)}
                  highlight={getWorkflowSearchLabelHighlight({
                    activeSearchTarget,
                    blockId,
                    subBlockId,
                    valuePath: [index, 'name'],
                    label,
                  })}
                  deleting={upload.deletingPaths.has(file.path || '')}
                  removeDisabled={controlsDisabled}
                  onRemove={() => void upload.removeFile(file)}
                />
              )
            })}
          {isUploading && (
            <>
              {uploadingFiles.map((file) => (
                <div key={file.id} className={styles.file}>
                  <span className={styles.fileText}>
                    <span className={styles.fileName} data-type='T043'>
                      {file.name}
                    </span>
                    <span className={styles.fileSize} data-type='T052'>
                      {formatUploadedFileSize(file.size)}
                    </span>
                  </span>
                  <span className={styles.fileStatus}>
                    <Spinner />
                  </span>
                </div>
              ))}
              <div className={styles.progressBlock}>
                <progress
                  className={styles.progress}
                  value={upload.uploadProgress}
                  max={100}
                  aria-label='Upload progress'
                />
                <span className={styles.progressStatus} data-type='T052' role='status'>
                  {upload.uploadProgress < 100 ? 'Uploading…' : 'Upload complete'}
                </span>
              </div>
            </>
          )}
        </div>
      )}

      {!isUploading && (multiple || files.length === 0) && (
        <FilePicker
          picker={picker}
          purpose={files.length === 0 ? 'choose' : 'add'}
          disabled={controlsDisabled}
          uploadBlocked={upload.uploadBlocked}
          onSelect={upload.selectFile}
          onUpload={openFileDialog}
        />
      )}
      {!isUploading && !multiple && singleFile && (
        <FileRow
          name={singleFile.name}
          label={singleLabel}
          sizeLabel={formatUploadedFileSize(singleFile.size)}
          highlight={getWorkflowSearchLabelHighlight({
            activeSearchTarget,
            blockId,
            subBlockId,
            valuePath: [],
            label: singleLabel,
          })}
          deleting={upload.deletingPaths.has(singleFile.path || '')}
          removeDisabled={controlsDisabled}
          onRemove={() => void upload.removeFile(singleFile)}
          replace={
            <FilePicker
              picker={picker}
              purpose='replace'
              disabled={controlsDisabled || upload.deletingPaths.has(singleFile.path || '')}
              uploadBlocked={upload.uploadBlocked}
              onSelect={upload.selectFile}
              onUpload={openFileDialog}
            />
          }
        />
      )}
    </div>
  )
}
