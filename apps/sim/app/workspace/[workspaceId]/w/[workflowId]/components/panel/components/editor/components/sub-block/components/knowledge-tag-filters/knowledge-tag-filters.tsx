'use client'

import { useState } from 'react'
import { Plus } from 'lucide-react'
import { Button, Combobox, type ComboboxOption, Label, Trash } from '@/components/emcn'
import { Input } from '@/components/ui/input'
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
  const emitTagSelection = useTagSelection(blockId, subBlock.id)

  const [knowledgeBaseIdValue] = useSubBlockValue(blockId, 'knowledgeBaseId')
  const knowledgeBaseId = knowledgeBaseIdValue || null

  const { tagDefinitions, isLoading } = useKnowledgeBaseTagDefinitions(knowledgeBaseId)

  const accessiblePrefixes = useAccessibleReferencePrefixes(blockId)

  const [activeTagDropdown, setActiveTagDropdown] = useState<{
    rowIndex: number
    showTags: boolean
    cursorPosition: number
    activeSourceBlockId: string | null
    element?: HTMLElement | null
  } | null>(null)

  const parseFilters = (filterValue: string | null): TagFilter[] => {
    if (!filterValue) return []
    try {
      const parsed = JSON.parse(filterValue)
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
            cells: { tagName: '', fieldType: 'text', operator: '', value: '' },
          },
        ]

  const updateFilters = (newFilters: TagFilter[]) => {
    if (isPreview) return
    const value = newFilters.length > 0 ? JSON.stringify(newFilters) : null
    setStoreValue(value)
  }

  const rowsToFilters = (rowsToConvert: TagFilterRow[]): TagFilter[] => {
    return rowsToConvert
      .filter((row) => row.cells.tagName?.trim())
      .map((row) => ({
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

        if (column === 'fieldType') {
          const operators = getOperatorsForFieldType(value as FilterFieldType)
          newCells.operator = operators[0]?.value || 'eq'
          newCells.value = ''
          newCells.valueTo = undefined
        }

        if (column === 'operator' && value !== 'between') {
          newCells.valueTo = undefined
        }

        return { ...row, cells: newCells }
      }
      return row
    })

    updateFilters(rowsToFilters(updatedRows))
  }

  const handleTagNameSelection = (rowIndex: number, tagName: string) => {
    if (isPreview || disabled) return

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
            value: '',
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

    const newRowId = `filter-${filters.length}-${Math.random().toString(36).slice(2, 11)}`
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
    if (isPreview || disabled) return

    if (rows.length <= 1) {
      // Clear the single row instead of deleting
      setStoreValue(null)
      return
    }

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
    <thead className='bg-transparent'>
      <tr className='border-[var(--border-strong)] border-b bg-transparent'>
        <th className='w-[35%] min-w-0 border-[var(--border-strong)] border-r bg-transparent px-[10px] py-[5px] text-left font-medium text-[14px] text-[var(--text-tertiary)]'>
          Tag
        </th>
        <th className='w-[35%] min-w-0 border-[var(--border-strong)] border-r bg-transparent px-[10px] py-[5px] text-left font-medium text-[14px] text-[var(--text-tertiary)]'>
          Operator
        </th>
        <th className='w-[30%] min-w-0 bg-transparent px-[10px] py-[5px] text-left font-medium text-[14px] text-[var(--text-tertiary)]'>
          Value
        </th>
      </tr>
    </thead>
  )

  const renderTagNameCell = (row: TagFilterRow, rowIndex: number) => {
    const cellValue = row.cells.tagName || ''

    const tagOptions: ComboboxOption[] = tagDefinitions.map((tag) => ({
      value: tag.displayName,
      label: `${tag.displayName} (${FIELD_TYPE_LABELS[tag.fieldType] || 'Text'})`,
    }))

    return (
      <td className='relative min-w-0 overflow-hidden border-[var(--border-strong)] border-r bg-transparent p-0'>
        <Combobox
          options={tagOptions}
          value={cellValue}
          onChange={(value) => handleTagNameSelection(rowIndex, value)}
          disabled={disabled || isLoading}
          placeholder='Select tag'
          className='!border-0 !bg-transparent hover:!bg-transparent px-[10px] py-[8px] font-medium text-sm leading-[21px] focus-visible:ring-0 focus-visible:ring-offset-0 [&>span]:truncate'
        />
      </td>
    )
  }

  const renderOperatorCell = (row: TagFilterRow, rowIndex: number) => {
    const fieldType = row.cells.fieldType || 'text'
    const operator = row.cells.operator || ''
    const operators = getOperatorsForFieldType(fieldType)
    const isOperatorDisabled = disabled || !row.cells.tagName

    const operatorOptions: ComboboxOption[] = operators.map((op) => ({
      value: op.value,
      label: op.label,
    }))

    return (
      <td className='relative min-w-0 overflow-hidden border-[var(--border-strong)] border-r bg-transparent p-0'>
        <Combobox
          options={operatorOptions}
          value={operator}
          onChange={(value) => handleCellChange(rowIndex, 'operator', value)}
          disabled={isOperatorDisabled}
          placeholder='Select operator'
          className='!border-0 !bg-transparent hover:!bg-transparent px-[10px] py-[8px] font-medium text-sm leading-[21px] focus-visible:ring-0 focus-visible:ring-offset-0 [&>span]:truncate'
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

    const renderInput = (value: string, column: 'value' | 'valueTo') => (
      <div className='relative w-full'>
        <Input
          value={value}
          onChange={(e) => {
            const newValue = e.target.value
            const cursorPosition = e.target.selectionStart ?? 0

            handleCellChange(rowIndex, column, newValue)

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
          className='w-full border-0 bg-transparent px-[10px] py-[8px] font-medium text-sm text-transparent leading-[21px] caret-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus-visible:ring-0 focus-visible:ring-offset-0'
        />
        <div className='scrollbar-hide pointer-events-none absolute top-0 right-[10px] bottom-0 left-[10px] overflow-x-auto overflow-y-hidden bg-transparent'>
          <div className='whitespace-pre py-[8px] font-medium text-[var(--text-primary)] text-sm leading-[21px]'>
            {formatDisplayText(value || '', {
              accessiblePrefixes,
              highlightAll: !accessiblePrefixes,
            })}
          </div>
        </div>
      </div>
    )

    if (isBetween) {
      return (
        <td className='relative min-w-0 overflow-hidden bg-transparent p-0'>
          <div className='flex items-center gap-1 px-[10px]'>
            {renderInput(cellValue, 'value')}
            <span className='flex-shrink-0 text-muted-foreground text-xs'>to</span>
            {renderInput(valueTo, 'valueTo')}
          </div>
        </td>
      )
    }

    return (
      <td className='relative min-w-0 overflow-hidden bg-transparent p-0'>
        {renderInput(cellValue, 'value')}
      </td>
    )
  }

  const renderDeleteButton = (rowIndex: number) => {
    if (isPreview || disabled) return null

    return (
      <td className='w-0 p-0'>
        <Button
          variant='ghost'
          className='-translate-y-1/2 absolute top-1/2 right-[8px] transition-opacity'
          onClick={() => handleDeleteRow(rowIndex)}
        >
          <Trash className='h-[14px] w-[14px]' />
        </Button>
      </td>
    )
  }

  if (isLoading) {
    return <div className='p-4 text-muted-foreground text-sm'>Loading tag definitions...</div>
  }

  return (
    <div className='relative w-full'>
      <div className='overflow-hidden rounded-[4px] border border-[var(--border-strong)] bg-[var(--surface-2)] dark:bg-[#1F1F1F]'>
        <table className='w-full table-fixed bg-transparent'>
          {renderHeader()}
          <tbody className='bg-transparent'>
            {rows.map((row, rowIndex) => (
              <tr
                key={row.id}
                className='group relative border-[var(--border-strong)] border-t bg-transparent'
              >
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
          <Button onClick={handleAddRow} className='h-7 px-2 text-xs'>
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
