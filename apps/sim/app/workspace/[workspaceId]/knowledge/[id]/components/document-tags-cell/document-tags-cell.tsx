'use client'

import { useMemo } from 'react'
import { format } from 'date-fns'
import { Badge, Popover, PopoverAnchor, PopoverContent, Tooltip } from '@/components/emcn'
import type { TagDefinition } from '@/hooks/use-knowledge-base-tag-definitions'
import type { DocumentData } from '@/stores/knowledge/store'

/** All tag slot keys that can hold values */
const TAG_SLOTS = [
  'tag1',
  'tag2',
  'tag3',
  'tag4',
  'tag5',
  'tag6',
  'tag7',
  'number1',
  'number2',
  'number3',
  'number4',
  'number5',
  'date1',
  'date2',
  'boolean1',
  'boolean2',
  'boolean3',
] as const

type TagSlot = (typeof TAG_SLOTS)[number]

interface TagValue {
  slot: TagSlot
  displayName: string
  value: string
  fieldType: string
}

interface DocumentTagsCellProps {
  document: DocumentData
  tagDefinitions: TagDefinition[]
}

/**
 * Formats a tag value based on its field type
 */
function formatTagValue(value: unknown, fieldType: string): string {
  if (value === null || value === undefined) return ''

  switch (fieldType) {
    case 'date':
      try {
        return format(new Date(value as string), 'MMM d, yyyy')
      } catch {
        return String(value)
      }
    case 'boolean':
      return value ? 'Yes' : 'No'
    case 'number':
      return typeof value === 'number' ? value.toLocaleString() : String(value)
    default:
      return String(value)
  }
}

/**
 * Gets the field type for a tag slot
 */
function getFieldType(slot: TagSlot): string {
  if (slot.startsWith('tag')) return 'text'
  if (slot.startsWith('number')) return 'number'
  if (slot.startsWith('date')) return 'date'
  if (slot.startsWith('boolean')) return 'boolean'
  return 'text'
}

/**
 * Cell component that displays document tags as compact badges with overflow popover
 */
export function DocumentTagsCell({ document, tagDefinitions }: DocumentTagsCellProps) {
  const tags = useMemo(() => {
    const result: TagValue[] = []

    for (const slot of TAG_SLOTS) {
      const value = document[slot]
      if (value === null || value === undefined) continue

      const definition = tagDefinitions.find((def) => def.tagSlot === slot)
      const fieldType = definition?.fieldType || getFieldType(slot)
      const formattedValue = formatTagValue(value, fieldType)

      if (!formattedValue) continue

      result.push({
        slot,
        displayName: definition?.displayName || slot,
        value: formattedValue,
        fieldType,
      })
    }

    return result
  }, [document, tagDefinitions])

  if (tags.length === 0) {
    return <span className='text-[11px] text-[var(--text-muted)]'>—</span>
  }

  const visibleTags = tags.slice(0, 2)
  const overflowTags = tags.slice(2)
  const hasOverflow = overflowTags.length > 0

  return (
    <div className='flex items-center gap-[4px]' onClick={(e) => e.stopPropagation()}>
      {visibleTags.map((tag) => (
        <Tooltip.Root key={tag.slot}>
          <Tooltip.Trigger asChild>
            <Badge className='max-w-[80px] truncate px-[6px] py-[1px] text-[10px]'>
              {tag.value}
            </Badge>
          </Tooltip.Trigger>
          <Tooltip.Content side='top'>
            {tag.displayName}: {tag.value}
          </Tooltip.Content>
        </Tooltip.Root>
      ))}
      {hasOverflow && (
        <Popover>
          <Tooltip.Root>
            <Tooltip.Trigger asChild>
              <PopoverAnchor asChild>
                <Badge
                  variant='outline'
                  className='cursor-pointer px-[6px] py-[1px] text-[10px] hover:bg-[var(--surface-6)]'
                >
                  +{overflowTags.length}
                </Badge>
              </PopoverAnchor>
            </Tooltip.Trigger>
            <Tooltip.Content side='top'>
              {overflowTags.map((tag) => tag.displayName).join(', ')}
            </Tooltip.Content>
          </Tooltip.Root>
          <PopoverContent side='bottom' align='start' maxWidth={220} minWidth={160}>
            <div className='flex flex-col gap-[2px]'>
              {tags.map((tag) => (
                <div
                  key={tag.slot}
                  className='flex items-center justify-between gap-[8px] rounded-[4px] px-[6px] py-[4px] text-[11px]'
                >
                  <span className='text-[var(--text-muted)]'>{tag.displayName}</span>
                  <span className='max-w-[100px] truncate text-[var(--text-primary)]'>
                    {tag.value}
                  </span>
                </div>
              ))}
            </div>
          </PopoverContent>
        </Popover>
      )}
    </div>
  )
}
