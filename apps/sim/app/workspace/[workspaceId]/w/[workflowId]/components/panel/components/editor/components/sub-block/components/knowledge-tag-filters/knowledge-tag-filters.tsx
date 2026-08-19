'use client'

import { useEffect, useMemo, useRef } from 'react'
import {
  Badge,
  Button,
  Combobox,
  type ComboboxOption,
  cn,
  handleKeyboardActivation,
  Input,
  Label,
  Trash,
} from '@sim/emcn'
import { Plus } from '@sim/emcn/icons'
import { generateId } from '@sim/utils/id'
import {
  FIELD_TYPE_LABELS,
  getPlaceholderForFieldType,
  SUPPORTED_FIELD_TYPES,
} from '@/lib/knowledge/constants'
import { type FilterFieldType, getOperatorsForFieldType } from '@/lib/knowledge/filters/types'
import { formatDisplayText } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/editor/components/sub-block/components/formatted-text'
import { TagDropdown } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/editor/components/sub-block/components/tag-dropdown/tag-dropdown'
import { getActiveWorkflowSearchHighlight } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/editor/components/sub-block/components/workflow-search-highlight'
import { useDependsOnGate } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/editor/components/sub-block/hooks/use-depends-on-gate'
import { useSubBlockInput } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/editor/components/sub-block/hooks/use-sub-block-input'
import { parseJsonArrayValue } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/editor/components/sub-block/utils'
import { useActiveSearchTarget } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/editor/providers/active-search-target-provider'
import { useAccessibleReferencePrefixes } from '@/app/workspace/[workspaceId]/w/[workflowId]/hooks/use-accessible-reference-prefixes'
import type { SubBlockConfig } from '@/blocks/types'
import { useKnowledgeBaseTagDefinitions } from '@/hooks/kb/use-knowledge-base-tag-definitions'
import { useTagSelection } from '@/hooks/kb/use-tag-selection'
import { useSubBlockValue } from '../../hooks/use-sub-block-value'

interface TagFilter {
  id: string
  tagName: string
  tagId?: string
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
  tagId: '',
  fieldType: 'text',
  operator: 'eq',
  tagValue: '',
  collapsed: false,
})

const ALL_OPERATOR_OPTIONS = Array.from(
  new Map(
    SUPPORTED_FIELD_TYPES.flatMap((fieldType) =>
      getOperatorsForFieldType(fieldType).map((operator) => [operator.value, operator])
    )
  ).values()
)

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
  const canonicalKnowledgeBaseIdValue = previewContextValues?.knowledgeBaseId
  const knowledgeBaseIdValue =
    typeof canonicalKnowledgeBaseIdValue === 'string' &&
    canonicalKnowledgeBaseIdValue.trim().length > 0
      ? canonicalKnowledgeBaseIdValue
      : dependencyValues.knowledgeBaseSelector
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

  const currentValue = isPreview ? previewValue : storeValue
  const parsedFilters = useMemo(
    () =>
      parseJsonArrayValue<TagFilter>(currentValue).map((filter) => ({
        ...filter,
        fieldType: filter.fieldType || 'text',
        operator: filter.operator || 'eq',
        collapsed: filter.collapsed ?? false,
      })),
    [currentValue]
  )
  const defaultFilter = useMemo(createDefaultFilter, [])
  const filters: TagFilter[] = parsedFilters.length > 0 ? parsedFilters : [defaultFilter]
  const isReadOnly = isPreview || disabled
  const usesTagIds = subBlock.mode === 'advanced'
  const getResolvedTagDefinition = (filter: TagFilter) =>
    usesTagIds ? tagDefinitions.find((tag) => tag.id === filter.tagId) : undefined
  const getEffectiveFieldType = (filter: TagFilter): FilterFieldType =>
    (getResolvedTagDefinition(filter)?.fieldType || filter.fieldType || 'text') as FilterFieldType

  useEffect(() => {
    if (isReadOnly || !usesTagIds || parsedFilters.length === 0) return

    let changed = false
    const normalizedFilters = parsedFilters.map((filter) => {
      const tagDefinition = tagDefinitions.find((tag) => tag.id === filter.tagId)
      if (!tagDefinition) return filter

      const fieldType = tagDefinition.fieldType as FilterFieldType
      const validOperators = getOperatorsForFieldType(fieldType)
      const operatorIsValid = validOperators.some((operator) => operator.value === filter.operator)
      const operator = operatorIsValid ? filter.operator : validOperators[0]?.value || 'eq'
      const valueTo = operator === 'between' ? filter.valueTo : undefined

      if (
        filter.tagSlot === tagDefinition.tagSlot &&
        filter.fieldType === fieldType &&
        filter.operator === operator &&
        filter.valueTo === valueTo
      ) {
        return filter
      }

      changed = true
      return {
        ...filter,
        tagSlot: tagDefinition.tagSlot,
        fieldType,
        operator,
        valueTo,
      }
    })

    if (changed) {
      setStoreValue(JSON.stringify(normalizedFilters))
    }
  }, [isReadOnly, parsedFilters, setStoreValue, tagDefinitions, usesTagIds])

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

        if (field === 'tagId') {
          const tagDef = tagDefinitions.find((t) => t.id === value)
          updated.tagSlot = tagDef?.tagSlot
          if (tagDef && f.tagId !== value) {
            updated.fieldType = tagDef.fieldType as FilterFieldType
            const operators = getOperatorsForFieldType(updated.fieldType)
            updated.operator = operators[0]?.value || 'eq'
            updated.tagValue = ''
            updated.valueTo = undefined
          }
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
    const appliedFilters = filters.filter(
      (f) => (usesTagIds ? f.tagId?.trim() : f.tagName.trim()) && f.tagValue.trim()
    ).length

    return (
      <div className='space-y-1'>
        <Label className='text-muted-foreground text-xs'>Tag Filters</Label>
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
      role='button'
      tabIndex={0}
      className='flex cursor-pointer items-center justify-between rounded-t-[4px] bg-[var(--surface-4)] px-2.5 py-[5px]'
      onClick={() => toggleCollapse(filter.id)}
      onKeyDown={(event) => {
        if (event.target !== event.currentTarget) return
        handleKeyboardActivation(event, () => toggleCollapse(filter.id))
      }}
    >
      <div className='flex min-w-0 flex-1 items-center gap-2'>
        <span className='block truncate text-[var(--text-tertiary)] text-sm'>
          {filter.collapsed
            ? usesTagIds
              ? tagDefinitions.find((tag) => tag.id === filter.tagId)?.displayName ||
                filter.tagId ||
                `Filter ${index + 1}`
              : filter.tagName || `Filter ${index + 1}`
            : `Filter ${index + 1}`}
        </span>
        {filter.collapsed && (usesTagIds ? filter.tagId : filter.tagName) && (
          <Badge variant='type' size='sm'>
            {FIELD_TYPE_LABELS[getEffectiveFieldType(filter)] || 'Text'}
          </Badge>
        )}
      </div>
      <div className='flex items-center gap-2 pl-2'>
        <Button
          variant='ghost'
          onClick={(e) => {
            e.stopPropagation()
            addFilter()
          }}
          disabled={isReadOnly}
          className='h-auto p-0'
        >
          <Plus className='size-[14px]' />
          <span className='sr-only'>Add Filter</span>
        </Button>
        <Button
          variant='ghost'
          onClick={(e) => {
            e.stopPropagation()
            removeFilter(filter.id)
          }}
          disabled={isReadOnly}
          className='h-auto p-0 text-[var(--text-error)] hover-hover:text-[var(--text-error)]'
        >
          <Trash className='size-[14px]' />
          <span className='sr-only'>Delete Filter</span>
        </Button>
      </div>
    </div>
  )

  /**
   * Renders the value input with tag dropdown support
   */
  const renderConnectedInput = (
    filter: TagFilter,
    field: 'tagId' | 'tagValue' | 'valueTo',
    placeholder: string
  ) => {
    const fieldValue =
      field === 'tagId'
        ? filter.tagId || ''
        : field === 'tagValue'
          ? filter.tagValue
          : filter.valueTo || ''
    const cellKey = `${filter.id}-${field}`
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
      (newValue) => {
        if (field === 'tagId') {
          const updatedFilters = filters.map((candidate) =>
            candidate.id === filter.id
              ? {
                  ...candidate,
                  tagId: newValue,
                  tagSlot: undefined,
                }
              : candidate
          )
          emitTagSelection(JSON.stringify(updatedFilters))
          return
        }
        handleTagDropdownSelection(filter.id, field, newValue)
      }
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
          className='allow-scroll w-full overflow-auto text-transparent caret-foreground [letter-spacing:inherit]'
        />
        <div
          ref={(el) => {
            if (el) overlayRefs.current[cellKey] = el
          }}
          className={cn(
            'absolute inset-0 flex items-center overflow-x-auto bg-transparent px-2 py-1.5 font-sans text-sm',
            !isReadOnly && 'pointer-events-none'
          )}
        >
          <div className='w-full whitespace-pre' style={{ minWidth: 'fit-content' }}>
            {formatDisplayText(
              fieldValue,
              accessiblePrefixes
                ? { accessiblePrefixes, workflowSearchHighlight }
                : { highlightAll: true, workflowSearchHighlight }
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

  const renderValueInput = (
    filter: TagFilter,
    field: 'tagValue' | 'valueTo',
    fieldType: FilterFieldType
  ) => renderConnectedInput(filter, field, getPlaceholderForFieldType(fieldType))

  /**
   * Renders the filter content (tag, operator, value inputs)
   */
  const renderFilterContent = (filter: TagFilter) => {
    const tagOptions: ComboboxOption[] = tagDefinitions.map((tag) => ({
      value: tag.displayName,
      label: tag.displayName,
    }))

    const resolvedTagDefinition = getResolvedTagDefinition(filter)
    const effectiveFieldType = getEffectiveFieldType(filter)
    const operators =
      usesTagIds && !resolvedTagDefinition
        ? ALL_OPERATOR_OPTIONS
        : getOperatorsForFieldType(effectiveFieldType)
    const operatorOptions: ComboboxOption[] = operators.map((op) => ({
      value: op.value,
      label: op.label,
    }))

    const isBetween = filter.operator === 'between'

    return (
      <div className='flex flex-col gap-2 rounded-b-[4px] border-[var(--border-1)] border-t bg-[var(--surface-2)] px-2.5 pt-1.5 pb-2.5'>
        <div className='flex flex-col gap-1.5'>
          <Label className='text-small'>{usesTagIds ? 'Tag ID' : 'Tag'}</Label>
          {usesTagIds ? (
            renderConnectedInput(filter, 'tagId', 'Enter tag ID')
          ) : (
            <Combobox
              options={tagOptions}
              value={filter.tagName}
              onChange={(value) => updateFilter(filter.id, 'tagName', value)}
              disabled={isReadOnly || isLoading}
              placeholder='Select tag'
            />
          )}
        </div>

        <div className='flex flex-col gap-1.5'>
          <Label className='text-small'>Operator</Label>
          <Combobox
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
              <div className='flex-1'>
                {renderValueInput(filter, 'tagValue', effectiveFieldType)}
              </div>
              <span className='flex-shrink-0 text-muted-foreground text-xs'>to</span>
              <div className='flex-1'>
                {renderValueInput(filter, 'valueTo', effectiveFieldType)}
              </div>
            </div>
          ) : (
            renderValueInput(filter, 'tagValue', effectiveFieldType)
          )}
        </div>
      </div>
    )
  }

  return (
    <div className='space-y-2'>
      {filters.map((filter, index) => (
        <div
          key={filter.id}
          data-filter-id={filter.id}
          className={cn(
            'rounded-sm border border-[var(--border-1)]',
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
