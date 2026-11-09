'use client'

import { useRef, useState } from 'react'
import { Button, IconButton } from '@sim/emcn/button'
import { Input } from '@sim/emcn/field/inputs'
import { AnchoredPopover } from '@sim/emcn/menu/anchored-popover'
import { DatePicker } from '@sim/emcn/picker/date-picker'
import { Select } from '@sim/emcn/picker/select'
import { useScrollEdges } from '@sim/emcn/scroll-area/use-scroll-edges'
import { generateId } from '@sim/utils/id'
import styles from '@/app/(product)/_components/workspace/knowledge/tag-filter/tag-filter.module.css'
import {
  type DocumentTagFilter,
  type FilterFieldType,
  getOperatorsForFieldType,
  type TagDefinitionData,
} from '@/platform/lib/data/knowledge'

/** One rule: a tag, how its value compares, and the value (a range's upper bound in `valueTo`). */
export interface TagFilterEntry {
  id: string
  tagSlot: string
  tagName: string
  fieldType: FilterFieldType
  operator: string
  value: string
  valueTo: string
}

const FIELD_TYPES: readonly FilterFieldType[] = ['text', 'number', 'date', 'boolean']

function fieldTypeOf(definition: TagDefinitionData | undefined): FilterFieldType {
  return FIELD_TYPES.find((type) => type === definition?.fieldType) ?? 'text'
}

function emptyEntry(): TagFilterEntry {
  return {
    id: generateId(),
    tagSlot: '',
    tagName: '',
    fieldType: 'text',
    operator: 'contains',
    value: '',
    valueTo: '',
  }
}

/** Text matches part of a value by default; other types start at their equality operator. */
function defaultOperator(fieldType: FilterFieldType) {
  if (fieldType === 'text') return 'contains'
  return getOperatorsForFieldType(fieldType)[0]?.value ?? 'eq'
}

/**
 * The rules ready to send. A rule applies once it names a tag and a value; a range waits for both
 * bounds, since the API rejects a half-entered one and the whole list would fail while typing.
 */
export function activeTagFilters(entries: readonly TagFilterEntry[]): DocumentTagFilter[] {
  return entries.flatMap((entry) => {
    if (!entry.tagSlot || !entry.value.trim()) return []
    if (entry.operator === 'between' && !entry.valueTo.trim()) return []
    return [
      {
        tagSlot: entry.tagSlot,
        fieldType: entry.fieldType,
        operator: entry.operator,
        value: entry.value,
        ...(entry.operator === 'between' ? { valueTo: entry.valueTo } : {}),
      },
    ]
  })
}

interface ValueControlProps {
  entry: TagFilterEntry
  onChange: (patch: Partial<TagFilterEntry>) => void
}

function ValueControl({ entry, onChange }: ValueControlProps) {
  const range = entry.operator === 'between'
  if (entry.fieldType === 'date') {
    return range ? (
      <div className={styles.range}>
        <DatePicker
          label={`${entry.tagName} from`}
          labelHidden
          placeholder='From'
          value={entry.value || null}
          onValueChange={(value) => onChange({ value: value ?? '' })}
        />
        <span className={styles.to} data-type='T060'>
          to
        </span>
        <DatePicker
          label={`${entry.tagName} to`}
          labelHidden
          placeholder='To'
          value={entry.valueTo || null}
          onValueChange={(value) => onChange({ valueTo: value ?? '' })}
        />
      </div>
    ) : (
      <DatePicker
        label={`${entry.tagName} date`}
        labelHidden
        value={entry.value || null}
        onValueChange={(value) => onChange({ value: value ?? '' })}
      />
    )
  }
  if (entry.fieldType === 'boolean') {
    return (
      <Select
        label={`${entry.tagName} value`}
        value={entry.value || undefined}
        onValueChange={(value) => onChange({ value })}
        options={[
          { value: 'true', label: 'True' },
          { value: 'false', label: 'False' },
        ]}
      />
    )
  }
  const numeric = entry.fieldType === 'number'
  return range ? (
    <div className={styles.range}>
      <Input
        label={`${entry.tagName} from`}
        placeholder='From'
        inputMode={numeric ? 'decimal' : undefined}
        value={entry.value}
        onChange={(value) => onChange({ value })}
      />
      <span className={styles.to} data-type='T060'>
        to
      </span>
      <Input
        label={`${entry.tagName} to`}
        placeholder='To'
        inputMode={numeric ? 'decimal' : undefined}
        value={entry.valueTo}
        onChange={(valueTo) => onChange({ valueTo })}
      />
    </div>
  ) : (
    <Input
      label={`${entry.tagName} value`}
      placeholder={numeric ? 'Enter number' : 'Enter value'}
      inputMode={numeric ? 'decimal' : undefined}
      value={entry.value}
      onChange={(value) => onChange({ value })}
    />
  )
}

interface TagFilterProps {
  definitions: readonly TagDefinitionData[]
  entries: readonly TagFilterEntry[]
  onChange: (entries: TagFilterEntry[]) => void
}

/**
 * Filters a base's documents by tag values: each rule names a tag, an operator for its type (text,
 * number, date or yes/no) and a value or range, and every rule must hold.
 */
export function TagFilter({ definitions, entries, onChange }: TagFilterProps) {
  const anchor = useRef<HTMLSpanElement>(null)
  const rulesEdges = useScrollEdges<HTMLOListElement>()
  const [open, setOpen] = useState(false)
  const active = activeTagFilters(entries).length
  const shown = entries.length > 0 ? entries : [emptyEntry()]

  function update(id: string, patch: Partial<TagFilterEntry>) {
    onChange(shown.map((entry) => (entry.id === id ? { ...entry, ...patch } : entry)))
  }

  function chooseTag(id: string, tagName: string) {
    const definition = definitions.find((item) => item.displayName === tagName)
    const fieldType = fieldTypeOf(definition)
    update(id, {
      tagName,
      tagSlot: definition?.tagSlot ?? '',
      fieldType,
      operator: defaultOperator(fieldType),
      value: '',
      valueTo: '',
    })
  }

  return (
    <span ref={anchor} className={styles.anchor}>
      <AnchoredPopover
        label='Filter by tags'
        presentation='panel'
        anchor={anchor}
        open={open}
        onOpenChange={setOpen}
        trigger={(button) => (
          <Button
            render={button}
            variant='quiet'
            size='compact'
            count={active > 0 ? active : undefined}
          >
            Tags
          </Button>
        )}
      >
        <div className={styles.panel}>
          <div className={styles.heading}>
            <h2 data-type='T059'>Filter by tags</h2>
            {active > 0 && (
              <Button variant='quiet' size='compact' onClick={() => onChange([])}>
                Clear all
              </Button>
            )}
          </div>
          <ol ref={rulesEdges} className={styles.rules}>
            {shown.map((entry, index) => (
              <li key={entry.id} className={styles.rule}>
                {index > 0 && (
                  <span className={styles.joiner} data-type='T052'>
                    and
                  </span>
                )}
                <div className={styles.choices}>
                  <Select
                    label='Tag'
                    value={entry.tagName || undefined}
                    onValueChange={(value) => chooseTag(entry.id, value)}
                    options={definitions.map((definition) => ({
                      value: definition.displayName,
                      label: definition.displayName,
                    }))}
                  />
                  {entry.tagSlot && (
                    <Select
                      label='Operator'
                      value={entry.operator}
                      onValueChange={(operator) => update(entry.id, { operator, valueTo: '' })}
                      options={getOperatorsForFieldType(entry.fieldType).map((operator) => ({
                        value: operator.value,
                        label: operator.label,
                      }))}
                    />
                  )}
                  <IconButton
                    label='Remove tag filter'
                    icon='I105'
                    onClick={() => onChange(shown.filter((item) => item.id !== entry.id))}
                  />
                </div>
                {entry.tagSlot && (
                  <ValueControl entry={entry} onChange={(patch) => update(entry.id, patch)} />
                )}
              </li>
            ))}
          </ol>
          <Button
            variant='secondary'
            size='compact'
            icon='I074'
            onClick={() => onChange([...shown, emptyEntry()])}
          >
            Add filter
          </Button>
        </div>
      </AnchoredPopover>
    </span>
  )
}
