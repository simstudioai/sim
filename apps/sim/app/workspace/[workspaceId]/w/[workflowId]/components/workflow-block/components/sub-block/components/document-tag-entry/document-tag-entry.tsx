'use client'

import { useMemo, useState } from 'react'
import { Plus, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { MAX_TAG_SLOTS } from '@/lib/constants/knowledge'
import { cn } from '@/lib/utils'
import type { SubBlockConfig } from '@/blocks/types'
import { useKnowledgeBaseTagDefinitions } from '@/hooks/use-knowledge-base-tag-definitions'
import { useSubBlockValue } from '../../hooks/use-sub-block-value'

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

  // State for dropdown visibility - one for each row
  const [dropdownStates, setDropdownStates] = useState<Record<number, boolean>>({})

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
            id: `tag-${index}`,
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
        id: 'empty-row',
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

    const existingTagRows = tagDefinitions.map((tagDef) => ({
      tagName: tagDef.displayName,
      fieldType: tagDef.fieldType,
      value: '',
    }))

    const jsonString = existingTagRows.length > 0 ? JSON.stringify(existingTagRows) : ''
    setStoreValue(jsonString)
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

    // No auto-add rows - user will manually add them with plus button

    // Store all rows including empty ones - don't auto-remove
    const dataToStore = updatedRows.map((row) => ({
      tagName: row.cells.tagName || '',
      fieldType: row.cells.type || 'text',
      value: row.cells.value || '',
    }))

    const jsonString = dataToStore.length > 0 ? JSON.stringify(dataToStore) : ''
    setStoreValue(jsonString)
  }

  const handleAddRow = () => {
    if (isPreview || disabled) return

    // Get current data and add a new empty row
    const currentData = currentValue ? JSON.parse(currentValue) : []
    const newData = [...currentData, { tagName: '', fieldType: 'text', value: '' }]
    setStoreValue(JSON.stringify(newData))
  }

  const handleDeleteRow = (rowIndex: number) => {
    if (isPreview || disabled || rows.length <= 1) return
    const updatedRows = rows.filter((_, idx) => idx !== rowIndex)

    // Store all remaining rows including empty ones - don't auto-remove
    const tableDataForStorage = updatedRows.map((row) => ({
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
        <th className='border-r px-4 py-2 text-center font-medium text-sm'>Tag Name</th>
        <th className='border-r px-4 py-2 text-center font-medium text-sm'>Type</th>
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

    return (
      <td className='relative border-r p-1'>
        <div className='relative w-full'>
          <Input
            value={cellValue}
            onChange={(e) => handleCellChange(rowIndex, 'tagName', e.target.value)}
            onFocus={() => setShowDropdown(true)}
            onBlur={() => setTimeout(() => setShowDropdown(false), 200)}
            disabled={disabled || isConnecting}
            className={cn(isDuplicate && 'border-red-500 bg-red-50')}
          />
          {showDropdown && availableTagDefinitions.length > 0 && (
            <div className='absolute z-50 mt-1 max-h-60 w-full overflow-auto rounded-md border border-border bg-popover shadow-md'>
              {availableTagDefinitions
                .filter((tagDef) =>
                  tagDef.displayName.toLowerCase().includes(cellValue.toLowerCase())
                )
                .map((tagDef) => (
                  <div
                    key={tagDef.id}
                    className='cursor-pointer px-3 py-2 text-sm hover:bg-accent hover:text-accent-foreground'
                    onMouseDown={() => {
                      handleCellChange(rowIndex, 'tagName', tagDef.displayName)
                      setShowDropdown(false)
                    }}
                  >
                    {tagDef.displayName}
                  </div>
                ))}
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

    return (
      <td className='border-r p-1'>
        <Select
          value={cellValue}
          onValueChange={(value) => handleCellChange(rowIndex, 'type', value)}
          disabled={disabled || isConnecting || isReadOnly}
        >
          <SelectTrigger
            className={cn(
              isReadOnly && 'bg-gray-50 dark:bg-gray-800',
              'text-foreground' // Ensure proper text color in dark mode
            )}
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value='text'>Text</SelectItem>
            <SelectItem value='number'>Number</SelectItem>
            <SelectItem value='date'>Date</SelectItem>
          </SelectContent>
        </Select>
      </td>
    )
  }

  const renderValueCell = (row: DocumentTagRow, rowIndex: number) => {
    const cellValue = row.cells.value || ''

    return (
      <td className='p-1'>
        <Input
          value={cellValue}
          onChange={(e) => handleCellChange(rowIndex, 'value', e.target.value)}
          disabled={disabled || isConnecting}
        />
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

      {/* Add Row Button */}
      {!isPreview && !disabled && (
        <div className='mt-3 flex flex-col items-center gap-2'>
          <Button variant='outline' size='sm' onClick={handleAddRow} disabled={!canAddMoreTags}>
            <Plus className='mr-1 h-3 w-3' />
            Add Tag
          </Button>

          {/* Tag slots usage indicator */}
          <div className='text-center text-muted-foreground text-xs'>
            {tagDefinitions.length + newTagsBeingCreated} of {MAX_TAG_SLOTS} tag slots used
          </div>
        </div>
      )}
    </div>
  )
}
