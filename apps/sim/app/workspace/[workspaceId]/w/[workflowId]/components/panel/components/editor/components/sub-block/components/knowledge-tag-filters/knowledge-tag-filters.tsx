'use client'

import { useMemo, useState } from 'react'
import { Plus } from 'lucide-react'
import {
  Button,
  Combobox,
  type ComboboxOption,
  Input,
  Label,
  Switch,
  Trash,
} from '@/components/emcn'
import { formatDisplayText } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/editor/components/sub-block/components/formatted-text'
import {
  checkTagTrigger,
  TagDropdown,
} from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/editor/components/sub-block/components/tag-dropdown/tag-dropdown'
import { useAccessibleReferencePrefixes } from '@/app/workspace/[workspaceId]/w/[workflowId]/hooks/use-accessible-reference-prefixes'
import type { SubBlockConfig } from '@/blocks/types'
import { useKnowledgeBaseTagDefinitions } from '@/hooks/use-knowledge-base-tag-definitions'
import { useTagSelection } from '@/hooks/use-tag-selection'
import {
  type FilterFieldType,
  getOperatorsForFieldType,
} from '@/lib/knowledge/filters/types'
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

    const jsonValue = rowsToFilters(updatedRows).length > 0 ? JSON.stringify(rowsToFilters(updatedRows)) : null
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
        <th className='px-2 py-2 text-center font-medium text-sm'>Value</th>
      </tr>
    </thead>
  )

  /** Field type labels for display */
  const FIELD_TYPE_LABELS: Record<string, string> = {
    text: 'Text',
    number: 'Number',
    date: 'Date',
    boolean: 'Boolean',
  }

  const renderTagNameCell = (row: TagFilterRow, rowIndex: number) => {
    const cellValue = row.cells.tagName || ''
    const fieldType = row.cells.fieldType || 'text'
    const showDropdown = dropdownStates[rowIndex] || false

    const setShowDropdown = (show: boolean) => {
      setDropdownStates((prev) => ({ ...prev, [rowIndex]: show }))
    }

    const handleDropdownClick = (e: React.MouseEvent) => {
      e.preventDefault()
      e.stopPropagation()
      if (!disabled && !isLoading) {
        if (!showDropdown) {
          setShowDropdown(true)
        }
      }
    }

    const handleFocus = () => {
      if (!disabled && !isLoading) {
        setShowDropdown(true)
      }
    }

    const handleBlur = () => {
      // Delay closing to allow dropdown selection
      setTimeout(() => setShowDropdown(false), 150)
    }

    return (
      <td className='relative border-r p-1'>
        <div className='relative w-full'>
          <Input
            value={cellValue}
            readOnly
            disabled={disabled || isLoading}
            autoComplete='off'
            className='w-full cursor-pointer border-0 text-transparent caret-foreground placeholder:text-muted-foreground/50 focus-visible:ring-0 focus-visible:ring-offset-0'
            onClick={handleDropdownClick}
            onFocus={handleFocus}
            onBlur={handleBlur}
          />
          <div className='pointer-events-none absolute inset-0 flex items-center gap-1.5 overflow-hidden bg-transparent px-3 text-sm'>
            <span className='truncate'>
              {cellValue || 'Select tag'}
            </span>
            {cellValue && (
              <span className='flex-shrink-0 rounded bg-muted px-1 py-0.5 text-[10px] text-muted-foreground'>
                {FIELD_TYPE_LABELS[fieldType]}
              </span>
            )}
          </div>
          {showDropdown && tagDefinitions.length > 0 && (
            <div className='absolute top-full left-0 z-[100] mt-1 w-full'>
              <div className='allow-scroll fade-in-0 zoom-in-95 animate-in rounded-md border bg-popover text-popover-foreground shadow-lg'>
                <div
                  className='allow-scroll max-h-48 overflow-y-auto p-1'
                  style={{ scrollbarWidth: 'thin' }}
                >
                  {tagDefinitions.map((tag) => (
                    <div
                      key={tag.id}
                      className='relative flex cursor-pointer select-none items-center justify-between gap-2 rounded-sm px-2 py-1.5 text-sm outline-none hover:bg-accent hover:text-accent-foreground'
                      onMouseDown={(e) => {
                        e.preventDefault()
                        handleTagNameSelection(rowIndex, tag.displayName)
                        setShowDropdown(false)
                      }}
                    >
                      <span className='flex-1 truncate'>{tag.displayName}</span>
                      <span className='flex-shrink-0 rounded bg-muted px-1 py-0.5 text-[10px] text-muted-foreground'>
                        {FIELD_TYPE_LABELS[tag.fieldType] || 'Text'}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>
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

    // Render boolean switch
    if (fieldType === 'boolean') {
      return (
        <td className='p-1'>
          <div className='flex items-center justify-center gap-2 px-2'>
            <Switch
              checked={cellValue === 'true'}
              onCheckedChange={(checked) =>
                handleCellChange(rowIndex, 'value', String(checked))
              }
              disabled={isDisabled}
            />
            <span className='text-sm text-muted-foreground'>
              {cellValue === 'true' ? 'Yes' : 'No'}
            </span>
          </div>
        </td>
      )
    }

    // Render number input
    if (fieldType === 'number') {
      return (
        <td className='p-1'>
          <div className='flex items-center gap-1'>
            <Input
              type='number'
              value={cellValue}
              onChange={(e) => handleCellChange(rowIndex, 'value', e.target.value)}
              disabled={isDisabled}
              placeholder='Value'
              className='h-8 border-0 focus-visible:ring-0 focus-visible:ring-offset-0'
            />
            {isBetween && (
              <>
                <span className='text-muted-foreground text-xs'>to</span>
                <Input
                  type='number'
                  value={valueTo}
                  onChange={(e) => handleCellChange(rowIndex, 'valueTo', e.target.value)}
                  disabled={isDisabled}
                  placeholder='Value'
                  className='h-8 border-0 focus-visible:ring-0 focus-visible:ring-offset-0'
                />
              </>
            )}
          </div>
        </td>
      )
    }

    // Render date input
    if (fieldType === 'date') {
      return (
        <td className='p-1'>
          <div className='flex items-center gap-1'>
            <Input
              type='date'
              value={cellValue ? cellValue.slice(0, 10) : ''}
              onChange={(e) => handleCellChange(rowIndex, 'value', e.target.value ? new Date(e.target.value).toISOString() : '')}
              disabled={isDisabled}
              className='h-8 border-0 focus-visible:ring-0 focus-visible:ring-offset-0'
            />
            {isBetween && (
              <>
                <span className='text-muted-foreground text-xs'>to</span>
                <Input
                  type='date'
                  value={valueTo ? valueTo.slice(0, 10) : ''}
                  onChange={(e) => handleCellChange(rowIndex, 'valueTo', e.target.value ? new Date(e.target.value).toISOString() : '')}
                  disabled={isDisabled}
                  className='h-8 border-0 focus-visible:ring-0 focus-visible:ring-offset-0'
                />
              </>
            )}
          </div>
        </td>
      )
    }

    // Render text input (default) with variable support
    return (
      <td className='p-1'>
        <div className='relative w-full'>
          <Input
            value={cellValue}
            onChange={(e) => {
              const newValue = e.target.value
              const cursorPosition = e.target.selectionStart ?? 0

              handleCellChange(rowIndex, 'value', newValue)

              // Check for tag trigger
              const tagTrigger = checkTagTrigger(newValue, cursorPosition)

              setActiveTagDropdown({
                rowIndex,
                showTags: tagTrigger.show,
                cursorPosition,
                activeSourceBlockId: null,
                element: e.target,
              })
            }}
            onFocus={(e) => {
              if (!isDisabled) {
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
              setTimeout(() => setActiveTagDropdown(null), 200)
            }}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                setActiveTagDropdown(null)
              }
            }}
            disabled={isDisabled}
            autoComplete='off'
            placeholder='Enter value'
            className='w-full border-0 text-transparent caret-foreground placeholder:text-muted-foreground/50 focus-visible:ring-0 focus-visible:ring-offset-0'
          />
          <div className='pointer-events-none absolute inset-0 flex items-center overflow-hidden bg-transparent px-3 text-sm'>
            <div className='whitespace-pre'>
              {formatDisplayText(cellValue || '', {
                accessiblePrefixes,
                highlightAll: !accessiblePrefixes,
              })}
            </div>
          </div>
        </div>
      </td>
    )
  }

  const renderDeleteButton = (rowIndex: number) => {
    const canDelete = !isPreview && !disabled

    return canDelete ? (
      <td className='w-0 p-0'>
        <Button
          variant='ghost'
          size='icon'
          className='-translate-y-1/2 absolute top-1/2 right-2 h-8 w-8 opacity-0 group-hover:opacity-100'
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
          <Button variant='outline' size='sm' onClick={handleAddRow} className='h-7 px-2 text-xs'>
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
