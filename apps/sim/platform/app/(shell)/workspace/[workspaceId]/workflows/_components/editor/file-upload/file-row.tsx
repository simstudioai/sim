import type { ReactNode } from 'react'
import { IconButton } from '@sim/emcn/button'
import { Spinner } from '@sim/emcn/status'
import styles from '@/platform/app/(shell)/workspace/[workspaceId]/workflows/_components/editor/file-upload/file-upload.module.css'
import {
  formatDisplayText,
  type WorkflowSearchTextHighlight,
} from '@/platform/app/(shell)/workspace/[workspaceId]/workflows/_components/editor/formatted-text/formatted-text'

interface FileRowProps {
  /** The full file name, for the row's accessible name and its native tooltip. */
  name: string
  /** The shortened name shown in the row. */
  label: string
  sizeLabel: string
  highlight: WorkflowSearchTextHighlight | null
  deleting: boolean
  removeDisabled: boolean
  onRemove: () => void
  /** A picker that swaps this file for another, beside the remove action. */
  replace?: ReactNode
}

/** One file the block holds: its name and size, with removal and an optional replace picker. */
export function FileRow({
  name,
  label,
  sizeLabel,
  highlight,
  deleting,
  removeDisabled,
  onRemove,
  replace,
}: FileRowProps) {
  return (
    <div className={styles.file}>
      <span className={styles.fileText} title={name}>
        <span className={styles.fileName} data-type='T043'>
          {formatDisplayText(label, { workflowSearchHighlight: highlight })}
        </span>
        <span className={styles.fileSize} data-type='T052'>
          {sizeLabel}
        </span>
      </span>
      <span className={styles.fileActions}>
        {replace}
        {deleting ? (
          <span className={styles.fileStatus} role='status' aria-label={`Removing ${name}`}>
            <Spinner />
          </span>
        ) : (
          <IconButton
            label={`Remove ${name}`}
            icon='I105'
            size='compact'
            disabled={removeDisabled}
            onClick={onRemove}
          />
        )}
      </span>
    </div>
  )
}
