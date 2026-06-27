'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { Settings2 } from 'lucide-react'
import { useTranslations } from 'next-intl'
import {
  Button,
  Checkbox,
  ChipModal,
  ChipModalBody,
  ChipModalField,
  ChipModalHeader,
} from '@/components/emcn'
import { cn } from '@/lib/core/utils/cn'
import { formatDisplayText } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/editor/components/sub-block/components/formatted-text'
import { getWorkflowSearchLabelHighlight } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/editor/components/sub-block/components/workflow-search-highlight'
import { useSubBlockValue } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/editor/components/sub-block/hooks/use-sub-block-value'
import { useActiveSearchTarget } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/editor/providers/active-search-target-provider'

interface SelectedCountDisplayProps {
  noneSelected: boolean
  allSelected: boolean
  count: number
}

function SelectedCountDisplay({ noneSelected, allSelected, count }: SelectedCountDisplayProps) {
  const t = useTranslations('auto')
  if (noneSelected) {
    return (
      <span className='truncate font-medium text-[var(--text-muted)] text-sm'>
        {t('none_selected')}
      </span>
    )
  }
  if (allSelected) {
    return (
      <span className='truncate font-medium text-[var(--text-primary)] text-sm'>
        {t('all_selected')}
      </span>
    )
  }
  return (
    <span className='truncate font-medium text-[var(--text-primary)] text-sm'>
      {count} {t('selected')}
    </span>
  )
}

interface GroupedCheckboxListProps {
  blockId: string
  subBlockId: string
  title: string
  options: { label: string; id: string; group?: string }[]
  isPreview?: boolean
  subBlockValues: Record<string, any>
  disabled?: boolean
  maxHeight?: number
}

export function GroupedCheckboxList({
  blockId,
  subBlockId,
  title,
  options,
  isPreview = false,
  subBlockValues,
  disabled = false,
  maxHeight = 400,
}: GroupedCheckboxListProps) {
  const t = useTranslations('auto')
  const activeSearchTarget = useActiveSearchTarget()
  const [open, setOpen] = useState(false)
  const [storeValue, setStoreValue] = useSubBlockValue(blockId, subBlockId)
  const optionRefs = useRef<Record<number, HTMLDivElement | null>>({})

  const previewValue = isPreview && subBlockValues ? subBlockValues[subBlockId]?.value : undefined
  const selectedValues = ((isPreview ? previewValue : storeValue) as string[]) || []

  const groupedOptions = useMemo(() => {
    const groups: Record<string, { label: string; id: string }[]> = {}

    options.forEach((option) => {
      const groupName = option.group || 'Other'
      if (!groups[groupName]) {
        groups[groupName] = []
      }
      groups[groupName].push({ label: option.label, id: option.id })
    })

    return groups
  }, [options])

  const handleToggle = (optionId: string) => {
    if (isPreview || disabled) return

    const currentValues = (selectedValues || []) as string[]
    const newValues = currentValues.includes(optionId)
      ? currentValues.filter((id) => id !== optionId)
      : [...currentValues, optionId]

    setStoreValue(newValues)
  }

  const handleSelectAll = () => {
    if (isPreview || disabled) return
    const allIds = options.map((opt) => opt.id)
    setStoreValue(allIds)
  }

  const handleClear = () => {
    if (isPreview || disabled) return
    setStoreValue([])
  }

  const allSelected = selectedValues.length === options.length
  const noneSelected = selectedValues.length === 0

  useEffect(() => {
    if (activeSearchTarget?.subBlockId === subBlockId) {
      setOpen(true)
    }
  }, [activeSearchTarget, subBlockId])

  useEffect(() => {
    if (!open || activeSearchTarget?.subBlockId !== subBlockId) return
    const [, optionIndex] = activeSearchTarget.valuePath
    if (typeof optionIndex !== 'number') return
    requestAnimationFrame(() => {
      optionRefs.current[optionIndex]?.scrollIntoView({ block: 'center' })
    })
  }, [activeSearchTarget, open, subBlockId])

  return (
    <>
      <Button
        variant='ghost'
        disabled={disabled}
        onClick={() => setOpen(true)}
        className={cn(
          'flex w-full cursor-pointer items-center justify-between rounded-sm border border-[var(--border-1)] bg-[var(--surface-5)] px-2 py-1.5 font-medium font-sans text-[var(--text-primary)] text-sm outline-none focus:outline-none focus-visible:outline-none focus-visible:ring-0 focus-visible:ring-offset-0 dark:bg-[var(--surface-5)]',
          'hover-hover:bg-[var(--surface-active)]'
        )}
      >
        <span className='flex flex-1 items-center gap-2 truncate text-[var(--text-muted)]'>
          <Settings2 className='size-4 flex-shrink-0 opacity-50' />
          <span className='truncate'>{t('configure_pii_types')}</span>
        </span>
        <SelectedCountDisplay
          noneSelected={noneSelected}
          allSelected={allSelected}
          count={selectedValues.length}
        />
      </Button>
      <ChipModal open={open} onOpenChange={setOpen} srTitle='Select PII Types to Detect' size='lg'>
        <ChipModalHeader onClose={() => setOpen(false)}>
          {t('select_pii_types_to_detect')}
        </ChipModalHeader>
        <ChipModalBody onWheel={(e) => e.stopPropagation()}>
          <ChipModalField
            type='custom'
            title={t('pii_types')}
            hint={t('choose_which_types_of_personally_identifiable')}
          >
            <div className='flex items-center justify-between border-[var(--border)] border-b pb-3'>
              <div className='flex items-center gap-2'>
                <Checkbox
                  id='select-all'
                  checked={allSelected}
                  onCheckedChange={(checked) => {
                    if (checked) {
                      handleSelectAll()
                    } else {
                      handleClear()
                    }
                  }}
                  disabled={disabled}
                />
                <label
                  htmlFor='select-all'
                  className='cursor-pointer font-medium text-sm leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70'
                >
                  {t('select_all_entities')}
                </label>
              </div>
              <Button variant='ghost' onClick={handleClear} disabled={disabled || noneSelected}>
                <span className='flex items-center gap-1'>
                  {t('clear')}
                  {!noneSelected && <span>({selectedValues.length})</span>}
                </span>
              </Button>
            </div>

            <div className='flex flex-col gap-6'>
              {Object.entries(groupedOptions).map(([groupName, groupOptions]) => (
                <div key={groupName}>
                  <h3 className='mb-3 font-semibold text-muted-foreground text-xs uppercase tracking-wider'>
                    {groupName}
                  </h3>
                  <div className='flex flex-col gap-3'>
                    {groupOptions.map((option) => {
                      const optionIndex = options.findIndex(
                        (candidate) => candidate.id === option.id
                      )
                      const workflowSearchHighlight = getWorkflowSearchLabelHighlight({
                        activeSearchTarget,
                        blockId,
                        subBlockId,
                        valuePath: ['options', optionIndex],
                        label: option.label,
                      })
                      return (
                        <div
                          key={option.id}
                          ref={(element) => {
                            optionRefs.current[optionIndex] = element
                          }}
                          className='flex items-center gap-2'
                        >
                          <Checkbox
                            id={`${subBlockId}-${option.id}`}
                            checked={selectedValues.includes(option.id)}
                            onCheckedChange={() => handleToggle(option.id)}
                            disabled={disabled}
                          />
                          <label
                            htmlFor={`${subBlockId}-${option.id}`}
                            className='cursor-pointer text-sm leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70'
                          >
                            {formatDisplayText(option.label, { workflowSearchHighlight })}
                          </label>
                        </div>
                      )
                    })}
                  </div>
                </div>
              ))}
            </div>
          </ChipModalField>
        </ChipModalBody>
      </ChipModal>
    </>
  )
}
