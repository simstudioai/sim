'use client'

import { Chip, ChipCombobox, ChipInput } from '@sim/emcn'
import type { WorkflowSearchReplacementOption } from '@/lib/workflows/search-replace/types'

interface ReplacementControlsProps {
  replacement: string
  compatibleResourceOptions: WorkflowSearchReplacementOption[]
  usesResourceReplacement: boolean
  eligibleCount: number
  disabled?: boolean
  isApplying?: boolean
  canReplaceActive: boolean
  canReplaceAll: boolean
  onReplacementChange: (replacement: string) => void
  onReplaceActive: () => void
  onReplaceAll: () => void
}

export function ReplacementControls({
  replacement,
  compatibleResourceOptions,
  usesResourceReplacement,
  eligibleCount,
  disabled,
  isApplying,
  canReplaceActive,
  canReplaceAll,
  onReplacementChange,
  onReplaceActive,
  onReplaceAll,
}: ReplacementControlsProps) {
  return (
    <div className='space-y-2'>
      {usesResourceReplacement ? (
        <ChipCombobox
          options={compatibleResourceOptions.map((option) => ({
            label: option.label,
            value: option.value,
          }))}
          value={replacement}
          onChange={onReplacementChange}
          placeholder='Choose replacement...'
          searchable
          searchPlaceholder='Search resources...'
          emptyMessage='No valid replacements available'
          disabled={disabled || compatibleResourceOptions.length === 0}
        />
      ) : (
        <ChipInput
          value={replacement}
          placeholder='Replace'
          disabled={disabled}
          onChange={(event) => onReplacementChange(event.target.value)}
        />
      )}

      <div className='flex items-center justify-between gap-2'>
        <span className='text-[var(--text-muted)] text-xs'>
          {eligibleCount} replaceable match{eligibleCount === 1 ? '' : 'es'}
        </span>
        <div className='flex gap-1.5'>
          <Chip
            type='button'
            variant='outline'
            disabled={disabled || isApplying || !canReplaceActive}
            onClick={onReplaceActive}
          >
            Replace
          </Chip>
          <Chip
            type='button'
            active
            disabled={disabled || isApplying || !canReplaceAll}
            onClick={onReplaceAll}
          >
            {isApplying ? 'Replacing...' : 'Replace All'}
          </Chip>
        </div>
      </div>
    </div>
  )
}
