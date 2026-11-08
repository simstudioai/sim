'use client'

import { cn } from '@sim/emcn/lib/cn'
import { Handle, Position } from '@xyflow/react'
import { OverflowSpan } from '@/platform/app/(shell)/workspace/[workspaceId]/workflows/_components/canvas/workflow-block/overflow-span'
import styles from '@/platform/app/(shell)/workspace/[workspaceId]/workflows/_components/canvas/workflow-preview/port-rows.module.css'
import type { PreviewPortRow } from '@/platform/app/(shell)/workspace/[workspaceId]/workflows/_components/canvas/workflow-preview/preview-ports'
import { BLOCK_DIMENSIONS, getDisplayValue } from '@/platform/lib/data/workflows'

interface PreviewPortRowsProps {
  rows: readonly PreviewPortRow[]
  changedFields?: ReadonlySet<string>
  lightweight?: boolean
  borderWidth?: number
}

/** Rows and connection anchors share one fixed layout in cards and container footers. */
export function PreviewPortRows({
  rows,
  changedFields,
  lightweight = false,
  borderWidth = 0,
}: PreviewPortRowsProps) {
  if (!rows.length) return null
  return (
    <div className={styles.rows}>
      {rows.map((row) => (
        <div
          key={row.handleId ? `${row.type}:${row.handleId}` : row.title}
          className={cn(
            styles.row,
            row.removed
              ? styles.removed
              : row.field && changedFields?.has(row.field) && styles.changed
          )}
        >
          <OverflowSpan
            value={row.removed ? `Removed ${row.title}` : row.title}
            className={styles.title}
          />
          {!lightweight && (
            <OverflowSpan value={getDisplayValue(row.value)} className={styles.value} />
          )}
        </div>
      ))}
      {rows.map((row, index) =>
        row.handleId && row.type ? (
          <Handle
            key={`${row.type}:${row.handleId}`}
            type={row.type}
            position={row.type === 'target' ? Position.Left : Position.Right}
            id={row.handleId}
            className={cn(
              styles.handle,
              row.type === 'target' ? styles.handleTarget : styles.handleSource,
              row.removed && styles.handleRemoved
            )}
            style={{
              top:
                BLOCK_DIMENSIONS.WORKFLOW_CONTENT_PADDING / 2 +
                BLOCK_DIMENSIONS.WORKFLOW_ROW_HEIGHT / 2 +
                index *
                  (BLOCK_DIMENSIONS.WORKFLOW_ROW_HEIGHT + BLOCK_DIMENSIONS.WORKFLOW_CONTENT_GAP),
              [row.type === 'target' ? 'left' : 'right']: -7 - borderWidth,
              transform: 'translateY(-50%)',
            }}
          />
        ) : null
      )}
    </div>
  )
}
