'use client'

import { useMemo, useRef, useState } from 'react'
import { Plus } from 'lucide-react'
import {
  Button,
  Input,
  Popover,
  PopoverAnchor,
  PopoverContent,
  PopoverItem,
  PopoverScrollArea,
  Trash,
} from '@/components/emcn'
import { cn } from '@/lib/core/utils/cn'
import {
  FIELD_TYPE_LABELS,
  getPlaceholderForFieldType,
  SUPPORTED_FIELD_TYPES,
  TAG_SLOT_CONFIG,
} from '@/lib/knowledge/constants'
import { formatDisplayText } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/editor/components/sub-block/components/formatted-text'
import { TagDropdown } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/editor/components/sub-block/components/tag-dropdown/tag-dropdown'
import { useSubBlockInput } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/editor/components/sub-block/hooks/use-sub-block-input'
import { useSubBlockValue } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/editor/components/sub-block/hooks/use-sub-block-value'
import { useAccessibleReferencePrefixes } from '@/app/workspace/[workspaceId]/w/[workflowId]/hooks/use-accessible-reference-prefixes'
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
}

export function DocumentTagEntry({
  blockId,
  subBlock,
  disabled = false,
  isPreview = false,
  previewValue,
}: DocumentTagEntryProps) {
  const [storeValue, setStoreValue] = useSubBlockValue<string>(blockId, subBlock.id)
  const accessiblePrefixes = useAccessibleReferencePrefixes(blockId)
  const valueInputRefs = useRef<Record<number, HTMLInputElement>>({})

  // Use the extended hook for field-level management
  const inputController = useSubBlockInput({
    blockId,
    subBlockId: subBlock.id,
    config: {
      id: subBlock.id,
      type: 'document-tag-entry',
      connectionDroppable: true,
    },
    isPreview,
    disabled,
  })

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

  // Calculate used slots per field type (from existing KB definitions + new tags in form)
  const usedSlotsByType = useMemo(() => {
    const counts: Record<string, number> = {
      text: 0,
      number: 0,
      date: 0,
      boolean: 0,
    }

    // Count existing tag definitions
    for (const def of tagDefinitions) {
      const type = def.fieldType || 'text'
      if (type in counts) {
        counts[type]++
      }
    }

    // Count new tags being created in the form (not yet saved as definitions)
    for (const row of rows) {
      if (row.cells.tagName?.trim()) {
        const isExistingTag = tagDefinitions.some(
          (def) => def.displayName.toLowerCase() === row.cells.tagName.toLowerCase()
        )
        if (!isExistingTag) {
          const type = row.cells.type || 'text'
          if (type in counts) {
            counts[type]++
          }
        }
      }
    }

    return counts
  }, [tagDefinitions, rows])

  // Check which field types have available slots
  const availableTypeSlots = useMemo(() => {
    const available: Record<string, number> = {}
    for (const [type, config] of Object.entries(TAG_SLOT_CONFIG)) {
      available[type] = config.maxSlots - (usedSlotsByType[type] || 0)
    }
    return available
  }, [usedSlotsByType])

  // Can add more tags if at least one type has available slots
  const canAddMoreTags = Object.values(availableTypeSlots).some((slots) => slots > 0)

  // Get the first type with available slots (for new rows)
  const getDefaultTypeForNewRow = () => {
    for (const type of SUPPORTED_FIELD_TYPES) {
      if ((availableTypeSlots[type] || 0) > 0) {
        return type
      }
    }
    return 'text' // Fallback, shouldn't happen if canAddMoreTags is true
  }

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
            // Clear value when tag type changes
            if (row.cells.type !== tagDef.fieldType) {
              newCells.value = ''
            }
          } else {
            // New tag - check if current type has available slots
            // If not, auto-switch to first available type
            const currentType = newCells.type || 'text'
            if ((availableTypeSlots[currentType] || 0) <= 0) {
              const newType = getDefaultTypeForNewRow()
              if (newType !== currentType) {
                newCells.type = newType
                newCells.value = ''
              }
            }
          }
        }

        // Clear value when type changes (e.g., switching from boolean to text)
        if (column === 'type' && row.cells.type !== value) {
          newCells.value = ''
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

    // Get current data and add a new empty row with first available type
    const currentData = currentValue ? JSON.parse(currentValue) : []
    const newRowId = `tag-${currentData.length}-${Math.random().toString(36).substr(2, 9)}`
    const defaultType = getDefaultTypeForNewRow()
    const newData = [
      ...currentData,
      { id: newRowId, tagName: '', fieldType: defaultType, value: '' },
    ]
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
        <th className='border-r px-4 py-2 text-center font-medium text-sm'>Value</th>
        <th className='w-10' />
      </tr>
    </thead>
  )

  const renderTagNameCell = (row: DocumentTagRow, rowIndex: number) => {
    const cellValue = row.cells.tagName || ''
    const isDuplicate = getDuplicateStatus(rowIndex, cellValue)
    const isOpen = dropdownStates[rowIndex] || false

    const setIsOpen = (open: boolean) => {
      setDropdownStates((prev) => ({ ...prev, [rowIndex]: open }))
    }

    const filteredTags = availableTagDefinitions.filter((tagDef) =>
      tagDef.displayName.toLowerCase().includes(cellValue.toLowerCase())
    )

    return (
      <td className='relative border-r p-1'>
        <Popover open={isOpen} onOpenChange={setIsOpen}>
          <PopoverAnchor asChild>
            <div className='relative w-full'>
              <Input
                value={cellValue}
                onChange={(e) => handleCellChange(rowIndex, 'tagName', e.target.value)}
                onFocus={() => !disabled && setIsOpen(true)}
                disabled={disabled}
                autoComplete='off'
                className={cn(
                  'w-full border-0 text-transparent caret-foreground placeholder:text-muted-foreground/50 focus-visible:ring-0 focus-visible:ring-offset-0',
                  isDuplicate && 'border-red-500 bg-red-50'
                )}
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
          </PopoverAnchor>
          {filteredTags.length > 0 && (
            <PopoverContent
              side='bottom'
              align='start'
              sideOffset={4}
              maxHeight={192}
              className='w-[200px]'
            >
              <PopoverScrollArea>
                {filteredTags.map((tagDef) => (
                  <PopoverItem
                    key={tagDef.id}
                    onClick={() => {
                      handleCellChange(rowIndex, 'tagName', tagDef.displayName)
                      setIsOpen(false)
                    }}
                  >
                    <span className='flex-1 truncate'>{tagDef.displayName}</span>
                  </PopoverItem>
                ))}
              </PopoverScrollArea>
            </PopoverContent>
          )}
        </Popover>
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

    const isOpen = typeDropdownStates[rowIndex] || false

    const setIsOpen = (open: boolean) => {
      setTypeDropdownStates((prev) => ({ ...prev, [rowIndex]: open }))
    }

    // Check if this row is a new tag (counts against the slot limit)
    const isNewTag =
      tagName.trim() &&
      !tagDefinitions.some((def) => def.displayName.toLowerCase() === tagName.toLowerCase())

    // Filter type options - disable types with no available slots
    // Exception: if this row already has a type selected (for a new tag), that type should remain available
    const typeOptions = SUPPORTED_FIELD_TYPES.map((type) => {
      const availableSlots = availableTypeSlots[type] || 0
      // Type is disabled if no slots AND it's not the currently selected type for this new tag
      const isCurrentTypeForNewTag = isNewTag && cellValue === type
      const isDisabled = availableSlots <= 0 && !isCurrentTypeForNewTag

      return {
        value: type,
        label: FIELD_TYPE_LABELS[type] || type,
        disabled: isDisabled,
      }
    })

    return (
      <td className='border-r p-1'>
        <Popover open={isOpen} onOpenChange={setIsOpen}>
          <PopoverAnchor asChild>
            <div
              className='relative w-full cursor-pointer'
              onClick={() => !disabled && !isReadOnly && setIsOpen(true)}
            >
              <Input
                value={cellValue}
                readOnly
                disabled={disabled || isReadOnly}
                autoComplete='off'
                className='w-full cursor-pointer border-0 text-transparent caret-foreground placeholder:text-muted-foreground/50 focus-visible:ring-0 focus-visible:ring-offset-0'
              />
              <div className='pointer-events-none absolute inset-0 flex items-center overflow-hidden bg-transparent px-3 text-sm'>
                <div className='whitespace-pre text-muted-foreground'>
                  {FIELD_TYPE_LABELS[cellValue] || cellValue}
                </div>
              </div>
            </div>
          </PopoverAnchor>
          {!isReadOnly && (
            <PopoverContent
              side='bottom'
              align='start'
              sideOffset={4}
              maxHeight={192}
              className='w-[120px]'
            >
              <PopoverScrollArea>
                {typeOptions
                  .filter((option) => !option.disabled)
                  .map((option) => (
                    <PopoverItem
                      key={option.value}
                      active={option.value === cellValue}
                      onClick={() => {
                        handleCellChange(rowIndex, 'type', option.value)
                        setIsOpen(false)
                      }}
                    >
                      <span className='flex-1 truncate'>{option.label}</span>
                    </PopoverItem>
                  ))}
              </PopoverScrollArea>
            </PopoverContent>
          )}
        </Popover>
      </td>
    )
  }

  const renderValueCell = (row: DocumentTagRow, rowIndex: number) => {
    const cellValue = row.cells.value || ''
    const fieldType = row.cells.type || 'text'
    const cellKey = `value-${rowIndex}`
    const placeholder = getPlaceholderForFieldType(fieldType)

    const fieldState = inputController.fieldHelpers.getFieldState(cellKey)
    const handlers = inputController.fieldHelpers.createFieldHandlers(
      cellKey,
      cellValue,
      (newValue) => handleCellChange(rowIndex, 'value', newValue)
    )
    const tagSelectHandler = inputController.fieldHelpers.createTagSelectHandler(
      cellKey,
      cellValue,
      (newValue) => handleTagDropdownSelection(rowIndex, 'value', newValue)
    )

    // Unified text input for all field types with tag dropdown support
    return (
      <td className='p-1'>
        <div className='relative w-full'>
          <Input
            ref={(el) => {
              if (el) valueInputRefs.current[rowIndex] = el
            }}
            value={cellValue}
            onChange={handlers.onChange}
            onKeyDown={handlers.onKeyDown}
            onDrop={handlers.onDrop}
            onDragOver={handlers.onDragOver}
            disabled={disabled}
            autoComplete='off'
            placeholder={placeholder}
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
          {fieldState.showTags && (
            <TagDropdown
              visible={fieldState.showTags}
              onSelect={tagSelectHandler}
              blockId={blockId}
              activeSourceBlockId={fieldState.activeSourceBlockId}
              inputValue={cellValue}
              cursorPosition={fieldState.cursorPosition}
              onClose={() => inputController.fieldHelpers.hideFieldDropdowns(cellKey)}
              inputRef={
                {
                  current: valueInputRefs.current[rowIndex] || null,
                } as React.RefObject<HTMLInputElement>
              }
            />
          )}
        </div>
      </td>
    )
  }

  const renderDeleteButton = (rowIndex: number) => {
    // Allow deletion of any row
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
          <Button variant='outline' className='h-7 px-2 text-xs' onClick={handlePreFillTags}>
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

      {/* Add Row Button */}
      {!isPreview && !disabled && (
        <div className='mt-3'>
          <Button
            variant='outline'
            onClick={handleAddRow}
            disabled={!canAddMoreTags}
            className='h-7 px-2 text-xs'
          >
            <Plus className='mr-1 h-2.5 w-2.5' />
            Add Tag
          </Button>
        </div>
      )}
    </div>
  )
}
