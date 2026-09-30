'use client'

import { ArrowRight } from '@sim/emcn/icons'
import { resolveFieldLabel } from '@/lib/workflows/comparison/resolve-values'
import {
  classifyChange,
  formatScalar,
} from '@/app/workspace/[workspaceId]/w/components/workflow-diff/utils'
import { formatParameterLabel } from '@/tools/params'

interface BindingChangeRowProps {
  blockType: string
  field: string
  oldValue: unknown
  newValue: unknown
}

/**
 * A workspace-bound field that differs between the two sides. Muted on purpose:
 * the sync's Mappings and Trigger URLs sections decide what these become, so
 * the row only records that they differ, and by what, never as a red or green
 * change competing with the logic rows above it.
 */
export function BindingChangeRow({ blockType, field, oldValue, newValue }: BindingChangeRowProps) {
  const resolved = resolveFieldLabel(blockType, field)
  const label = resolved === field ? formatParameterLabel(field) : resolved
  const kind = classifyChange(blockType, field, oldValue, newValue)

  return (
    <div className='flex min-w-0 items-center gap-2 text-caption'>
      <span className='w-[112px] shrink-0 truncate text-[var(--text-tertiary)]'>{label}</span>
      {kind === 'secret' ? (
        <span className='text-[var(--text-muted)]'>Differs between workspaces</span>
      ) : (
        <>
          <span className='min-w-0 truncate text-[var(--text-muted)]'>
            {formatScalar(blockType, field, oldValue)}
          </span>
          <ArrowRight className='size-[12px] shrink-0 text-[var(--text-icon)]' />
          <span className='min-w-0 truncate text-[var(--text-tertiary)]'>
            {formatScalar(blockType, field, newValue)}
          </span>
        </>
      )}
    </div>
  )
}
