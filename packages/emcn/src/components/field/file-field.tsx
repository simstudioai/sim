'use client'

import { useId, useState } from 'react'
import { IconButton } from '#emcn/components/button/button'
import styles from '#emcn/components/field/file-field.module.css'
import { FieldFrame, fieldDescription } from '#emcn/components/field/frame'

interface FileFieldProps {
  label: string
  /** Called with what was chosen or dropped. `accept` is only a hint, so validate the file here. */
  onFileChange: (file: File) => void
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

/** Choose or drop one file. The caller owns reading and uploading it. */
export function FileField({
  label,
  onFileChange,
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
          disabled={disabled}
          aria-invalid={error ? true : undefined}
          aria-describedby={[`${id}-selection`, fieldDescription(id, error, hint)]
            .filter(Boolean)
            .join(' ')}
          onDragEnter={() => setDragging(true)}
          onDragLeave={() => setDragging(false)}
          onDrop={() => setDragging(false)}
          onChange={(event) => {
            const file = event.currentTarget.files?.[0]
            event.currentTarget.value = ''
            if (file) onFileChange(file)
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
