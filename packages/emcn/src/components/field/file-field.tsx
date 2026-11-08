'use client'

import { useId, useState } from 'react'
import { IconButton } from '#emcn/components/button/button'
import styles from '#emcn/components/field/file-field.module.css'
import { FieldFrame, fieldDescription } from '#emcn/components/field/frame'

type FileChoice =
  | {
      multiple?: false
      /** Called with what was chosen or dropped. `accept` is only a hint, so validate the file here. */
      onFileChange: (file: File) => void
      onFilesChange?: never
    }
  | {
      /** Accepts several files at once, such as a batch of documents. */
      multiple: true
      /** Called with every file chosen or dropped. `accept` is only a hint, so validate them here. */
      onFilesChange: (files: File[]) => void
      onFileChange?: never
    }

type FileFieldProps = FileChoice & {
  label: string
  accept?: string
  kind?: 'file' | 'image'
  prompt?: string
  selection?: { name: string; detail?: string; previewSrc?: string }
  onClear?: () => void
  optional?: boolean
  disabled?: boolean
  error?: string
  hint?: string
}

/** Choose or drop a file, or several with `multiple`. The caller owns reading and uploading them. */
export function FileField({
  label,
  multiple,
  onFileChange,
  onFilesChange,
  accept,
  kind = 'file',
  prompt,
  selection,
  onClear,
  optional,
  disabled,
  error,
  hint,
}: FileFieldProps) {
  const id = useId()
  const [dragging, setDragging] = useState(false)
  return (
    <FieldFrame id={id} label={label} optional={optional} error={error} hint={hint}>
      <div
        className={styles.fileDrop}
        data-kind={kind}
        data-dragging={dragging || undefined}
        data-invalid={error ? true : undefined}
        data-disabled={disabled || undefined}
      >
        {selection?.previewSrc && (
          <img className={styles.filePreview} alt='' src={selection.previewSrc} />
        )}
        <span
          id={`${id}-selection`}
          className={styles.fileCopy}
          data-visually-hidden={(kind === 'image' && Boolean(selection?.previewSrc)) || undefined}
        >
          <span data-selected={selection ? true : undefined} data-type='T060'>
            {selection?.name ??
              prompt ??
              (kind === 'image' ? 'Upload' : 'Choose a file or drag it here')}
          </span>
          {selection?.detail && <span data-type='T052'>{selection.detail}</span>}
        </span>
        <input
          id={id}
          className={styles.fileInput}
          type='file'
          accept={accept}
          multiple={multiple}
          disabled={disabled}
          aria-invalid={error ? true : undefined}
          aria-describedby={[`${id}-selection`, fieldDescription(id, error, hint)]
            .filter(Boolean)
            .join(' ')}
          onDragEnter={() => setDragging(true)}
          onDragLeave={() => setDragging(false)}
          onDrop={() => setDragging(false)}
          onChange={(event) => {
            const files = Array.from(event.currentTarget.files ?? [])
            event.currentTarget.value = ''
            if (!files.length) return
            if (onFilesChange) onFilesChange(files)
            else onFileChange?.(files[0])
          }}
        />
        {selection && onClear && (
          <span className={styles.fileRemove}>
            <IconButton
              size='row'
              label={`Remove ${selection.name}`}
              icon='I105'
              disabled={disabled}
              onClick={onClear}
            />
          </span>
        )}
      </div>
    </FieldFrame>
  )
}
