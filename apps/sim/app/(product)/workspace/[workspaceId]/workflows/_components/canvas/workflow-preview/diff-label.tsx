'use client'

import { cn } from '@sim/emcn/lib/cn'
import styles from '@/app/(product)/workspace/[workspaceId]/workflows/_components/canvas/workflow-preview/diff-label.module.css'
import type { BlockDiffStatus } from '@/platform/lib/data/workflows'

/** The word for each comparison status. */
const DIFF_LABEL: Record<BlockDiffStatus, string> = {
  added: 'Added',
  modified: 'Modified',
  removed: 'Removed',
}

const DIFF_LABEL_CLASS: Record<BlockDiffStatus, string | undefined> = {
  added: styles.added,
  modified: styles.modified,
  removed: styles.removed,
}

interface DiffStatusLabelProps {
  status: BlockDiffStatus
}

/**
 * The comparison label floating above a canvas card or container: the same
 * chrome wherever it appears so a block and a loop read as one system.
 */
export function DiffStatusLabel({ status }: DiffStatusLabelProps) {
  return <div className={cn(styles.label, DIFF_LABEL_CLASS[status])}>{DIFF_LABEL[status]}</div>
}
