'use client'

import { useId } from 'react'
import { IconButton } from '@sim/emcn/button'
import { SearchableSelect } from '@sim/emcn/picker/searchable-select'
import { Select } from '@sim/emcn/picker/select'
import {
  RuleCard,
  RuleField,
} from '@/platform/app/(shell)/workspace/[workspaceId]/workflows/_components/editor/filter-builder/rule-card'
import { getActiveWorkflowSearchHighlight } from '@/platform/app/(shell)/workspace/[workspaceId]/workflows/_components/editor/formatted-text/search-highlight'
import styles from '@/platform/app/(shell)/workspace/[workspaceId]/workflows/_components/editor/knowledge-tag-filters/knowledge-tag-filters.module.css'
import { ReferenceField } from '@/platform/app/(shell)/workspace/[workspaceId]/workflows/_components/editor/reference-field/reference-field'
import type {
  ActiveSearchTarget,
  UseSubBlockInputResult,
} from '@/platform/lib/data/workflow-editor'
import {
  FIELD_TYPE_LABELS,
  type FilterFieldType,
  getOperatorsForFieldType,
  getPlaceholderForFieldType,
} from '@/platform/lib/data/workflow-editor/builders'

const EMPTY_FIELD = {}

/** One stored tag filter of a knowledge search; `valueTo` is the upper bound of a `between`. */
export interface TagFilter {
  id: string
  tagName: string
  tagSlot?: string
  fieldType: FilterFieldType
  operator: string
  tagValue: string
  valueTo?: string
  collapsed?: boolean
}

/** The filter fields a viewer edits directly. */
export type TagFilterField = 'tagName' | 'operator' | 'tagValue' | 'valueTo'

/** Props for {@link TagFilterRow}. */
interface TagFilterRowProps {
  blockId: string
  subBlockId: string
  filter: TagFilter
  index: number
  tagOptions: { value: string; label: string }[]
  tagsLoading: boolean
  readOnly: boolean
  controller: UseSubBlockInputResult
  accessiblePrefixes: Set<string> | undefined
  activeSearchTarget: ActiveSearchTarget | null
  onAdd: () => void
  onRemove: (id: string) => void
  onUpdate: (id: string, field: TagFilterField, value: string) => void
  onReferenceSelect: (id: string, field: 'tagValue' | 'valueTo', value: string) => void
  onToggleCollapse: (id: string) => void
}

/**
 * One tag filter: a tag of the selected knowledge base, an operator for its type and a
 * reference-aware value, or a pair of values for `between`. Collapsed, its header shows the tag and
 * its type.
 */
export function TagFilterRow({
  blockId,
  subBlockId,
  filter,
  index,
  tagOptions,
  tagsLoading,
  readOnly,
  controller,
  accessiblePrefixes,
  activeSearchTarget,
  onAdd,
  onRemove,
  onUpdate,
  onReferenceSelect,
  onToggleCollapse,
}: TagFilterRowProps) {
  const valueId = useId()
  const name = `Filter ${index + 1}`
  const operatorOptions = getOperatorsForFieldType(filter.fieldType).map((operator) => ({
    value: operator.value,
    label: operator.label,
  }))
  const placeholder = getPlaceholderForFieldType(filter.fieldType)

  const renderValue = (field: 'tagValue' | 'valueTo', label: string, id?: string) => (
    <ReferenceField
      controller={controller}
      fieldKey={`${filter.id}-${field}`}
      blockId={blockId}
      id={id}
      label={label}
      placeholder={placeholder}
      value={(field === 'tagValue' ? filter.tagValue : filter.valueTo) || ''}
      onChange={(next) => onUpdate(filter.id, field, next)}
      onReferenceSelect={(next) => onReferenceSelect(filter.id, field, next)}
      disabled={readOnly}
      accessiblePrefixes={accessiblePrefixes}
      searchHighlight={getActiveWorkflowSearchHighlight({
        activeSearchTarget,
        subBlockId,
        valuePath: [index, field],
      })}
    />
  )

  return (
    <RuleCard
      label={name}
      title={filter.collapsed ? filter.tagName || name : name}
      detail={
        filter.collapsed && filter.tagName
          ? FIELD_TYPE_LABELS[filter.fieldType] || 'Text'
          : undefined
      }
      collapsed={filter.collapsed}
      onToggle={readOnly ? undefined : () => onToggleCollapse(filter.id)}
      actions={
        readOnly ? undefined : (
          <>
            <IconButton label='Add filter' icon='I074' size='compact' tooltip onClick={onAdd} />
            <IconButton
              label={`Delete ${name.toLowerCase()}`}
              icon='I105'
              size='compact'
              tooltip
              onClick={() => onRemove(filter.id)}
            />
          </>
        )
      }
    >
      <SearchableSelect
        label='Tag'
        options={tagOptions}
        value={filter.tagName || null}
        selectedLabel={filter.tagName || undefined}
        placeholder='Select tag'
        searchLabel='Search tags'
        onValueChange={(next) => {
          if (next !== null) onUpdate(filter.id, 'tagName', next)
        }}
        disabled={readOnly || tagsLoading}
      />
      <Select
        label='Operator'
        field={EMPTY_FIELD}
        options={operatorOptions}
        value={filter.operator}
        onValueChange={(next) => onUpdate(filter.id, 'operator', next)}
        disabled={readOnly}
      />
      <RuleField label='Value' htmlFor={valueId}>
        {filter.operator === 'between' ? (
          <div className={styles.range}>
            <div className={styles.bound}>{renderValue('tagValue', `${name} from`, valueId)}</div>
            <span className={styles.to} data-type='T052'>
              to
            </span>
            <div className={styles.bound}>{renderValue('valueTo', `${name} to`)}</div>
          </div>
        ) : (
          renderValue('tagValue', `${name} value`, valueId)
        )}
      </RuleField>
    </RuleCard>
  )
}
