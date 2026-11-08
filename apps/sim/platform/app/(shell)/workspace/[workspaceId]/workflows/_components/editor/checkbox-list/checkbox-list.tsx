'use client'

import { useCallback } from 'react'
import { Checkbox } from '@sim/emcn/checkbox'
import styles from '@/platform/app/(shell)/workspace/[workspaceId]/workflows/_components/editor/checkbox-list/checkbox-list.module.css'
import type { SubBlockValues } from '@/platform/app/(shell)/workspace/[workspaceId]/workflows/_components/editor/sub-block/sub-block'
import { useSubBlockStore, useSubBlockValue } from '@/platform/lib/data/workflow-editor'

interface CheckboxListOption {
  label: string
  id: string
  defaultChecked?: boolean
  description?: string
}

interface CheckboxListProps {
  blockId: string
  subBlockId: string
  options: CheckboxListOption[]
  isPreview?: boolean
  subBlockValues?: SubBlockValues
  disabled?: boolean
}

function readSelections(value: unknown): Record<string, boolean> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  return value as Record<string, boolean>
}

/**
 * Independent booleans stored together as `{ [optionId]: boolean }`. An option the viewer never
 * toggled follows its declared default; an explicit `false` always wins.
 */
export function CheckboxList({
  blockId,
  subBlockId,
  options,
  isPreview = false,
  subBlockValues,
  disabled = false,
}: CheckboxListProps) {
  const [storeValue, setStoreValue] = useSubBlockValue<Record<string, boolean>>(blockId, subBlockId)
  const selections = readSelections(isPreview ? subBlockValues?.[subBlockId]?.value : storeValue)

  const handleChange = useCallback(
    (optionId: string, checked: boolean) => {
      if (isPreview || disabled) return
      // Two toggles before a rerender would both merge onto the render-time record; the store is current.
      const current = useSubBlockStore.getState().getValue(blockId, subBlockId)
      setStoreValue({ ...readSelections(current), [optionId]: checked })
    },
    [blockId, subBlockId, setStoreValue, isPreview, disabled]
  )

  return (
    <div className={styles.list}>
      {options.map((option) => (
        <Checkbox
          key={option.id}
          label={option.label}
          description={option.description}
          checked={Boolean(selections[option.id] ?? option.defaultChecked ?? false)}
          onCheckedChange={(next) => handleChange(option.id, next)}
          disabled={isPreview || disabled}
        />
      ))}
    </div>
  )
}
