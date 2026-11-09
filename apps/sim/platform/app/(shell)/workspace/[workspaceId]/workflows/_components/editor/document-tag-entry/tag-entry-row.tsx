'use client'

import { useId } from 'react'
import { IconButton } from '@sim/emcn/button'
import { FieldFrame } from '@sim/emcn/field'
import { SearchableSelect } from '@sim/emcn/picker/searchable-select'
import { RuleCard } from '@/platform/app/(shell)/workspace/[workspaceId]/workflows/_components/editor/filter-builder/rule-card'
import { getActiveWorkflowSearchHighlight } from '@/platform/app/(shell)/workspace/[workspaceId]/workflows/_components/editor/formatted-text/search-highlight'
import { ReferenceField } from '@/platform/app/(shell)/workspace/[workspaceId]/workflows/_components/editor/reference-field/reference-field'
import type {
  ActiveSearchTarget,
  UseSubBlockInputResult,
} from '@/platform/lib/data/workflow-editor'
import {
  FIELD_TYPE_LABELS,
  getPlaceholderForFieldType,
} from '@/platform/lib/data/workflow-editor/builders'

/** One stored tag of a document being created: the knowledge base tag and its value. */
export interface DocumentTag {
  id: string
  tagName: string
  tagSlot?: string
  fieldType: string
  value: string
  collapsed?: boolean
}

/** Props for {@link TagEntryRow}. */
interface TagEntryRowProps {
  blockId: string
  subBlockId: string
  tag: DocumentTag
  index: number
  /** The tags this entry may take: its own and those no other entry holds. */
  tagOptions: { value: string; label: string }[]
  tagsLoading: boolean
  canAddMore: boolean
  readOnly: boolean
  controller: UseSubBlockInputResult
  accessiblePrefixes: Set<string> | undefined
  activeSearchTarget: ActiveSearchTarget | null
  onAdd: () => void
  onRemove: (id: string) => void
  onChangeTag: (id: string, tagName: string) => void
  onChangeValue: (id: string, value: string) => void
  onReferenceSelect: (id: string, value: string) => void
  onToggleCollapse: (id: string) => void
}

/**
 * One document tag: a knowledge base tag no other entry uses and its reference-aware value.
 * Collapsed, its header shows the tag and its type.
 */
export function TagEntryRow({
  blockId,
  subBlockId,
  tag,
  index,
  tagOptions,
  tagsLoading,
  canAddMore,
  readOnly,
  controller,
  accessiblePrefixes,
  activeSearchTarget,
  onAdd,
  onRemove,
  onChangeTag,
  onChangeValue,
  onReferenceSelect,
  onToggleCollapse,
}: TagEntryRowProps) {
  const valueId = useId()
  const name = `Tag ${index + 1}`

  return (
    <RuleCard
      label={name}
      title={tag.collapsed ? tag.tagName || name : name}
      detail={tag.collapsed && tag.tagName ? FIELD_TYPE_LABELS[tag.fieldType] || 'Text' : undefined}
      collapsed={tag.collapsed}
      onToggle={readOnly ? undefined : () => onToggleCollapse(tag.id)}
      actions={
        readOnly ? undefined : (
          <>
            <IconButton
              label='Add tag'
              icon='I074'
              size='compact'
              tooltip
              disabled={!canAddMore}
              onClick={onAdd}
            />
            <IconButton
              label={`Delete ${name.toLowerCase()}`}
              icon='I105'
              size='compact'
              tooltip
              onClick={() => onRemove(tag.id)}
            />
          </>
        )
      }
    >
      <SearchableSelect
        label='Tag'
        options={tagOptions}
        value={tag.tagName || null}
        selectedLabel={tag.tagName || undefined}
        placeholder='Select tag'
        searchLabel='Search tags'
        onValueChange={(next) => {
          if (next !== null) onChangeTag(tag.id, next)
        }}
        disabled={readOnly || tagsLoading}
      />
      <FieldFrame id={valueId} label='Value'>
        <ReferenceField
          controller={controller}
          fieldKey={`${tag.id}-value`}
          blockId={blockId}
          id={valueId}
          label={`${name} value`}
          placeholder={getPlaceholderForFieldType(tag.fieldType)}
          value={tag.value || ''}
          onChange={(next) => onChangeValue(tag.id, next)}
          onReferenceSelect={(next) => onReferenceSelect(tag.id, next)}
          disabled={readOnly}
          accessiblePrefixes={accessiblePrefixes}
          searchHighlight={getActiveWorkflowSearchHighlight({
            activeSearchTarget,
            subBlockId,
            valuePath: [index, 'value'],
          })}
        />
      </FieldFrame>
    </RuleCard>
  )
}
