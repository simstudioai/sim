'use client'

import { useMemo, useState } from 'react'
import { Plus, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { formatDisplayText } from '@/components/ui/formatted-text'
import { Input } from '@/components/ui/input'
import { checkTagTrigger, TagDropdown } from '@/components/ui/tag-dropdown'
import { MAX_TAG_SLOTS } from '@/lib/constants/knowledge'
import { cn } from '@/lib/utils'
import { useSubBlockValue } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/workflow-block/components/sub-block/hooks/use-sub-block-value'
import type { SubBlockConfig } from '@/blocks/types'
import { useKnowledgeBaseTagDefinitions } from '@/hooks/use-knowledge-base-tag-definitions'
import { useTagSelection } from '@/hooks/use-tag-selection'

interface DocumentTagRow {
  id: string
  cells: {
    tagName: string
    type: string
    value: string
  }
}

interface DocumentTagEntryProps {
  blockId: string
  subBlock: SubBlockConfig
  disabled?: boolean
  isPreview?: boolean
  previewValue?: any
  isConnecting?: boolean
}

export function DocumentTagEntry({
  blockId,
  subBlock,
  disabled = false,
  isPreview = false,
  previewValue,
  isConnecting = false,
}: DocumentTagEntryProps) {
  const [storeValue, setStoreValue] = useSubBlockValue<string>(blockId, subBlock.id)

  // Get the knowledge base ID from other sub-blocks
  const [knowledgeBaseIdValue] = useSubBlockValue(blockId, 'knowledgeBaseId')
  const knowledgeBaseId = knowledgeBaseIdValue || null

  // Use KB tag definitions hook to get available tags
  const { tagDefinitions, isLoading } = useKnowledgeBaseTagDefinitions(knowledgeBaseId)

  const emitTagSelection = useTagSelection(blockId, subBlock.id)

  // State for dropdown visibility - one for each row
  const [dropdownStates, setDropdownStates] = useState<Record<number, boolean>>({})
  // State for type dropdown visibility - one for each row
  const [typeDropdownStates, setTypeDropdownStates] = useState<Record<number, boolean>>({})

  // State for managing tag dropdown
  const [activeTagDropdown, setActiveTagDropdown] = useState<{
    rowIndex: number
    showTags: boolean
    cursorPosition: number
    activeSourceBlockId: string | null
    element?: HTMLElement | null
  } | null>(null)

  // Use preview value when in preview mode, otherwise use store value
  const currentValue = isPreview ? previewValue : storeValue

  // Transform stored JSON string to table format for display
  const rows = useMemo(() => {
    // If we have stored data, use it
    if (currentValue) {
      try {
        const tagData = JSON.parse(currentValue)
        if (Array.isArray(tagData) && tagData.length > 0) {
          return tagData.map((tag: any, index: number) => ({
            id: tag.id || `tag-${index}`,
            cells: {
              tagName: tag.tagName || '',
              type: tag.fieldType || 'text',
              value: tag.value || '',
            },
          }))
        }
      } catch {
        // If parsing fails, fall through to default
      }
    }

    // Default: just one empty row
    return [
      {
        id: 'empty-row-0',
        cells: { tagName: '', type: 'text', value: '' },
      },
    ]
  }, [currentValue])

  // Get available tag names and check for case-insensitive duplicates
  const usedTagNames = new Set(
    rows.map((row) => row.cells.tagName?.toLowerCase()).filter((name) => name?.trim())
  )

  const availableTagDefinitions = tagDefinitions.filter(
    (def) => !usedTagNames.has(def.displayName.toLowerCase())
  )

  // Check if we can add more tags based on MAX_TAG_SLOTS
  const newTagsBeingCreated = rows.filter(
    (row) =>
      row.cells.tagName?.trim() &&
      !tagDefinitions.some(
        (def) => def.displayName.toLowerCase() === row.cells.tagName.toLowerCase()
      )
  ).length
  const canAddMoreTags = tagDefinitions.length + newTagsBeingCreated < MAX_TAG_SLOTS

  // Function to pre-fill existing tags
  const handlePreFillTags = () => {
    if (isPreview || disabled) return

    const existingTagRows = tagDefinitions.map((tagDef, index) => ({
      id: `prefill-${tagDef.id}-${index}`,
      tagName: tagDef.displayName,
      fieldType: tagDef.fieldType,
      value: '',
    }))

    const jsonString = existingTagRows.length > 0 ? JSON.stringify(existingTagRows) : ''
    setStoreValue(jsonString)
  }

  // Shared helper function for updating rows and generating JSON
  const updateRowsAndGenerateJson = (rowIndex: number, column: string, value: string) => {
    const updatedRows = [...rows].map((row, idx) => {
      if (idx === rowIndex) {
        const newCells = { ...row.cells, [column]: value }

        // Auto-select type when existing tag is selected
        if (column === 'tagName' && value) {
          const tagDef = tagDefinitions.find(
            (def) => def.displayName.toLowerCase() === value.toLowerCase()
          )
          if (tagDef) {
            newCells.type = tagDef.fieldType
          }
        }

        return {
          ...row,
          cells: newCells,
        }
      }
      return row
    })

    // Store all rows including empty ones - don't auto-remove
    const dataToStore = updatedRows.map((row) => ({
      id: row.id,
      tagName: row.cells.tagName || '',
      fieldType: row.cells.type || 'text',
      value: row.cells.value || '',
    }))

    return dataToStore.length > 0 ? JSON.stringify(dataToStore) : ''
  }

  const handleCellChange = (rowIndex: number, column: string, value: string) => {
    if (isPreview || disabled) return

    // Check if this is a new tag name that would exceed the limit
    if (column === 'tagName' && value.trim()) {
      const isExistingTag = tagDefinitions.some(
        (def) => def.displayName.toLowerCase() === value.toLowerCase()
      )

      if (!isExistingTag) {
        // Count current new tags being created (excluding the current row)
        const currentNewTags = rows.filter(
          (row, idx) =>
            idx !== rowIndex &&
            row.cells.tagName?.trim() &&
            !tagDefinitions.some(
              (def) => def.displayName.toLowerCase() === row.cells.tagName.toLowerCase()
            )
        ).length

        if (tagDefinitions.length + currentNewTags >= MAX_TAG_SLOTS) {
          // Don't allow creating new tags if we've reached the limit
          return
        }
      }
    }

    const jsonString = updateRowsAndGenerateJson(rowIndex, column, value)
    setStoreValue(jsonString)
  }

  const handleTagDropdownSelection = (rowIndex: number, column: string, value: string) => {
    if (isPreview || disabled) return

    const jsonString = updateRowsAndGenerateJson(rowIndex, column, value)
    emitTagSelection(jsonString)
  }

  const handleAddRow = () => {
    if (isPreview || disabled) return

    // Get current data and add a new empty row
    const currentData = currentValue ? JSON.parse(currentValue) : []
    const newRowId = `tag-${currentData.length}-${Math.random().toString(36).substr(2, 9)}`
    const newData = [...currentData, { id: newRowId, tagName: '', fieldType: 'text', value: '' }]
    setStoreValue(JSON.stringify(newData))
  }

  const handleDeleteRow = (rowIndex: number) => {
    if (isPreview || disabled || rows.length <= 1) return
    const updatedRows = rows.filter((_, idx) => idx !== rowIndex)

    // Store all remaining rows including empty ones - don't auto-remove
    const tableDataForStorage = updatedRows.map((row) => ({
      id: row.id,
      tagName: row.cells.tagName || '',
      fieldType: row.cells.type || 'text',
      value: row.cells.value || '',
    }))

    const jsonString = tableDataForStorage.length > 0 ? JSON.stringify(tableDataForStorage) : ''
    setStoreValue(jsonString)
  }

  // Check for duplicate tag names (case-insensitive)
  const getDuplicateStatus = (rowIndex: number, tagName: string) => {
    if (!tagName.trim()) return false
    const lowerTagName = tagName.toLowerCase()
    return rows.some(
      (row, idx) =>
        idx !== rowIndex &&
        row.cells.tagName?.toLowerCase() === lowerTagName &&
        row.cells.tagName.trim()
    )
  }

  if (isLoading) {
    return <div className='p-4 text-muted-foreground text-sm'>Loading tag definitions...</div>
  }

  const renderHeader = () => (
    <thead>
      <tr className='border-b'>
        <th className='w-2/5 border-r px-4 py-2 text-center font-medium text-sm'>Tag Name</th>
        <th className='w-1/5 border-r px-4 py-2 text-center font-medium text-sm'>Type</th>
        <th className='px-4 py-2 text-center font-medium text-sm'>Value</th>
      </tr>
    </thead>
  )

  const renderTagNameCell = (row: DocumentTagRow, rowIndex: number) => {
    const cellValue = row.cells.tagName || ''
    const isDuplicate = getDuplicateStatus(rowIndex, cellValue)
    const showDropdown = dropdownStates[rowIndex] || false

    const setShowDropdown = (show: boolean) => {
      setDropdownStates((prev) => ({ ...prev, [rowIndex]: show }))
    }

    const handleDropdownClick = (e: React.MouseEvent) => {
      e.preventDefault()
      e.stopPropagation()
      if (!disabled && !isConnecting) {
        if (!showDropdown) {
          setShowDropdown(true)
        }
      }
    }

    const handleFocus = () => {
      if (!disabled && !isConnecting) {
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
            onChange={(e) => handleCellChange(rowIndex, 'tagName', e.target.value)}
            onFocus={handleFocus}
            onBlur={handleBlur}
            disabled={disabled || isConnecting}
            className={cn(
              'w-full border-0 text-transparent caret-foreground placeholder:text-muted-foreground/50 focus-visible:ring-0 focus-visible:ring-offset-0',
              isDuplicate && 'border-red-500 bg-red-50'
            )}
          />
          <div className='pointer-events-none absolute inset-0 flex items-center overflow-hidden bg-transparent px-3 text-sm'>
            <div className='whitespace-pre'>{formatDisplayText(cellValue)}</div>
          </div>
          {showDropdown && availableTagDefinitions.length > 0 && (
            <div className='absolute top-full left-0 z-[100] mt-1 w-full'>
              <div className='allow-scroll fade-in-0 zoom-in-95 animate-in rounded-md border bg-popover text-popover-foreground shadow-lg'>
                <div
                  className='allow-scroll max-h-48 overflow-y-auto p-1'
                  style={{ scrollbarWidth: 'thin' }}
                >
                  {availableTagDefinitions
                    .filter((tagDef) =>
                      tagDef.displayName.toLowerCase().includes(cellValue.toLowerCase())
                    )
                    .map((tagDef) => (
                      <div
                        key={tagDef.id}
                        className='relative flex cursor-pointer select-none items-center rounded-sm px-2 py-1.5 text-sm outline-none hover:bg-accent hover:text-accent-foreground'
                        onMouseDown={(e) => {
                          e.preventDefault()
                          handleCellChange(rowIndex, 'tagName', tagDef.displayName)
                          setShowDropdown(false)
                        }}
                      >
                        <span className='flex-1 truncate'>{tagDef.displayName}</span>
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

  const renderTypeCell = (row: DocumentTagRow, rowIndex: number) => {
    const cellValue = row.cells.type || 'text'
    const tagName = row.cells.tagName || ''

    // Check if this is an existing tag (should be read-only)
    const existingTag = tagDefinitions.find(
      (def) => def.displayName.toLowerCase() === tagName.toLowerCase()
    )
    const isReadOnly = !!existingTag

    const showTypeDropdown = typeDropdownStates[rowIndex] || false

    const setShowTypeDropdown = (show: boolean) => {
      setTypeDropdownStates((prev) => ({ ...prev, [rowIndex]: show }))
    }

    const handleTypeDropdownClick = (e: React.MouseEvent) => {
      e.preventDefault()
      e.stopPropagation()
      if (!disabled && !isConnecting && !isReadOnly) {
        if (!showTypeDropdown) {
          setShowTypeDropdown(true)
        }
      }
    }

    const handleTypeFocus = () => {
      if (!disabled && !isConnecting && !isReadOnly) {
        setShowTypeDropdown(true)
      }
    }

    const handleTypeBlur = () => {
      // Delay closing to allow dropdown selection
      setTimeout(() => setShowTypeDropdown(false), 150)
    }

    const typeOptions = [{ value: 'text', label: 'Text' }]

    return (
      <td className='border-r p-1'>
        <div className='relative w-full'>
          <Input
            value={cellValue}
            readOnly
            disabled={disabled || isConnecting || isReadOnly}
            className='w-full cursor-pointer border-0 text-transparent caret-foreground placeholder:text-muted-foreground/50 focus-visible:ring-0 focus-visible:ring-offset-0'
            onClick={handleTypeDropdownClick}
            onFocus={handleTypeFocus}
            onBlur={handleTypeBlur}
          />
          <div className='pointer-events-none absolute inset-0 flex items-center overflow-hidden bg-transparent px-3 text-sm'>
            <div className='whitespace-pre text-muted-foreground'>
              {formatDisplayText(cellValue)}
            </div>
          </div>
          {showTypeDropdown && !isReadOnly && (
            <div className='absolute top-full left-0 z-[100] mt-1 w-full'>
              <div className='allow-scroll fade-in-0 zoom-in-95 animate-in rounded-md border bg-popover text-popover-foreground shadow-lg'>
                <div
                  className='allow-scroll max-h-48 overflow-y-auto p-1'
                  style={{ scrollbarWidth: 'thin' }}
                >
                  {typeOptions.map((option) => (
                    <div
                      key={option.value}
                      className='relative flex cursor-pointer select-none items-center rounded-sm px-2 py-1.5 text-sm outline-none hover:bg-accent hover:text-accent-foreground'
                      onMouseDown={(e) => {
                        e.preventDefault()
                        handleCellChange(rowIndex, 'type', option.value)
                        setShowTypeDropdown(false)
                      }}
                    >
                      <span className='flex-1 truncate'>{option.label}</span>
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

  const renderValueCell = (row: DocumentTagRow, rowIndex: number) => {
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
            <div className='whitespace-pre'>{formatDisplayText(cellValue)}</div>
          </div>
        </div>
      </td>
    )
  }

  const renderDeleteButton = (rowIndex: number) => {
    // Allow deletion of any row
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

  // Show pre-fill button if there are available tags and only empty rows
  const showPreFillButton =
    tagDefinitions.length > 0 &&
    rows.length === 1 &&
    !rows[0].cells.tagName &&
    !rows[0].cells.value &&
    !isPreview &&
    !disabled

  return (
    <div className='relative'>
      {showPreFillButton && (
        <div className='mb-2'>
          <Button variant='outline' size='sm' onClick={handlePreFillTags}>
            Prefill Existing Tags
          </Button>
        </div>
      )}
      <div className='overflow-visible rounded-md border'>
        <table className='w-full'>
          {renderHeader()}
          <tbody>
            {rows.map((row, rowIndex) => (
              <tr key={row.id} className='group relative border-t'>
                {renderTagNameCell(row, rowIndex)}
                {renderTypeCell(row, rowIndex)}
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

      {/* Add Row Button and Tag slots usage indicator */}
      {!isPreview && !disabled && (
        <div className='mt-3 flex items-center justify-between'>
          <Button
            variant='outline'
            size='sm'
            onClick={handleAddRow}
            disabled={!canAddMoreTags}
            className='h-7 px-2 text-xs'
          >
            <Plus className='mr-1 h-2.5 w-2.5' />
            Add Tag
          </Button>

          {/* Tag slots usage indicator */}
          <div className='text-muted-foreground text-xs'>
            {tagDefinitions.length + newTagsBeingCreated} of {MAX_TAG_SLOTS} tag slots used
          </div>
        </div>
      )}
    </div>
  )
}
