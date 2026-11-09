'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { Button } from '@sim/emcn/button'
import { Checkbox } from '@sim/emcn/checkbox'
import { Modal } from '@sim/emcn/modal'
import { useActiveSearchTarget } from '@/platform/app/(shell)/workspace/[workspaceId]/workflows/_components/editor/active-search-target/active-search-target'
import styles from '@/platform/app/(shell)/workspace/[workspaceId]/workflows/_components/editor/grouped-checkbox-list/grouped-checkbox-list.module.css'
import type { SubBlockValues } from '@/platform/app/(shell)/workspace/[workspaceId]/workflows/_components/editor/sub-block/sub-block'
import { useSubBlockValue } from '@/platform/lib/data/workflow-editor'

interface GroupedCheckboxListProps {
  blockId: string
  subBlockId: string
  options: { label: string; id: string; group?: string }[]
  isPreview?: boolean
  subBlockValues: SubBlockValues
  disabled?: boolean
}

/**
 * A large set of grouped choices (the guardrails PII types) stored as an array of ids: the field
 * summarizes the selection and opens a dialog with select-all, clear and one checkbox per option.
 */
export function GroupedCheckboxList({
  blockId,
  subBlockId,
  options,
  isPreview = false,
  subBlockValues,
  disabled = false,
}: GroupedCheckboxListProps) {
  const activeSearchTarget = useActiveSearchTarget()
  const [open, setOpen] = useState(false)
  const [storeValue, setStoreValue] = useSubBlockValue<string[]>(blockId, subBlockId)
  const optionRefs = useRef<Record<number, HTMLDivElement | null>>({})

  const raw = isPreview ? subBlockValues?.[subBlockId]?.value : storeValue
  const selectedValues = Array.isArray(raw) ? (raw as string[]) : []

  const groupedOptions = useMemo(() => {
    const groups = new Map<string, Array<{ label: string; id: string; index: number }>>()
    options.forEach((option, index) => {
      const groupName = option.group || 'Other'
      const group = groups.get(groupName) ?? []
      group.push({ label: option.label, id: option.id, index })
      groups.set(groupName, group)
    })
    return [...groups.entries()]
  }, [options])

  const editable = !isPreview && !disabled
  const toggle = (optionId: string) => {
    if (!editable) return
    setStoreValue(
      selectedValues.includes(optionId)
        ? selectedValues.filter((id) => id !== optionId)
        : [...selectedValues, optionId]
    )
  }

  const allSelected = options.length > 0 && selectedValues.length === options.length
  const noneSelected = selectedValues.length === 0
  const summary = noneSelected
    ? 'None selected'
    : allSelected
      ? 'All selected'
      : `${selectedValues.length} selected`

  const searchTargetsField = activeSearchTarget?.subBlockId === subBlockId
  const [openedForSearch, setOpenedForSearch] = useState<unknown>(null)
  if (searchTargetsField && openedForSearch !== activeSearchTarget) {
    setOpenedForSearch(activeSearchTarget)
    setOpen(true)
  }

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
        variant='secondary'
        size='compact'
        icon='I050'
        count={noneSelected ? undefined : selectedValues.length}
        aria-label={`Configure PII types, ${summary.toLowerCase()}`}
        disabled={disabled}
        onClick={() => setOpen(true)}
      >
        Configure PII types
      </Button>
      <Modal open={open} onOpenChange={setOpen} title='Select PII Types to Detect'>
        <div className={styles.body}>
          <div className={styles.bulk}>
            <Checkbox
              label='Select all entities'
              checked={allSelected}
              indeterminate={!allSelected && !noneSelected}
              disabled={!editable}
              onCheckedChange={(checked) => {
                if (editable) setStoreValue(checked ? options.map((option) => option.id) : [])
              }}
            />
            <Button
              variant='quiet'
              size='compact'
              count={noneSelected ? undefined : selectedValues.length}
              disabled={!editable || noneSelected}
              onClick={() => setStoreValue([])}
            >
              Clear
            </Button>
          </div>
          {groupedOptions.map(([groupName, groupOptions]) => (
            <section key={groupName} className={styles.group} aria-label={groupName}>
              <h3 className={styles.groupTitle} data-type='T052'>
                {groupName}
              </h3>
              {groupOptions.map((option) => (
                <div
                  key={option.id}
                  ref={(element) => {
                    optionRefs.current[option.index] = element
                  }}
                >
                  <Checkbox
                    label={option.label}
                    checked={selectedValues.includes(option.id)}
                    disabled={!editable}
                    onCheckedChange={() => toggle(option.id)}
                  />
                </div>
              ))}
            </section>
          ))}
        </div>
      </Modal>
    </>
  )
}
