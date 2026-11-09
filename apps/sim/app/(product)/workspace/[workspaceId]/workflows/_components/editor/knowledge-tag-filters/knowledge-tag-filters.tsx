'use client'

import { useState } from 'react'
import { generateId } from '@sim/utils/id'
import { useActiveSearchTarget } from '@/app/(product)/workspace/[workspaceId]/workflows/_components/editor/active-search-target/active-search-target'
import { RuleList } from '@/app/(product)/workspace/[workspaceId]/workflows/_components/editor/filter-builder/rule-card'
import styles from '@/app/(product)/workspace/[workspaceId]/workflows/_components/editor/knowledge-tag-filters/knowledge-tag-filters.module.css'
import {
  type TagFilter,
  type TagFilterField,
  TagFilterRow,
} from '@/app/(product)/workspace/[workspaceId]/workflows/_components/editor/knowledge-tag-filters/tag-filter-row'
import {
  parseJsonArrayValue,
  type SubBlockConfig,
  useAccessibleReferencePrefixes,
  useDependsOnGate,
  useSubBlockInput,
  useSubBlockValue,
  useTagSelection,
} from '@/platform/lib/data/workflow-editor'
import {
  type FilterFieldType,
  getOperatorsForFieldType,
  useKnowledgeBaseTagDefinitions,
} from '@/platform/lib/data/workflow-editor/builders'

interface KnowledgeTagFiltersProps {
  blockId: string
  subBlock: SubBlockConfig
  disabled?: boolean
  isPreview?: boolean
  previewValue?: unknown
  previewContextValues?: Record<string, unknown>
}

const FIELD_TYPES: readonly FilterFieldType[] = ['text', 'number', 'date', 'boolean']

const createDefaultFilter = (): TagFilter => ({
  id: generateId(),
  tagName: '',
  fieldType: 'text',
  operator: 'eq',
  tagValue: '',
  collapsed: false,
})

const parseFilters = (value: unknown): TagFilter[] =>
  parseJsonArrayValue<TagFilter>(value).map((filter) => ({
    ...filter,
    fieldType: filter.fieldType || 'text',
    operator: filter.operator || 'eq',
    collapsed: filter.collapsed ?? false,
  }))

/**
 * The tag filters of a knowledge search, stored as a JSON string: each names a tag of the selected
 * knowledge base, an operator for the tag's type and a reference-aware value or range. The last
 * filter resets rather than disappearing, and a preview shows only how many apply.
 */
export function KnowledgeTagFilters({
  blockId,
  subBlock,
  disabled = false,
  isPreview = false,
  previewValue,
  previewContextValues,
}: KnowledgeTagFiltersProps) {
  const activeSearchTarget = useActiveSearchTarget()
  const [storeValue, setStoreValue] = useSubBlockValue<string | null>(blockId, subBlock.id)
  const emitTagSelection = useTagSelection(blockId, subBlock.id)
  const { dependencyValues } = useDependsOnGate(blockId, subBlock, {
    disabled,
    isPreview,
    previewContextValues,
  })
  const knowledgeBaseIdValue = dependencyValues.knowledgeBaseSelector
  const knowledgeBaseId =
    typeof knowledgeBaseIdValue === 'string' && knowledgeBaseIdValue.trim().length > 0
      ? knowledgeBaseIdValue
      : null
  const { tagDefinitions, isLoading } = useKnowledgeBaseTagDefinitions(knowledgeBaseId)
  const accessiblePrefixes = useAccessibleReferencePrefixes(blockId)
  const controller = useSubBlockInput({
    blockId,
    subBlockId: subBlock.id,
    config: { id: subBlock.id, type: 'knowledge-tag-filters', connectionDroppable: true },
    isPreview,
    disabled,
  })
  const [placeholderFilter] = useState(createDefaultFilter)

  const parsedFilters = parseFilters(isPreview ? previewValue : storeValue)
  const filters = parsedFilters.length > 0 ? parsedFilters : [placeholderFilter]
  const readOnly = isPreview || disabled

  const writeFilters = (next: TagFilter[]) => {
    if (readOnly) return
    setStoreValue(next.length > 0 ? JSON.stringify(next) : null)
  }

  const addFilter = () => writeFilters([...filters, createDefaultFilter()])

  const removeFilter = (id: string) =>
    writeFilters(
      filters.length === 1 ? [createDefaultFilter()] : filters.filter((filter) => filter.id !== id)
    )

  /**
   * Choosing a tag takes its slot and type and restarts the comparison; leaving `between` drops the
   * upper bound.
   */
  const updateFilter = (id: string, field: TagFilterField, value: string) => {
    writeFilters(
      filters.map((filter) => {
        if (filter.id !== id) return filter
        const updated: TagFilter = { ...filter, [field]: value }
        if (field === 'tagName') {
          const definition = tagDefinitions.find((tag) => tag.displayName === value)
          const fieldType = FIELD_TYPES.find((type) => type === definition?.fieldType) ?? 'text'
          updated.tagSlot = definition?.tagSlot
          updated.fieldType = fieldType
          updated.operator = getOperatorsForFieldType(fieldType)[0]?.value || 'eq'
          updated.tagValue = ''
          updated.valueTo = undefined
        }
        if (field === 'operator' && value !== 'between') updated.valueTo = undefined
        return updated
      })
    )
  }

  const selectReference = (id: string, field: 'tagValue' | 'valueTo', value: string) => {
    if (readOnly) return
    const next = filters.map((filter) =>
      filter.id === id ? { ...filter, [field]: value } : filter
    )
    emitTagSelection(JSON.stringify(next))
  }

  const toggleCollapse = (id: string) =>
    writeFilters(
      filters.map((filter) =>
        filter.id === id ? { ...filter, collapsed: !filter.collapsed } : filter
      )
    )

  if (isPreview) {
    const applied = filters.filter(
      (filter) => filter.tagName.trim() && filter.tagValue.trim()
    ).length
    return (
      <span className={styles.summary} data-type='T052'>
        {applied === 0
          ? 'No filters'
          : `${applied} ${applied === 1 ? 'filter' : 'filters'} applied`}
      </span>
    )
  }

  const tagOptions = tagDefinitions.map((tag) => ({
    value: tag.displayName,
    label: tag.displayName,
  }))

  return (
    <RuleList>
      {filters.map((filter, index) => (
        <TagFilterRow
          key={filter.id}
          blockId={blockId}
          subBlockId={subBlock.id}
          filter={filter}
          index={index}
          tagOptions={tagOptions}
          tagsLoading={isLoading}
          readOnly={readOnly}
          controller={controller}
          accessiblePrefixes={accessiblePrefixes}
          activeSearchTarget={activeSearchTarget}
          onAdd={addFilter}
          onRemove={removeFilter}
          onUpdate={updateFilter}
          onReferenceSelect={selectReference}
          onToggleCollapse={toggleCollapse}
        />
      ))}
    </RuleList>
  )
}
