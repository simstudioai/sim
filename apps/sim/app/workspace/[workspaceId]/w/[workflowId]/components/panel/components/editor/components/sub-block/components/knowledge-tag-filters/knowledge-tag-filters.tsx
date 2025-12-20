'use client'

import { useState } from 'react'
import { Plus } from 'lucide-react'
import {
  Button,
  Combobox,
  type ComboboxOption,
  Input,
  Label,
  Popover,
  PopoverAnchor,
  PopoverContent,
  PopoverItem,
  PopoverScrollArea,
  Trash,
} from '@/components/emcn'
import { FIELD_TYPE_LABELS, getPlaceholderForFieldType } from '@/lib/knowledge/constants'
import { type FilterFieldType, getOperatorsForFieldType } from '@/lib/knowledge/filters/types'
import { formatDisplayText } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/editor/components/sub-block/components/formatted-text'
import {
  checkTagTrigger,
  TagDropdown,
} from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/editor/components/sub-block/components/tag-dropdown/tag-dropdown'
import { useAccessibleReferencePrefixes } from '@/app/workspace/[workspaceId]/w/[workflowId]/hooks/use-accessible-reference-prefixes'
import type { SubBlockConfig } from '@/blocks/types'
import { useKnowledgeBaseTagDefinitions } from '@/hooks/use-knowledge-base-tag-definitions'
import { useTagSelection } from '@/hooks/use-tag-selection'
import { useSubBlockValue } from '../../hooks/use-sub-block-value'

interface TagFilter {
  id: string
  tagName: string
  tagSlot?: string
  fieldType: FilterFieldType
  operator: string
  tagValue: string
  valueTo?: string // For 'between' operator
}

interface TagFilterRow {
  id: string
  cells: {
    tagName: string
    tagSlot?: string
    fieldType: FilterFieldType
    operator: string
    value: string
    valueTo?: string
  }
}

interface KnowledgeTagFiltersProps {
  blockId: string
  subBlock: SubBlockConfig
  disabled?: boolean
  isPreview?: boolean
  previewValue?: string | null
}

export function KnowledgeTagFilters({
  blockId,
  subBlock,
  disabled = false,
  isPreview = false,
  previewValue,
}: KnowledgeTagFiltersProps) {
  const [storeValue, setStoreValue] = useSubBlockValue<string | null>(blockId, subBlock.id)

  // Hook for immediate tag/dropdown selections
  const emitTagSelection = useTagSelection(blockId, subBlock.id)

  // Get the knowledge base ID from other sub-blocks
  const [knowledgeBaseIdValue] = useSubBlockValue(blockId, 'knowledgeBaseId')
  const knowledgeBaseId = knowledgeBaseIdValue || null

  // Use KB tag definitions hook to get available tags
  const { tagDefinitions, isLoading } = useKnowledgeBaseTagDefinitions(knowledgeBaseId)

  // Get accessible prefixes for variable highlighting
  const accessiblePrefixes = useAccessibleReferencePrefixes(blockId)

  // State for managing tag dropdown
  const [activeTagDropdown, setActiveTagDropdown] = useState<{
    rowIndex: number
    showTags: boolean
    cursorPosition: number
    activeSourceBlockId: string | null
    element?: HTMLElement | null
  } | null>(null)

  // State for dropdown visibility - one for each row
  const [dropdownStates, setDropdownStates] = useState<Record<number, boolean>>({})

  // Parse the current value to extract filters
  const parseFilters = (filterValue: string | null): TagFilter[] => {
    if (!filterValue) return []
    try {
      const parsed = JSON.parse(filterValue)
      // Handle legacy format (without fieldType/operator)
      return parsed.map((f: TagFilter) => ({
        ...f,
        fieldType: f.fieldType || 'text',
        operator: f.operator || 'eq',
      }))
    } catch {
      return []
    }
  }

  const currentValue = isPreview ? previewValue : storeValue
  const filters = parseFilters(currentValue || null)

  // Transform filters to table format for display
  const rows: TagFilterRow[] =
    filters.length > 0
      ? filters.map((filter) => ({
          id: filter.id,
          cells: {
            tagName: filter.tagName || '',
            tagSlot: filter.tagSlot,
            fieldType: filter.fieldType || 'text',
            operator: filter.operator || 'eq',
            value: filter.tagValue || '',
            valueTo: filter.valueTo,
          },
        }))
      : [
          {
            id: 'empty-row-0',
            cells: { tagName: '', fieldType: 'text', operator: 'eq', value: '' },
          },
        ]

  const updateFilters = (newFilters: TagFilter[]) => {
    if (isPreview) return
    const value = newFilters.length > 0 ? JSON.stringify(newFilters) : null
    setStoreValue(value)
  }

  /** Convert rows back to TagFilter format */
  const rowsToFilters = (rowsToConvert: TagFilterRow[]): TagFilter[] => {
    return rowsToConvert.map((row) => ({
      id: row.id,
      tagName: row.cells.tagName || '',
      tagSlot: row.cells.tagSlot,
      fieldType: row.cells.fieldType || 'text',
      operator: row.cells.operator || 'eq',
      tagValue: row.cells.value || '',
      valueTo: row.cells.valueTo,
    }))
  }

  const handleCellChange = (rowIndex: number, column: string, value: string | FilterFieldType) => {
    if (isPreview || disabled) return

    const updatedRows = [...rows].map((row, idx) => {
      if (idx === rowIndex) {
        const newCells = { ...row.cells, [column]: value }

        // Reset operator when field type changes
        if (column === 'fieldType') {
          const operators = getOperatorsForFieldType(value as FilterFieldType)
          newCells.operator = operators[0]?.value || 'eq'
          newCells.value = '' // Reset value when type changes
          newCells.valueTo = undefined
        }

        // Reset valueTo if operator is not 'between'
        if (column === 'operator' && value !== 'between') {
          newCells.valueTo = undefined
        }

        return { ...row, cells: newCells }
      }
      return row
    })

    updateFilters(rowsToFilters(updatedRows))
  }

  /** Handle tag name selection from dropdown */
  const handleTagNameSelection = (rowIndex: number, tagName: string) => {
    if (isPreview || disabled) return

    // Find the tag definition to get fieldType and tagSlot
    const tagDef = tagDefinitions.find((t) => t.displayName === tagName)
    const fieldType = (tagDef?.fieldType || 'text') as FilterFieldType
    const operators = getOperatorsForFieldType(fieldType)

    const updatedRows = [...rows].map((row, idx) => {
      if (idx === rowIndex) {
        return {
          ...row,
          cells: {
            ...row.cells,
            tagName,
            tagSlot: tagDef?.tagSlot,
            fieldType,
            operator: operators[0]?.value || 'eq',
            value: '', // Reset value when tag changes
            valueTo: undefined,
          },
        }
      }
      return row
    })

    updateFilters(rowsToFilters(updatedRows))
  }

  const handleTagDropdownSelection = (rowIndex: number, column: string, value: string) => {
    if (isPreview || disabled) return

    const updatedRows = [...rows].map((row, idx) => {
      if (idx === rowIndex) {
        return {
          ...row,
          cells: { ...row.cells, [column]: value },
        }
      }
      return row
    })

    const jsonValue =
      rowsToFilters(updatedRows).length > 0 ? JSON.stringify(rowsToFilters(updatedRows)) : null
    emitTagSelection(jsonValue)
  }

  const handleAddRow = () => {
    if (isPreview || disabled) return

    const newRowId = `filter-${filters.length}-${Math.random().toString(36).substr(2, 9)}`
    const newFilter: TagFilter = {
      id: newRowId,
      tagName: '',
      fieldType: 'text',
      operator: 'eq',
      tagValue: '',
    }
    updateFilters([...filters, newFilter])
  }

  const handleDeleteRow = (rowIndex: number) => {
    if (isPreview || disabled || rows.length <= 1) return
    const updatedRows = rows.filter((_, idx) => idx !== rowIndex)
    updateFilters(rowsToFilters(updatedRows))
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

  const renderHeader = () => (
    <thead>
      <tr className='border-b'>
        <th className='w-[35%] border-r px-2 py-2 text-center font-medium text-sm'>Tag</th>
        <th className='w-[25%] border-r px-2 py-2 text-center font-medium text-sm'>Operator</th>
        <th className='border-r px-2 py-2 text-center font-medium text-sm'>Value</th>
        <th className='w-10' />
      </tr>
    </thead>
  )

  const renderTagNameCell = (row: TagFilterRow, rowIndex: number) => {
    const cellValue = row.cells.tagName || ''
    const isOpen = dropdownStates[rowIndex] || false

    const setIsOpen = (open: boolean) => {
      setDropdownStates((prev) => ({ ...prev, [rowIndex]: open }))
    }

    return (
      <td className='relative border-r p-1'>
        <Popover open={isOpen} onOpenChange={setIsOpen}>
          <PopoverAnchor asChild>
            <div
              className='relative w-full cursor-pointer'
              onClick={() => !disabled && !isLoading && setIsOpen(true)}
            >
              <Input
                value={cellValue}
                readOnly
                disabled={disabled || isLoading}
                autoComplete='off'
                className='w-full cursor-pointer border-0 text-transparent caret-foreground placeholder:text-muted-foreground/50 focus-visible:ring-0 focus-visible:ring-offset-0'
              />
              <div className='pointer-events-none absolute inset-0 flex items-center overflow-hidden bg-transparent px-[8px] font-medium font-sans text-sm'>
                <span className='truncate'>{cellValue || 'Select tag'}</span>
              </div>
            </div>
          </PopoverAnchor>
          {tagDefinitions.length > 0 && (
            <PopoverContent
              side='bottom'
              align='start'
              sideOffset={4}
              maxHeight={192}
              className='w-[200px]'
            >
              <PopoverScrollArea>
                {tagDefinitions.map((tag) => (
                  <PopoverItem
                    key={tag.id}
                    onClick={() => {
                      handleTagNameSelection(rowIndex, tag.displayName)
                      setIsOpen(false)
                    }}
                  >
                    <span className='flex-1 truncate'>{tag.displayName}</span>
                    <span className='flex-shrink-0 rounded bg-muted px-1 py-0.5 text-[10px] text-muted-foreground'>
                      {FIELD_TYPE_LABELS[tag.fieldType] || 'Text'}
                    </span>
                  </PopoverItem>
                ))}
              </PopoverScrollArea>
            </PopoverContent>
          )}
        </Popover>
      </td>
    )
  }

  /** Render operator cell */
  const renderOperatorCell = (row: TagFilterRow, rowIndex: number) => {
    const fieldType = row.cells.fieldType || 'text'
    const operator = row.cells.operator || 'eq'
    const operators = getOperatorsForFieldType(fieldType)

    const operatorOptions: ComboboxOption[] = operators.map((op) => ({
      value: op.value,
      label: op.label,
    }))

    return (
      <td className='border-r p-1'>
        <Combobox
          options={operatorOptions}
          value={operator}
          onChange={(value) => handleCellChange(rowIndex, 'operator', value)}
          disabled={disabled || !row.cells.tagName}
          placeholder='Operator'
          size='sm'
        />
      </td>
    )
  }

  const renderValueCell = (row: TagFilterRow, rowIndex: number) => {
    const cellValue = row.cells.value || ''
    const fieldType = row.cells.fieldType || 'text'
    const operator = row.cells.operator || 'eq'
    const isBetween = operator === 'between'
    const valueTo = row.cells.valueTo || ''
    const isDisabled = disabled || !row.cells.tagName
    const placeholder = getPlaceholderForFieldType(fieldType)

    // Single text input for all field types with variable support
    const renderInput = (value: string, column: 'value' | 'valueTo') => (
      <div className='relative w-full'>
        <Input
          value={value}
          onChange={(e) => {
            const newValue = e.target.value
            const cursorPosition = e.target.selectionStart ?? 0

            handleCellChange(rowIndex, column, newValue)

            // Check for tag trigger (only for primary value input)
            if (column === 'value') {
              const tagTrigger = checkTagTrigger(newValue, cursorPosition)

              setActiveTagDropdown({
                rowIndex,
                showTags: tagTrigger.show,
                cursorPosition,
                activeSourceBlockId: null,
                element: e.target,
              })
            }
          }}
          onFocus={(e) => {
            if (!isDisabled && column === 'value') {
              setActiveTagDropdown({
                rowIndex,
                showTags: false,
                cursorPosition: 0,
                activeSourceBlockId: null,
                element: e.target,
              })
            }
          }}
          onBlur={() => {
            if (column === 'value') {
              setTimeout(() => setActiveTagDropdown(null), 200)
            }
          }}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              setActiveTagDropdown(null)
            }
          }}
          disabled={isDisabled}
          autoComplete='off'
          placeholder={placeholder}
          className='w-full border-0 text-transparent caret-foreground placeholder:text-muted-foreground/50 focus-visible:ring-0 focus-visible:ring-offset-0'
        />
        <div className='pointer-events-none absolute inset-0 flex items-center overflow-hidden bg-transparent px-[8px] font-medium font-sans text-sm'>
          <div className='whitespace-pre'>
            {formatDisplayText(value || '', {
              accessiblePrefixes,
              highlightAll: !accessiblePrefixes,
            })}
          </div>
        </div>
      </div>
    )

    // Render with optional "between" second input
    if (isBetween) {
      return (
        <td className='p-1'>
          <div className='flex items-center gap-1'>
            {renderInput(cellValue, 'value')}
            <span className='flex-shrink-0 text-muted-foreground text-xs'>to</span>
            {renderInput(valueTo, 'valueTo')}
          </div>
        </td>
      )
    }

    return <td className='p-1'>{renderInput(cellValue, 'value')}</td>
  }

  const renderDeleteButton = (rowIndex: number) => {
    const canDelete = !isPreview && !disabled

    return canDelete ? (
      <td className='w-10 p-1'>
        <Button
          variant='ghost'
          className='h-8 w-8 p-0 opacity-0 group-hover:opacity-100'
          onClick={() => handleDeleteRow(rowIndex)}
        >
          <Trash className='h-4 w-4 text-muted-foreground' />
        </Button>
      </td>
    ) : null
  }

  if (isLoading) {
    return <div className='p-4 text-muted-foreground text-sm'>Loading tag definitions...</div>
  }

  return (
    <div className='relative'>
      <div className='overflow-visible rounded-md border'>
        <table className='w-full'>
          {renderHeader()}
          <tbody>
            {rows.map((row, rowIndex) => (
              <tr key={row.id} className='group relative border-t'>
                {renderTagNameCell(row, rowIndex)}
                {renderOperatorCell(row, rowIndex)}
                {renderValueCell(row, rowIndex)}
                {renderDeleteButton(rowIndex)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Tag Dropdown */}
      {activeTagDropdown?.element && (
        <TagDropdown
          visible={activeTagDropdown.showTags}
          onSelect={(newValue) => {
            // Use immediate emission for tag dropdown selections
            handleTagDropdownSelection(activeTagDropdown.rowIndex, 'value', newValue)
            setActiveTagDropdown(null)
          }}
          blockId={blockId}
          activeSourceBlockId={activeTagDropdown.activeSourceBlockId}
          inputValue={rows[activeTagDropdown.rowIndex]?.cells.value || ''}
          cursorPosition={activeTagDropdown.cursorPosition}
          onClose={() => {
            setActiveTagDropdown((prev) => (prev ? { ...prev, showTags: false } : null))
          }}
          className='absolute z-[9999] mt-0'
        />
      )}

      {/* Add Filter Button */}
      {!isPreview && !disabled && (
        <div className='mt-3 flex items-center justify-between'>
          <Button variant='outline' onClick={handleAddRow} className='h-7 px-2 text-xs'>
            <Plus className='mr-1 h-2.5 w-2.5' />
            Add Filter
          </Button>

          {/* Filter count indicator */}
          {(() => {
            const appliedFilters = filters.filter(
              (f) => f.tagName.trim() && f.tagValue.trim()
            ).length
            return (
              <div className='text-muted-foreground text-xs'>
                {appliedFilters} filter{appliedFilters !== 1 ? 's' : ''} applied
              </div>
            )
          })()}
        </div>
      )}
    </div>
  )
}
