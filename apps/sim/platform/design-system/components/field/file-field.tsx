'use client'

import { useId, useState } from 'react'
import { IconButton } from '@/platform/design-system/components/button/button'
import styles from '@/platform/design-system/components/field/field.module.css'
import { FieldFrame, fieldDescription } from '@/platform/design-system/components/field/fields'
import { Icon } from '@/platform/design-system/components/icon/icon'

interface FileFieldProps {
  label: string
  /** Called with what was chosen or dropped. `accept` is only a hint, so validate the file here. */
  onFileChange: (file: File) => void
  accept?: string
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
  prompt = 'Choose a file or drag it here',
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
        data-dragging={dragging || undefined}
        data-invalid={error ? true : undefined}
        data-disabled={disabled || undefined}
      >
        {selection?.previewSrc ? (
          <img className={styles.filePreview} alt='' src={selection.previewSrc} />
        ) : (
          <Icon name='I117' />
        )}
        <span className={styles.fileCopy}>
          <span data-selected={selection ? true : undefined} data-type='T060'>
            {selection?.name ?? prompt}
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
          aria-describedby={fieldDescription(id, error, hint)}
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
