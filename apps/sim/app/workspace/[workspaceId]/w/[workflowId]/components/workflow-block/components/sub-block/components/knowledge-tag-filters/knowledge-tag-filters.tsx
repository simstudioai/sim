'use client'

import { useState } from 'react'
import { Plus, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { formatDisplayText } from '@/components/ui/formatted-text'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { checkTagTrigger, TagDropdown } from '@/components/ui/tag-dropdown'
import { useAccessibleReferencePrefixes } from '@/app/workspace/[workspaceId]/w/[workflowId]/hooks/use-accessible-reference-prefixes'
import type { SubBlockConfig } from '@/blocks/types'
import { useKnowledgeBaseTagDefinitions } from '@/hooks/use-knowledge-base-tag-definitions'
import { useTagSelection } from '@/hooks/use-tag-selection'
import { useSubBlockValue } from '../../hooks/use-sub-block-value'

interface TagFilter {
  id: string
  tagName: string
  tagValue: string
}

interface TagFilterRow {
  id: string
  cells: {
    tagName: string
    value: string
  }
}

interface KnowledgeTagFiltersProps {
  blockId: string
  subBlock: SubBlockConfig
  disabled?: boolean
  isPreview?: boolean
  previewValue?: string | null
  isConnecting?: boolean
}

export function KnowledgeTagFilters({
  blockId,
  subBlock,
  disabled = false,
  isPreview = false,
  previewValue,
  isConnecting = false,
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
      return JSON.parse(filterValue)
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
            value: filter.tagValue || '',
          },
        }))
      : [
          {
            id: 'empty-row-0',
            cells: { tagName: '', value: '' },
          },
        ]

  const updateFilters = (newFilters: TagFilter[]) => {
    if (isPreview) return
    const value = newFilters.length > 0 ? JSON.stringify(newFilters) : null
    setStoreValue(value)
  }

  const handleCellChange = (rowIndex: number, column: string, value: string) => {
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

    // Convert back to TagFilter format - keep all rows, even empty ones
    const updatedFilters = updatedRows.map((row) => ({
      id: row.id,
      tagName: row.cells.tagName || '',
      tagValue: row.cells.value || '',
    }))

    updateFilters(updatedFilters)
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

    // Convert back to TagFilter format - keep all rows, even empty ones
    const updatedFilters = updatedRows.map((row) => ({
      id: row.id,
      tagName: row.cells.tagName || '',
      tagValue: row.cells.value || '',
    }))

    const jsonValue = updatedFilters.length > 0 ? JSON.stringify(updatedFilters) : null
    emitTagSelection(jsonValue)
  }

  const handleAddRow = () => {
    if (isPreview || disabled) return

    const newRowId = `filter-${filters.length}-${Math.random().toString(36).substr(2, 9)}`
    const newFilters = [...filters, { id: newRowId, tagName: '', tagValue: '' }]
    updateFilters(newFilters)
  }

  const handleDeleteRow = (rowIndex: number) => {
    if (isPreview || disabled || rows.length <= 1) return
    const updatedRows = rows.filter((_, idx) => idx !== rowIndex)

    const updatedFilters = updatedRows.map((row) => ({
      id: row.id,
      tagName: row.cells.tagName || '',
      tagValue: row.cells.value || '',
    }))

    updateFilters(updatedFilters)
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
        <th className='w-2/5 border-r px-4 py-2 text-center font-medium text-sm'>Tag Name</th>
        <th className='px-4 py-2 text-center font-medium text-sm'>Value</th>
      </tr>
    </thead>
  )

  const renderTagNameCell = (row: TagFilterRow, rowIndex: number) => {
    const cellValue = row.cells.tagName || ''
    const showDropdown = dropdownStates[rowIndex] || false

    const setShowDropdown = (show: boolean) => {
      setDropdownStates((prev) => ({ ...prev, [rowIndex]: show }))
    }

    const handleDropdownClick = (e: React.MouseEvent) => {
      e.preventDefault()
      e.stopPropagation()
      if (!disabled && !isConnecting && !isLoading) {
        if (!showDropdown) {
          setShowDropdown(true)
        }
      }
    }

    const handleFocus = () => {
      if (!disabled && !isConnecting && !isLoading) {
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
            disabled={disabled || isConnecting || isLoading}
            className='w-full cursor-pointer border-0 text-transparent caret-foreground placeholder:text-muted-foreground/50 focus-visible:ring-0 focus-visible:ring-offset-0'
            onClick={handleDropdownClick}
            onFocus={handleFocus}
            onBlur={handleBlur}
          />
          <div className='pointer-events-none absolute inset-0 flex items-center overflow-hidden bg-transparent px-3 text-sm'>
            <div className='whitespace-pre'>
              {formatDisplayText(cellValue || 'Select tag', {
                accessiblePrefixes,
                highlightAll: !accessiblePrefixes,
              })}
            </div>
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
                      className='relative flex cursor-pointer select-none items-center rounded-sm px-2 py-1.5 text-sm outline-none hover:bg-accent hover:text-accent-foreground'
                      onMouseDown={(e) => {
                        e.preventDefault()
                        handleCellChange(rowIndex, 'tagName', tag.displayName)
                        setShowDropdown(false)
                      }}
                    >
                      <span className='flex-1 truncate'>{tag.displayName}</span>
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

  const renderValueCell = (row: TagFilterRow, rowIndex: number) => {
    const cellValue = row.cells.value || ''

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
              if (!disabled && !isConnecting) {
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
            disabled={disabled || isConnecting}
            className='w-full border-0 text-transparent caret-foreground placeholder:text-muted-foreground/50 focus-visible:ring-0 focus-visible:ring-offset-0'
          />
          <div className='pointer-events-none absolute inset-0 flex items-center overflow-hidden bg-transparent px-3 text-sm'>
            <div className='whitespace-pre'>
              {formatDisplayText(cellValue, {
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
          <Trash2 className='h-4 w-4 text-muted-foreground' />
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
