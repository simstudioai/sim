'use client'

import { useTranslations } from 'next-intl'
import { Button, Combobox, Input } from '@/components/emcn'
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
  const t = useTranslations('auto')
  return (
    <div className='space-y-2'>
      {usesResourceReplacement ? (
        <Combobox
          options={compatibleResourceOptions.map((option) => ({
            label: option.label,
            value: option.value,
          }))}
          value={replacement}
          onChange={onReplacementChange}
          placeholder={t('choose_replacement')}
          searchable
          searchPlaceholder='Search resources...'
          emptyMessage={t('no_valid_replacements_available')}
          disabled={disabled || compatibleResourceOptions.length === 0}
        />
      ) : (
        <Input
          value={replacement}
          placeholder={t('replace')}
          disabled={disabled}
          onChange={(event) => onReplacementChange(event.target.value)}
        />
      )}

      <div className='flex items-center justify-between gap-2'>
        <span className='text-[var(--text-muted)] text-xs'>
          {eligibleCount} {t('replaceable_match')}
          {eligibleCount === 1 ? '' : 'es'}
        </span>
        <div className='flex gap-1.5'>
          <Button
            className='h-8 px-2 text-xs'
            variant='default'
            disabled={disabled || isApplying || !canReplaceActive}
            onClick={onReplaceActive}
          >
            {t('replace')}
          </Button>
          <Button
            className='h-8 px-2 text-xs'
            variant='active'
            disabled={disabled || isApplying || !canReplaceAll}
            onClick={onReplaceAll}
          >
            {isApplying ? 'Replacing...' : 'Replace All'}
          </Button>
        </div>
      </div>
    </div>
  )
}
