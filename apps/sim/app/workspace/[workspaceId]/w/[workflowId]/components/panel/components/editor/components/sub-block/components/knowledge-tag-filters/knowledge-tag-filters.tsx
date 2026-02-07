'use client'

import { useRef } from 'react'
import { Plus } from 'lucide-react'
import {
  Badge,
  Button,
  Combobox,
  type ComboboxOption,
  Input,
  Label,
  Trash,
} from '@/components/emcn'
import { cn } from '@/lib/core/utils/cn'
import { FIELD_TYPE_LABELS, getPlaceholderForFieldType } from '@/lib/knowledge/constants'
import { type FilterFieldType, getOperatorsForFieldType } from '@/lib/knowledge/filters/types'
import { formatDisplayText } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/editor/components/sub-block/components/formatted-text'
import { TagDropdown } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/editor/components/sub-block/components/tag-dropdown/tag-dropdown'
import { useSubBlockInput } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/editor/components/sub-block/hooks/use-sub-block-input'
import { resolvePreviewContextValue } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/editor/components/sub-block/utils'
import { useAccessibleReferencePrefixes } from '@/app/workspace/[workspaceId]/w/[workflowId]/hooks/use-accessible-reference-prefixes'
import type { SubBlockConfig } from '@/blocks/types'
import { useKnowledgeBaseTagDefinitions } from '@/hooks/kb/use-knowledge-base-tag-definitions'
import { useTagSelection } from '@/hooks/kb/use-tag-selection'
import { useSubBlockValue } from '../../hooks/use-sub-block-value'

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
  id: crypto.randomUUID(),
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
  const [storeValue, setStoreValue] = useSubBlockValue<string | null>(blockId, subBlock.id)
  const emitTagSelection = useTagSelection(blockId, subBlock.id)
  const valueInputRefs = useRef<Record<string, HTMLInputElement>>({})
  const overlayRefs = useRef<Record<string, HTMLDivElement>>({})

  const [knowledgeBaseIdFromStore] = useSubBlockValue(blockId, 'knowledgeBaseId')
  const knowledgeBaseIdValue = previewContextValues
    ? resolvePreviewContextValue(previewContextValues.knowledgeBaseId)
    : knowledgeBaseIdFromStore
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

  const parseFilters = (filterValue: string | null): TagFilter[] => {
    if (!filterValue) return []
    try {
      const parsed = JSON.parse(filterValue)
      if (!Array.isArray(parsed)) return []
      return parsed.map((f: TagFilter) => ({
        ...f,
        fieldType: f.fieldType || 'text',
        operator: f.operator || 'eq',
        collapsed: f.collapsed ?? false,
      }))
    } catch {
      return []
    }
  }

  const currentValue = isPreview ? previewValue : storeValue
  const parsedFilters = parseFilters(currentValue || null)
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
    const jsonValue = updatedFilters.length > 0 ? JSON.stringify(updatedFilters) : null
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
   * Renders the filter header with name, badge, and action buttons
   * Shows tag name only when collapsed (as summary), generic label when expanded
   */
  const renderFilterHeader = (filter: TagFilter, index: number) => (
    <div
      className='flex cursor-pointer items-center justify-between rounded-t-[4px] bg-[var(--surface-4)] px-[10px] py-[5px]'
      onClick={() => toggleCollapse(filter.id)}
    >
      <div className='flex min-w-0 flex-1 items-center gap-[8px]'>
        <span className='block truncate font-medium text-[14px] text-[var(--text-tertiary)]'>
          {filter.collapsed ? filter.tagName || `Filter ${index + 1}` : `Filter ${index + 1}`}
        </span>
        {filter.collapsed && filter.tagName && (
          <Badge variant='type' size='sm'>
            {FIELD_TYPE_LABELS[filter.fieldType] || 'Text'}
          </Badge>
        )}
      </div>
      <div className='flex items-center gap-[8px] pl-[8px]' onClick={(e) => e.stopPropagation()}>
        <Button variant='ghost' onClick={addFilter} disabled={isReadOnly} className='h-auto p-0'>
          <Plus className='h-[14px] w-[14px]' />
          <span className='sr-only'>Add Filter</span>
        </Button>
        <Button
          variant='ghost'
          onClick={() => removeFilter(filter.id)}
          disabled={isReadOnly}
          className='h-auto p-0 text-[var(--text-error)] hover:text-[var(--text-error)]'
        >
          <Trash className='h-[14px] w-[14px]' />
          <span className='sr-only'>Delete Filter</span>
        </Button>
      </div>
    </div>
  )

  /**
   * Renders the value input with tag dropdown support
   */
  const renderValueInput = (filter: TagFilter, field: 'tagValue' | 'valueTo') => {
    const fieldValue = field === 'tagValue' ? filter.tagValue : filter.valueTo || ''
    const cellKey = `${filter.id}-${field}`
    const placeholder = getPlaceholderForFieldType(filter.fieldType)

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
        <Input
          ref={(el) => {
            if (el) valueInputRefs.current[cellKey] = el
          }}
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
          className='allow-scroll w-full overflow-auto text-transparent caret-foreground'
        />
        <div
          ref={(el) => {
            if (el) overlayRefs.current[cellKey] = el
          }}
          className='pointer-events-none absolute inset-0 flex items-center overflow-x-auto bg-transparent px-[8px] py-[6px] font-medium font-sans text-sm'
        >
          <div className='w-full whitespace-pre' style={{ minWidth: 'fit-content' }}>
            {formatDisplayText(
              fieldValue,
              accessiblePrefixes ? { accessiblePrefixes } : { highlightAll: true }
            )}
          </div>
        </div>
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
      <div className='flex flex-col gap-[8px] border-[var(--border-1)] border-t px-[10px] pt-[6px] pb-[10px]'>
        <div className='flex flex-col gap-[6px]'>
          <Label className='text-[13px]'>Tag</Label>
          <Combobox
            options={tagOptions}
            value={filter.tagName}
            onChange={(value) => updateFilter(filter.id, 'tagName', value)}
            disabled={isReadOnly || isLoading}
            placeholder='Select tag'
          />
        </div>

        <div className='flex flex-col gap-[6px]'>
          <Label className='text-[13px]'>Operator</Label>
          <Combobox
            options={operatorOptions}
            value={filter.operator}
            onChange={(value) => updateFilter(filter.id, 'operator', value)}
            disabled={isReadOnly}
            placeholder='Select operator'
          />
        </div>

        <div className='flex flex-col gap-[6px]'>
          <Label className='text-[13px]'>Value</Label>
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
      </div>
    )
  }

  return (
    <div className='space-y-[8px]'>
      {filters.map((filter, index) => (
        <div
          key={filter.id}
          data-filter-id={filter.id}
          className={cn(
            'rounded-[4px] border border-[var(--border-1)]',
            filter.collapsed ? 'overflow-hidden' : 'overflow-visible'
          )}
        >
          {renderFilterHeader(filter, index)}
          {!filter.collapsed && renderFilterContent(filter)}
        </div>
      ))}
    </div>
  )
}
