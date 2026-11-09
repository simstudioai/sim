import type { ReactNode } from 'react'
import { IconButton } from '@sim/emcn/button'
import { Spinner } from '@sim/emcn/status'
import styles from '@/app/(product)/workspace/[workspaceId]/workflows/_components/editor/file-upload/file-upload.module.css'
import {
  formatDisplayText,
  type WorkflowSearchTextHighlight,
} from '@/app/(product)/workspace/[workspaceId]/workflows/_components/editor/formatted-text/formatted-text'
import { ItemCard } from '@/app/(product)/workspace/[workspaceId]/workflows/_components/editor/item-card/item-card'

interface FileRowProps {
  /** The full file name, for the row's accessible name and its native tooltip. */
  name: string
  /** The shortened name shown in the row. */
  label: string
  sizeLabel: string
  highlight?: WorkflowSearchTextHighlight | null
  deleting?: boolean
  removeDisabled?: boolean
  /** Leave it out for a file still uploading, which shows its progress instead. */
  onRemove?: () => void
  /** A picker that swaps this file for another, beside the remove action. */
  replace?: ReactNode
}

/**
 * One file the block holds, or one still uploading: its name and size, with removal and an optional
 * replace picker, or a spinner while it uploads or is removed.
 */
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
  const busy = deleting || !onRemove
  return (
    <ItemCard
      name={
        <span title={name}>
          {formatDisplayText(label, { workflowSearchHighlight: highlight ?? null })}
        </span>
      }
      title={name}
      badges={
        <span className={styles.fileSize} data-type='T052'>
          {sizeLabel}
        </span>
      }
      expandable={false}
      expanded={false}
      actions={
        <>
          {replace}
          {busy ? (
            <span
              className={styles.fileStatus}
              role='status'
              aria-label={deleting ? `Removing ${name}` : `Uploading ${name}`}
            >
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
        </>
      }
    />
  )
}
