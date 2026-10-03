'use client'

import { cn, OverflowText } from '@sim/emcn'
import { BLOCK_DIMENSIONS } from '@sim/workflow-renderer'
import { Handle, Position } from '@xyflow/react'
import { getDisplayValue } from '@/lib/workflows/subblocks/display'
import type { PreviewPortRow } from '@/app/workspace/[workspaceId]/w/components/preview/components/preview-workflow/preview-ports'

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
    <div className='relative flex flex-col gap-2 p-2'>
      {rows.map((row) => (
        <div
          key={row.handleId ? `${row.type}:${row.handleId}` : row.title}
          className={cn(
            'flex h-5 items-center gap-2',
            row.removed
              ? 'opacity-45'
              : row.field &&
                  changedFields?.has(row.field) &&
                  '-mx-1 rounded-sm bg-[color-mix(in_srgb,var(--warning)_14%,transparent)] px-1'
          )}
        >
          <OverflowText
            label={row.removed ? `Removed ${row.title}` : row.title}
            className='text-[var(--text-tertiary)] text-sm'
          />
          {!lightweight && (
            <OverflowText
              label={getDisplayValue(row.value)}
              className='flex-1 text-right text-[var(--text-primary)] text-sm'
            />
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
              'z-[10]! h-5! w-[7px]! border-none! bg-[var(--workflow-edge)]!',
              row.type === 'target'
                ? 'rounded-r-none! rounded-l-[2px]!'
                : 'rounded-r-[2px]! rounded-l-none!',
              row.removed && 'opacity-45!'
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
