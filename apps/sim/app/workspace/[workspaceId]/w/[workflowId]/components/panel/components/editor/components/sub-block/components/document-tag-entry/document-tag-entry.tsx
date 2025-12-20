'use client'

import { useMemo, useRef, useState } from 'react'
import { Plus } from 'lucide-react'
import {
  Button,
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
    tagSlot?: string
    fieldType: string
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

  // State for tag name dropdown visibility - one for each row
  const [dropdownStates, setDropdownStates] = useState<Record<number, boolean>>({})

  // Use preview value when in preview mode, otherwise use store value
  const currentValue = isPreview ? previewValue : storeValue

  // Transform stored JSON string to table format for display
  const rows = useMemo(() => {
    if (currentValue) {
      try {
        const tagData = JSON.parse(currentValue)
        if (Array.isArray(tagData) && tagData.length > 0) {
          return tagData.map((tag: any, index: number) => ({
            id: tag.id || `tag-${index}`,
            cells: {
              tagName: tag.tagName || '',
              tagSlot: tag.tagSlot,
              fieldType: tag.fieldType || 'text',
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
        cells: { tagName: '', tagSlot: undefined, fieldType: 'text', value: '' },
      },
    ]
  }, [currentValue])

  // Get tag names already used in rows (case-insensitive)
  const usedTagNames = useMemo(() => {
    return new Set(
      rows.map((row) => row.cells.tagName?.toLowerCase()).filter((name) => name?.trim())
    )
  }, [rows])

  // Filter available tags (exclude already used ones)
  const availableTagDefinitions = useMemo(() => {
    return tagDefinitions.filter((def) => !usedTagNames.has(def.displayName.toLowerCase()))
  }, [tagDefinitions, usedTagNames])

  // Can add more tags if there are available tag definitions
  const canAddMoreTags = availableTagDefinitions.length > 0

  // Shared helper function for updating rows and generating JSON
  const updateRowsAndGenerateJson = (
    rowIndex: number,
    column: string,
    value: string,
    tagDef?: { tagSlot: string; fieldType: string }
  ) => {
    const updatedRows = [...rows].map((row, idx) => {
      if (idx === rowIndex) {
        const newCells = { ...row.cells, [column]: value }

        // When selecting a tag, also set the tagSlot and fieldType
        if (column === 'tagName' && tagDef) {
          newCells.tagSlot = tagDef.tagSlot
          newCells.fieldType = tagDef.fieldType
          // Clear value when tag changes
          if (row.cells.tagName !== value) {
            newCells.value = ''
          }
        }

        return { ...row, cells: newCells }
      }
      return row
    })

    const dataToStore = updatedRows.map((row) => ({
      id: row.id,
      tagName: row.cells.tagName || '',
      tagSlot: row.cells.tagSlot,
      fieldType: row.cells.fieldType || 'text',
      value: row.cells.value || '',
    }))

    return dataToStore.length > 0 ? JSON.stringify(dataToStore) : ''
  }

  const handleTagSelection = (rowIndex: number, tagName: string) => {
    if (isPreview || disabled) return

    const tagDef = tagDefinitions.find((def) => def.displayName === tagName)
    const jsonString = updateRowsAndGenerateJson(rowIndex, 'tagName', tagName, tagDef)
    setStoreValue(jsonString)
  }

  const handleValueChange = (rowIndex: number, value: string) => {
    if (isPreview || disabled) return

    const jsonString = updateRowsAndGenerateJson(rowIndex, 'value', value)
    setStoreValue(jsonString)
  }

  const handleTagDropdownSelection = (rowIndex: number, value: string) => {
    if (isPreview || disabled) return

    const jsonString = updateRowsAndGenerateJson(rowIndex, 'value', value)
    emitTagSelection(jsonString)
  }

  const handleAddRow = () => {
    if (isPreview || disabled || !canAddMoreTags) return

    const currentData = currentValue ? JSON.parse(currentValue) : []
    const newRowId = `tag-${currentData.length}-${Math.random().toString(36).slice(2, 11)}`
    const newData = [...currentData, { id: newRowId, tagName: '', fieldType: 'text', value: '' }]
    setStoreValue(JSON.stringify(newData))
  }

  const handleDeleteRow = (rowIndex: number) => {
    if (isPreview || disabled || rows.length <= 1) return

    const updatedRows = rows.filter((_, idx) => idx !== rowIndex)
    const tableDataForStorage = updatedRows.map((row) => ({
      id: row.id,
      tagName: row.cells.tagName || '',
      tagSlot: row.cells.tagSlot,
      fieldType: row.cells.fieldType || 'text',
      value: row.cells.value || '',
    }))

    const jsonString = tableDataForStorage.length > 0 ? JSON.stringify(tableDataForStorage) : ''
    setStoreValue(jsonString)
  }

  if (isPreview) {
    const tagCount = rows.filter((r) => r.cells.tagName?.trim()).length
    return (
      <div className='space-y-1'>
        <Label className='font-medium text-muted-foreground text-xs'>Document Tags</Label>
        <div className='text-muted-foreground text-sm'>
          {tagCount > 0 ? `${tagCount} tag(s) configured` : 'No tags'}
        </div>
      </div>
    )
  }

  if (isLoading) {
    return <div className='p-4 text-muted-foreground text-sm'>Loading tag definitions...</div>
  }

  if (tagDefinitions.length === 0) {
    return (
      <div className='rounded-md border p-4 text-center text-muted-foreground text-sm'>
        No tags defined for this knowledge base.
        <br />
        Define tags at the knowledge base level first.
      </div>
    )
  }

  const renderHeader = () => (
    <thead>
      <tr className='border-b'>
        <th className='w-2/5 border-r px-4 py-2 text-center font-medium text-sm'>Tag</th>
        <th className='border-r px-4 py-2 text-center font-medium text-sm'>Value</th>
        <th className='w-10' />
      </tr>
    </thead>
  )

  const renderTagNameCell = (row: DocumentTagRow, rowIndex: number) => {
    const cellValue = row.cells.tagName || ''
    const isOpen = dropdownStates[rowIndex] || false

    const setIsOpen = (open: boolean) => {
      setDropdownStates((prev) => ({ ...prev, [rowIndex]: open }))
    }

    // Show tags that are either available OR currently selected for this row
    const selectableTags = tagDefinitions.filter(
      (def) => def.displayName === cellValue || !usedTagNames.has(def.displayName.toLowerCase())
    )

    return (
      <td className='relative border-r p-1'>
        <Popover open={isOpen} onOpenChange={setIsOpen}>
          <PopoverAnchor asChild>
            <div
              className='relative w-full cursor-pointer'
              onClick={() => !disabled && setIsOpen(true)}
            >
              <Input
                value={cellValue}
                readOnly
                disabled={disabled}
                autoComplete='off'
                placeholder='Select tag'
                className='w-full cursor-pointer border-0 text-transparent caret-foreground placeholder:text-muted-foreground/50 focus-visible:ring-0 focus-visible:ring-offset-0'
              />
              <div className='pointer-events-none absolute inset-0 flex items-center overflow-hidden bg-transparent px-[8px] font-medium font-sans text-sm'>
                <span className='truncate'>
                  {cellValue || <span className='text-muted-foreground/50'>Select tag</span>}
                </span>
              </div>
            </div>
          </PopoverAnchor>
          {selectableTags.length > 0 && (
            <PopoverContent
              side='bottom'
              align='start'
              sideOffset={4}
              maxHeight={192}
              className='w-[200px]'
            >
              <PopoverScrollArea>
                {selectableTags.map((tagDef) => (
                  <PopoverItem
                    key={tagDef.id}
                    active={tagDef.displayName === cellValue}
                    onClick={() => {
                      handleTagSelection(rowIndex, tagDef.displayName)
                      setIsOpen(false)
                    }}
                  >
                    <span className='flex-1 truncate'>{tagDef.displayName}</span>
                    <span className='flex-shrink-0 rounded bg-muted px-1 py-0.5 text-[10px] text-muted-foreground'>
                      {FIELD_TYPE_LABELS[tagDef.fieldType] || 'Text'}
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

  const renderValueCell = (row: DocumentTagRow, rowIndex: number) => {
    const cellValue = row.cells.value || ''
    const fieldType = row.cells.fieldType || 'text'
    const cellKey = `value-${rowIndex}`
    const placeholder = getPlaceholderForFieldType(fieldType)
    const isTagSelected = !!row.cells.tagName?.trim()

    const fieldState = inputController.fieldHelpers.getFieldState(cellKey)
    const handlers = inputController.fieldHelpers.createFieldHandlers(
      cellKey,
      cellValue,
      (newValue) => handleValueChange(rowIndex, newValue)
    )
    const tagSelectHandler = inputController.fieldHelpers.createTagSelectHandler(
      cellKey,
      cellValue,
      (newValue) => handleTagDropdownSelection(rowIndex, newValue)
    )

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
            disabled={disabled || !isTagSelected}
            autoComplete='off'
            placeholder={isTagSelected ? placeholder : 'Select a tag first'}
            className='w-full border-0 text-transparent caret-foreground placeholder:text-muted-foreground/50 focus-visible:ring-0 focus-visible:ring-offset-0'
          />
          <div className='pointer-events-none absolute inset-0 flex items-center overflow-hidden bg-transparent px-[8px] font-medium font-sans text-sm'>
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
