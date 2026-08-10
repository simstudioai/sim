'use client'

import { useRef } from 'react'
import {
  Badge,
  Button,
  ChipCombobox,
  CollapsibleCard,
  type ComboboxOption,
  Label,
  Trash,
} from '@sim/emcn'
import { Plus } from '@sim/emcn/icons'
import { generateId } from '@sim/utils/id'
import { FIELD_TYPE_LABELS, getPlaceholderForFieldType } from '@/lib/knowledge/constants'
import { type FilterFieldType, getOperatorsForFieldType } from '@/lib/knowledge/filters/types'
import { formatDisplayText } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/editor/components/sub-block/components/formatted-text'
import { ReferenceTextInput } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/editor/components/sub-block/components/reference-text-control'
import { TagDropdown } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/editor/components/sub-block/components/tag-dropdown/tag-dropdown'
import { getActiveWorkflowSearchHighlight } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/editor/components/sub-block/components/workflow-search-highlight'
import { useDependsOnGate } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/editor/components/sub-block/hooks/use-depends-on-gate'
import { useSubBlockInput } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/editor/components/sub-block/hooks/use-sub-block-input'
import { useSubBlockValue } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/editor/components/sub-block/hooks/use-sub-block-value'
import { parseJsonArrayValue } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/editor/components/sub-block/utils'
import { useActiveSearchTarget } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/editor/providers/active-search-target-provider'
import { useAccessibleReferencePrefixes } from '@/app/workspace/[workspaceId]/w/[workflowId]/hooks/use-accessible-reference-prefixes'
import type { SubBlockConfig } from '@/blocks/types'
import { useKnowledgeBaseTagDefinitions } from '@/hooks/kb/use-knowledge-base-tag-definitions'
import { useTagSelection } from '@/hooks/kb/use-tag-selection'

interface TagFilter {
  id: string
  tagName: string
  tagSlot?: string
  fieldType: FilterFieldType
  operator: string
  tagValue: string
  valueTo?: string
  collapsed?: boolean
}

interface KnowledgeTagFiltersProps {
  blockId: string
  subBlock: SubBlockConfig
  disabled?: boolean
  isPreview?: boolean
  previewValue?: string | null
  previewContextValues?: Record<string, unknown>
}

/**
 * Creates a new filter with default values
 */
const createDefaultFilter = (): TagFilter => ({
  id: generateId(),
  tagName: '',
  fieldType: 'text',
  operator: 'eq',
  tagValue: '',
  collapsed: false,
})

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
  const valueInputRefs = useRef<Record<string, HTMLInputElement>>({})
  const overlayRefs = useRef<Record<string, HTMLDivElement>>({})

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

  const inputController = useSubBlockInput({
    blockId,
    subBlockId: subBlock.id,
    config: {
      id: subBlock.id,
      type: 'knowledge-tag-filters',
      connectionDroppable: true,
    },
    isPreview,
    disabled,
  })

  const parseFilters = (filterValue: unknown): TagFilter[] =>
    parseJsonArrayValue<TagFilter>(filterValue).map((f) => ({
      ...f,
      fieldType: f.fieldType || 'text',
      operator: f.operator || 'eq',
      collapsed: f.collapsed ?? false,
    }))

  const currentValue = isPreview ? previewValue : storeValue
  const parsedFilters = parseFilters(currentValue)
  const filters: TagFilter[] = parsedFilters.length > 0 ? parsedFilters : [createDefaultFilter()]
  const isReadOnly = isPreview || disabled

  /**
   * Updates the store with new filters
   */
  const updateFilters = (newFilters: TagFilter[]) => {
    if (isReadOnly) return
    const value = newFilters.length > 0 ? JSON.stringify(newFilters) : null
    setStoreValue(value)
  }

  /**
   * Adds a new filter
   */
  const addFilter = () => {
    if (isReadOnly) return
    updateFilters([...filters, createDefaultFilter()])
  }

  /**
   * Removes a filter by ID, or resets it if it's the last one
   */
  const removeFilter = (id: string) => {
    if (isReadOnly) return
    if (filters.length === 1) {
      // Reset the last filter instead of removing it
      updateFilters([createDefaultFilter()])
    } else {
      updateFilters(filters.filter((f) => f.id !== id))
    }
  }

  /**
   * Updates a specific filter property
   */
  const updateFilter = (id: string, field: keyof TagFilter, value: any) => {
    if (isReadOnly) return

    const updatedFilters = filters.map((f) => {
      if (f.id === id) {
        const updated = { ...f, [field]: value }

        // When tag changes, reset operator and value based on new field type
        if (field === 'tagName') {
          const tagDef = tagDefinitions.find((t) => t.displayName === value)
          const fieldType = (tagDef?.fieldType || 'text') as FilterFieldType
          const operators = getOperatorsForFieldType(fieldType)
          updated.tagSlot = tagDef?.tagSlot
          updated.fieldType = fieldType
          updated.operator = operators[0]?.value || 'eq'
          updated.tagValue = ''
          updated.valueTo = undefined
        }

        // When field type changes, reset operator and value
        if (field === 'fieldType') {
          const operators = getOperatorsForFieldType(value as FilterFieldType)
          updated.operator = operators[0]?.value || 'eq'
          updated.tagValue = ''
          updated.valueTo = undefined
        }

        // When operator changes from 'between', clear valueTo
        if (field === 'operator' && value !== 'between') {
          updated.valueTo = undefined
        }

        return updated
      }
      return f
    })

    updateFilters(updatedFilters)
  }

  /**
   * Handles tag dropdown selection for value field
   */
  const handleTagDropdownSelection = (id: string, field: 'tagValue' | 'valueTo', value: string) => {
    if (isReadOnly) return

    const updatedFilters = filters.map((f) => (f.id === id ? { ...f, [field]: value } : f))
    const jsonValue = updatedFilters.length > 0 ? JSON.stringify(updatedFilters) : ''
    emitTagSelection(jsonValue)
  }

  /**
   * Toggles the collapsed state of a filter
   */
  const toggleCollapse = (id: string) => {
    if (isReadOnly) return
    updateFilters(filters.map((f) => (f.id === id ? { ...f, collapsed: !f.collapsed } : f)))
  }

  /**
   * Syncs scroll position between input and overlay
   */
  const syncOverlayScroll = (filterId: string, scrollLeft: number) => {
    const overlay = overlayRefs.current[filterId]
    if (overlay) overlay.scrollLeft = scrollLeft
  }

  if (isPreview) {
    const appliedFilters = filters.filter((f) => f.tagName.trim() && f.tagValue.trim()).length

    return (
      <div className='space-y-1'>
        <Label className='font-medium text-muted-foreground text-xs'>Tag Filters</Label>
        <div className='text-muted-foreground text-sm'>
          {appliedFilters > 0 ? `${appliedFilters} filter(s) applied` : 'No filters'}
        </div>
      </div>
    )
  }

  /**
   * Renders the value input with tag dropdown support
   */
  const renderValueInput = (filter: TagFilter, field: 'tagValue' | 'valueTo') => {
    const fieldValue = field === 'tagValue' ? filter.tagValue : filter.valueTo || ''
    const cellKey = `${filter.id}-${field}`
    const placeholder = getPlaceholderForFieldType(filter.fieldType)
    const filterIndex = filters.findIndex((candidate) => candidate.id === filter.id)
    const workflowSearchHighlight = getActiveWorkflowSearchHighlight({
      activeSearchTarget,
      subBlockId: subBlock.id,
      valuePath: [filterIndex, field],
    })

    const fieldState = inputController.fieldHelpers.getFieldState(cellKey)
    const handlers = inputController.fieldHelpers.createFieldHandlers(
      cellKey,
      fieldValue,
      (newValue) => updateFilter(filter.id, field, newValue)
    )
    const tagSelectHandler = inputController.fieldHelpers.createTagSelectHandler(
      cellKey,
      fieldValue,
      (newValue) => handleTagDropdownSelection(filter.id, field, newValue)
    )

    return (
      <div className='relative'>
        <ReferenceTextInput
          ref={(el) => {
            if (el) valueInputRefs.current[cellKey] = el
          }}
          overlayRef={(el) => {
            if (el) overlayRefs.current[cellKey] = el
          }}
          overlayContent={
            <div className='min-w-fit whitespace-pre'>
              {formatDisplayText(
                fieldValue,
                accessiblePrefixes
                  ? { accessiblePrefixes, workflowSearchHighlight }
                  : { highlightAll: true, workflowSearchHighlight }
              )}
            </div>
          }
          interactiveOverlay={isReadOnly}
          inputClassName='allow-scroll'
          value={fieldValue}
          onChange={handlers.onChange}
          onKeyDown={handlers.onKeyDown}
          onDrop={handlers.onDrop}
          onDragOver={handlers.onDragOver}
          onFocus={handlers.onFocus}
          onScroll={(e) => syncOverlayScroll(cellKey, e.currentTarget.scrollLeft)}
          onPaste={() =>
            setTimeout(() => {
              const input = valueInputRefs.current[cellKey]
              input && syncOverlayScroll(cellKey, input.scrollLeft)
            }, 0)
          }
          disabled={isReadOnly}
          autoComplete='off'
          placeholder={placeholder}
          className='w-full'
        />
        {fieldState.showTags && (
          <TagDropdown
            visible={fieldState.showTags}
            onSelect={tagSelectHandler}
            blockId={blockId}
            activeSourceBlockId={fieldState.activeSourceBlockId}
            inputValue={fieldValue}
            cursorPosition={fieldState.cursorPosition}
            onClose={() => inputController.fieldHelpers.hideFieldDropdowns(cellKey)}
            inputRef={{ current: valueInputRefs.current[cellKey] || null }}
          />
        )}
      </div>
    )
  }

  /**
   * Renders the filter content (tag, operator, value inputs)
   */
  const renderFilterContent = (filter: TagFilter) => {
    const tagOptions: ComboboxOption[] = tagDefinitions.map((tag) => ({
      value: tag.displayName,
      label: tag.displayName,
    }))

    const operators = getOperatorsForFieldType(filter.fieldType)
    const operatorOptions: ComboboxOption[] = operators.map((op) => ({
      value: op.value,
      label: op.label,
    }))

    const isBetween = filter.operator === 'between'

    return (
      <>
        <div className='flex flex-col gap-1.5'>
          <Label className='text-small'>Tag</Label>
          <ChipCombobox
            options={tagOptions}
            value={filter.tagName}
            onChange={(value) => updateFilter(filter.id, 'tagName', value)}
            disabled={isReadOnly || isLoading}
            placeholder='Select tag'
          />
        </div>

        <div className='flex flex-col gap-1.5'>
          <Label className='text-small'>Operator</Label>
          <ChipCombobox
            options={operatorOptions}
            value={filter.operator}
            onChange={(value) => updateFilter(filter.id, 'operator', value)}
            disabled={isReadOnly}
            placeholder='Select operator'
          />
        </div>

        <div className='flex flex-col gap-1.5'>
          <Label className='text-small'>Value</Label>
          {isBetween ? (
            <div className='flex items-center gap-2'>
              <div className='flex-1'>{renderValueInput(filter, 'tagValue')}</div>
              <span className='flex-shrink-0 text-muted-foreground text-xs'>to</span>
              <div className='flex-1'>{renderValueInput(filter, 'valueTo')}</div>
            </div>
          ) : (
            renderValueInput(filter, 'tagValue')
          )}
        </div>
      </>
    )
  }

  return (
    <div className='space-y-2'>
      {filters.map((filter, index) => (
        <CollapsibleCard
          key={filter.id}
          data-filter-id={filter.id}
          title={filter.collapsed ? filter.tagName || `Filter ${index + 1}` : `Filter ${index + 1}`}
          badge={
            filter.collapsed && filter.tagName ? (
              <Badge variant='type' size='sm'>
                {FIELD_TYPE_LABELS[filter.fieldType] || 'Text'}
              </Badge>
            ) : undefined
          }
          actions={
            <>
              <Button
                variant='quiet'
                size='icon'
                onClick={addFilter}
                disabled={isReadOnly}
                aria-label='Add filter'
              >
                <Plus className='size-[14px]' />
              </Button>
              <Button
                variant='quiet'
                size='icon'
                onClick={() => removeFilter(filter.id)}
                disabled={isReadOnly}
                aria-label='Delete filter'
              >
                <Trash className='size-[14px] text-[var(--text-error)]' />
              </Button>
            </>
          }
          collapsed={filter.collapsed ?? false}
          onToggleCollapse={() => toggleCollapse(filter.id)}
        >
          {renderFilterContent(filter)}
        </CollapsibleCard>
      ))}
    </div>
  )
}
