'use client'

import { type ReactNode, useEffect, useMemo, useRef } from 'react'
import { Button, ChipDatePicker, ChipDropdown, type ChipDropdownOption, ChipInput } from '@sim/emcn'
import { Plus, X } from '@sim/emcn/icons'
import { generateId } from '@sim/utils/id'
import { type FilterFieldType, getOperatorsForFieldType } from '@/lib/knowledge/filters/types'
import type { TagDefinition } from '@/hooks/kb/use-knowledge-base-tag-definitions'

/** Shared label styling for every section heading inside the filter popover. */
export const FILTER_SECTION_LABEL_CLASS = 'text-[var(--text-muted)] text-small'

/**
 * One tag-filter rule in the popover. Kept out of the URL deliberately: it is a
 * rich rule object (slot, field type, operator, value, upper bound), too large
 * and too structured for a query param.
 */
export interface TagFilterEntry {
  id: string
  tagName: string
  tagSlot: string
  fieldType: FilterFieldType
  operator: string
  value: string
  valueTo: string
}

export const createEmptyEntry = (): TagFilterEntry => ({
  id: generateId(),
  tagName: '',
  tagSlot: '',
  fieldType: 'text',
  operator: 'contains',
  value: '',
  valueTo: '',
})

/**
 * Sizes the filter popover to its content with pure CSS `max-content` (clamped to
 * `[280, 420]`). Because the padding box is part of `max-content`, the `p-3`
 * inset is preserved on every edge — there is no separate measured/animated outer
 * layer that can disagree by a few pixels and clip the right padding. The width
 * still adapts to the active filters; it just resizes instantly rather than
 * animating.
 */
export function AutoWidthPanel({ children }: { children: ReactNode }) {
  return <div className='flex w-max min-w-[280px] max-w-[420px] flex-col p-3'>{children}</div>
}

/**
 * Default operator when a tag is selected. Text filters default to `contains`
 * so typing part of a value finds matches (exact `equals` stays one click away
 * in the operator dropdown); other field types keep their first, equality
 * operator.
 */
function getDefaultOperatorForFieldType(
  fieldType: FilterFieldType,
  operators: ReturnType<typeof getOperatorsForFieldType>
): string {
  if (fieldType === 'text') return 'contains'
  return operators[0]?.value ?? 'eq'
}

interface TagFilterValueControlProps {
  entry: TagFilterEntry
  onChange: (patch: Partial<TagFilterEntry>) => void
}

/**
 * Renders the value input for a knowledge base tag filter row.
 */
function TagFilterValueControl({ entry, onChange }: TagFilterValueControlProps) {
  const isBetween = entry.operator === 'between'

  if (entry.fieldType === 'date') {
    if (isBetween) {
      return (
        <div className='grid grid-cols-[1fr_auto_1fr] items-center gap-2'>
          <ChipDatePicker
            value={entry.value || undefined}
            onChange={(value) => onChange({ value })}
            placeholder='From'
            fullWidth
          />
          <span className='flex-shrink-0 text-[var(--text-muted)] text-caption'>to</span>
          <ChipDatePicker
            value={entry.valueTo || undefined}
            onChange={(value) => onChange({ valueTo: value })}
            placeholder='To'
            fullWidth
          />
        </div>
      )
    }

    return (
      <ChipDatePicker
        value={entry.value || undefined}
        onChange={(value) => onChange({ value })}
        placeholder='Select date'
        fullWidth
      />
    )
  }

  if (isBetween) {
    return (
      <div className='grid grid-cols-[1fr_auto_1fr] items-center gap-2'>
        <ChipInput
          value={entry.value}
          onChange={(event) => onChange({ value: event.target.value })}
          placeholder='From'
        />
        <span className='flex-shrink-0 text-[var(--text-muted)] text-caption'>to</span>
        <ChipInput
          value={entry.valueTo}
          onChange={(event) => onChange({ valueTo: event.target.value })}
          placeholder='To'
        />
      </div>
    )
  }

  return (
    <ChipInput
      value={entry.value}
      onChange={(event) => onChange({ value: event.target.value })}
      placeholder={
        entry.fieldType === 'boolean'
          ? 'true or false'
          : entry.fieldType === 'number'
            ? 'Enter number'
            : 'Enter value'
      }
    />
  )
}

interface TagFilterSectionProps {
  tagDefinitions: TagDefinition[]
  entries: TagFilterEntry[]
  onChange: (entries: TagFilterEntry[]) => void
}

/**
 * Tag filter section rendered inside the combined filter popover.
 */
export function TagFilterSection({ tagDefinitions, entries, onChange }: TagFilterSectionProps) {
  const activeCount = entries.filter((f) => f.tagSlot && f.value.trim()).length

  const tagOptions: ChipDropdownOption[] = tagDefinitions.map((t) => ({
    value: t.displayName,
    label: t.displayName,
  }))

  const filtersToShow = useMemo(
    () => (entries.length > 0 ? entries : [createEmptyEntry()]),
    [entries]
  )

  const scrollRef = useRef<HTMLDivElement>(null)
  const prevCountRef = useRef(filtersToShow.length)

  useEffect(() => {
    if (filtersToShow.length > prevCountRef.current) {
      const el = scrollRef.current
      if (el) {
        requestAnimationFrame(() => {
          el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' })
        })
      }
    }
    prevCountRef.current = filtersToShow.length
  }, [filtersToShow.length])

  const updateEntry = (id: string, patch: Partial<TagFilterEntry>) => {
    const existing = filtersToShow.find((e) => e.id === id)
    if (!existing) return
    const updated = filtersToShow.map((e) => (e.id === id ? { ...e, ...patch } : e))
    onChange(updated)
  }

  const handleTagChange = (id: string, tagName: string) => {
    const def = tagDefinitions.find((t) => t.displayName === tagName)
    const fieldType = (def?.fieldType || 'text') as FilterFieldType
    const operators = getOperatorsForFieldType(fieldType)
    updateEntry(id, {
      tagName,
      tagSlot: def?.tagSlot || '',
      fieldType,
      operator: getDefaultOperatorForFieldType(fieldType, operators),
      value: '',
      valueTo: '',
    })
  }

  const addFilter = () => {
    onChange([...filtersToShow, createEmptyEntry()])
  }

  const removeFilter = (id: string) => {
    const remaining = filtersToShow.filter((e) => e.id !== id)
    onChange(remaining.length > 0 ? remaining : [])
  }

  if (tagDefinitions.length === 0) return null

  return (
    <div className='mt-3 border-[var(--border-1)] border-t pt-3'>
      <div className='flex h-5 items-center justify-between'>
        <span className={FILTER_SECTION_LABEL_CLASS}>Filter by tags</span>
        {activeCount > 0 && (
          <Button
            variant='ghost'
            className='-mr-1 h-auto px-1 py-0.5 text-[var(--text-muted)] text-caption hover-hover:text-[var(--text-secondary)]'
            onClick={() => onChange([])}
          >
            Clear all
          </Button>
        )}
      </div>

      <div
        ref={scrollRef}
        className='mt-2 flex max-h-[300px] flex-col gap-2 overflow-y-auto overflow-x-hidden'
      >
        {filtersToShow.map((entry, index) => {
          const operators = getOperatorsForFieldType(entry.fieldType)
          const operatorOptions: ChipDropdownOption[] = operators.map((op) => ({
            value: op.value,
            label: op.label,
          }))

          return (
            <div key={entry.id} className='flex flex-col gap-2'>
              {index > 0 && (
                <div className='flex items-center gap-2'>
                  <span className='shrink-0 text-[var(--text-muted)] text-caption leading-none'>
                    and
                  </span>
                  <div className='h-px flex-1 bg-[var(--border-1)]' />
                </div>
              )}
              <div className='flex items-start gap-2'>
                <div className='flex min-w-0 flex-1 flex-wrap items-center gap-2'>
                  <ChipDropdown
                    options={tagOptions}
                    value={entry.tagName}
                    onChange={(value) => handleTagChange(entry.id, value)}
                    placeholder='Select tag'
                    align='start'
                    matchTriggerWidth={false}
                    contentClassName='max-h-[240px] overflow-y-auto'
                    className='max-w-[150px]'
                  />
                  {entry.tagSlot && (
                    <ChipDropdown
                      options={operatorOptions}
                      value={entry.operator}
                      onChange={(value) => updateEntry(entry.id, { operator: value, valueTo: '' })}
                      placeholder='Operator'
                      align='start'
                      matchTriggerWidth={false}
                    />
                  )}
                </div>
                <Button
                  variant='ghost'
                  className='relative size-[30px] shrink-0 p-0 text-[var(--text-muted)] before:absolute before:inset-[-5px] before:content-[""] hover-hover:bg-[var(--surface-active)] hover-hover:text-[var(--text-error)]'
                  onClick={() => removeFilter(entry.id)}
                  aria-label='Remove tag filter'
                >
                  <X className='size-[14px]' />
                </Button>
              </div>
              {entry.tagSlot && (
                <TagFilterValueControl
                  entry={entry}
                  onChange={(patch) => updateEntry(entry.id, patch)}
                />
              )}
            </div>
          )
        })}
      </div>

      <Button
        variant='ghost'
        onClick={addFilter}
        className='mt-2 h-[30px] w-full justify-start gap-2 px-2 text-[var(--text-secondary)] text-caption hover-hover:text-[var(--text-primary)]'
      >
        <Plus className='size-[14px]' />
        Add filter
      </Button>
    </div>
  )
}
