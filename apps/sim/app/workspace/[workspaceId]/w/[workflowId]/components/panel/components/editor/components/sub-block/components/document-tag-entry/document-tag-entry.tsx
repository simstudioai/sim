'use client'

import { useMemo, useRef } from 'react'
import { Plus } from 'lucide-react'
import { Button, Combobox, type ComboboxOption, Label, Trash } from '@/components/emcn'
import { Input } from '@/components/ui/input'
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
    if (isPreview || disabled) return

    if (rows.length <= 1) {
      // Clear the single row instead of deleting
      setStoreValue('')
      return
    }

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
      <div className='flex h-32 items-center justify-center rounded-lg border border-muted-foreground/25 bg-muted/20'>
        <div className='text-center'>
          <p className='font-medium text-[var(--text-secondary)] text-sm'>
            No tags defined for this knowledge base
          </p>
          <p className='mt-1 text-[var(--text-muted)] text-xs'>
            Define tags at the knowledge base level first
          </p>
        </div>
      </div>
    )
  }

  const renderHeader = () => (
    <thead className='bg-transparent'>
      <tr className='border-[var(--border-strong)] border-b bg-transparent'>
        <th className='w-[50%] min-w-0 border-[var(--border-strong)] border-r bg-transparent px-[10px] py-[5px] text-left font-medium text-[14px] text-[var(--text-tertiary)]'>
          Tag
        </th>
        <th className='w-[50%] min-w-0 bg-transparent px-[10px] py-[5px] text-left font-medium text-[14px] text-[var(--text-tertiary)]'>
          Value
        </th>
      </tr>
    </thead>
  )

  const renderTagNameCell = (row: DocumentTagRow, rowIndex: number) => {
    const cellValue = row.cells.tagName || ''

    // Show tags that are either available OR currently selected for this row
    const selectableTags = tagDefinitions.filter(
      (def) => def.displayName === cellValue || !usedTagNames.has(def.displayName.toLowerCase())
    )

    const tagOptions: ComboboxOption[] = selectableTags.map((tag) => ({
      value: tag.displayName,
      label: `${tag.displayName} (${FIELD_TYPE_LABELS[tag.fieldType] || 'Text'})`,
    }))

    return (
      <td className='relative min-w-0 overflow-hidden border-[var(--border-strong)] border-r bg-transparent p-0'>
        <Combobox
          options={tagOptions}
          value={cellValue}
          onChange={(value) => handleTagSelection(rowIndex, value)}
          disabled={disabled || isLoading}
          placeholder='Select tag'
          className='!border-0 !bg-transparent hover:!bg-transparent px-[10px] py-[8px] font-medium text-sm leading-[21px] focus-visible:ring-0 focus-visible:ring-offset-0 [&>span]:truncate'
        />
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
      <td className='relative min-w-0 overflow-hidden bg-transparent p-0'>
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
            className='w-full border-0 bg-transparent px-[10px] py-[8px] font-medium text-sm text-transparent leading-[21px] caret-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus-visible:ring-0 focus-visible:ring-offset-0'
          />
          <div className='scrollbar-hide pointer-events-none absolute top-0 right-[10px] bottom-0 left-[10px] overflow-x-auto overflow-y-hidden bg-transparent'>
            <div className='whitespace-pre py-[8px] font-medium text-[var(--text-primary)] text-sm leading-[21px]'>
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
                {renderValueCell(row, rowIndex)}
                {renderDeleteButton(rowIndex)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Add Tag Button */}
      {!isPreview && !disabled && (
        <div className='mt-3'>
          <Button onClick={handleAddRow} disabled={!canAddMoreTags} className='h-7 px-2 text-xs'>
            <Plus className='mr-1 h-2.5 w-2.5' />
            Add Tag
          </Button>
        </div>
      )}
    </div>
  )
}
