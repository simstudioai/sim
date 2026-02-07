'use client'

import { useMemo, useRef } from 'react'
import { Plus } from 'lucide-react'
import {
  Badge,
  Button,
  Combobox,
  type ComboboxOption,
  Input,
  Label,
  Trash,
} from '@/components/emcn'
import { cn } from '@/lib/core/utils/cn'
import { FIELD_TYPE_LABELS, getPlaceholderForFieldType } from '@/lib/knowledge/constants'
import { formatDisplayText } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/editor/components/sub-block/components/formatted-text'
import { TagDropdown } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/editor/components/sub-block/components/tag-dropdown/tag-dropdown'
import { useSubBlockInput } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/editor/components/sub-block/hooks/use-sub-block-input'
import { useSubBlockValue } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/editor/components/sub-block/hooks/use-sub-block-value'
import { resolvePreviewContextValue } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/editor/components/sub-block/utils'
import { useAccessibleReferencePrefixes } from '@/app/workspace/[workspaceId]/w/[workflowId]/hooks/use-accessible-reference-prefixes'
import type { SubBlockConfig } from '@/blocks/types'
import { useKnowledgeBaseTagDefinitions } from '@/hooks/kb/use-knowledge-base-tag-definitions'
import { useTagSelection } from '@/hooks/kb/use-tag-selection'

interface DocumentTag {
  id: string
  tagName: string
  tagSlot?: string
  fieldType: string
  value: string
  collapsed?: boolean
}

interface DocumentTagEntryProps {
  blockId: string
  subBlock: SubBlockConfig
  disabled?: boolean
  isPreview?: boolean
  previewValue?: any
  previewContextValues?: Record<string, unknown>
}

/**
 * Creates a new document tag with default values
 */
const createDefaultTag = (): DocumentTag => ({
  id: crypto.randomUUID(),
  tagName: '',
  fieldType: 'text',
  value: '',
  collapsed: false,
})

export function DocumentTagEntry({
  blockId,
  subBlock,
  disabled = false,
  isPreview = false,
  previewValue,
  previewContextValues,
}: DocumentTagEntryProps) {
  const [storeValue, setStoreValue] = useSubBlockValue<string>(blockId, subBlock.id)
  const accessiblePrefixes = useAccessibleReferencePrefixes(blockId)
  const valueInputRefs = useRef<Record<string, HTMLInputElement>>({})
  const overlayRefs = useRef<Record<string, HTMLDivElement>>({})

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

  const [knowledgeBaseIdFromStore] = useSubBlockValue(blockId, 'knowledgeBaseId')
  const knowledgeBaseIdValue = previewContextValues
    ? resolvePreviewContextValue(previewContextValues.knowledgeBaseId)
    : knowledgeBaseIdFromStore
  const knowledgeBaseId =
    typeof knowledgeBaseIdValue === 'string' && knowledgeBaseIdValue.trim().length > 0
      ? knowledgeBaseIdValue
      : null

  const { tagDefinitions, isLoading } = useKnowledgeBaseTagDefinitions(knowledgeBaseId)
  const emitTagSelection = useTagSelection(blockId, subBlock.id)

  const currentValue = isPreview ? previewValue : storeValue

  const parseTags = (tagValue: string | null): DocumentTag[] => {
    if (!tagValue) return []
    try {
      const parsed = JSON.parse(tagValue)
      if (!Array.isArray(parsed)) return []
      return parsed.map((t: DocumentTag) => ({
        ...t,
        fieldType: t.fieldType || 'text',
        collapsed: t.collapsed ?? false,
      }))
    } catch {
      return []
    }
  }

  const parsedTags = parseTags(currentValue || null)
  const tags: DocumentTag[] = parsedTags.length > 0 ? parsedTags : [createDefaultTag()]
  const isReadOnly = isPreview || disabled

  // Get tag names already used (case-insensitive)
  const usedTagNames = useMemo(() => {
    return new Set(tags.map((t) => t.tagName?.toLowerCase()).filter((name) => name?.trim()))
  }, [tags])

  // Filter available tags (exclude already used ones)
  const availableTagDefinitions = useMemo(() => {
    return tagDefinitions.filter((def) => !usedTagNames.has(def.displayName.toLowerCase()))
  }, [tagDefinitions, usedTagNames])

  const canAddMoreTags = availableTagDefinitions.length > 0

  /**
   * Updates the store with new tags
   */
  const updateTags = (newTags: DocumentTag[]) => {
    if (isReadOnly) return
    const value = newTags.length > 0 ? JSON.stringify(newTags) : ''
    setStoreValue(value)
  }

  /**
   * Adds a new tag
   */
  const addTag = () => {
    if (isReadOnly || !canAddMoreTags) return
    updateTags([...tags, createDefaultTag()])
  }

  /**
   * Removes a tag by ID, or resets it if it's the last one
   */
  const removeTag = (id: string) => {
    if (isReadOnly) return
    if (tags.length === 1) {
      // Reset the last tag instead of removing it
      updateTags([createDefaultTag()])
    } else {
      updateTags(tags.filter((t) => t.id !== id))
    }
  }

  /**
   * Updates a specific tag property
   */
  const updateTag = (id: string, field: keyof DocumentTag, value: any) => {
    if (isReadOnly) return

    const updatedTags = tags.map((t) => {
      if (t.id === id) {
        const updated = { ...t, [field]: value }

        // When tag name changes, update tagSlot and fieldType, clear value
        if (field === 'tagName') {
          const tagDef = tagDefinitions.find((def) => def.displayName === value)
          updated.tagSlot = tagDef?.tagSlot
          updated.fieldType = tagDef?.fieldType || 'text'
          if (t.tagName !== value) {
            updated.value = ''
          }
        }

        return updated
      }
      return t
    })

    updateTags(updatedTags)
  }

  /**
   * Handles tag dropdown selection for value field
   */
  const handleTagDropdownSelection = (id: string, value: string) => {
    if (isReadOnly) return

    const updatedTags = tags.map((t) => (t.id === id ? { ...t, value } : t))
    const jsonValue = updatedTags.length > 0 ? JSON.stringify(updatedTags) : ''
    emitTagSelection(jsonValue)
  }

  /**
   * Toggles the collapsed state of a tag
   */
  const toggleCollapse = (id: string) => {
    if (isReadOnly) return
    updateTags(tags.map((t) => (t.id === id ? { ...t, collapsed: !t.collapsed } : t)))
  }

  /**
   * Syncs scroll position between input and overlay
   */
  const syncOverlayScroll = (tagId: string, scrollLeft: number) => {
    const overlay = overlayRefs.current[tagId]
    if (overlay) overlay.scrollLeft = scrollLeft
  }

  if (isPreview) {
    const tagCount = tags.filter((t) => t.tagName?.trim()).length
    return (
      <div className='space-y-1'>
        <Label className='font-medium text-muted-foreground text-xs'>Document Tags</Label>
        <div className='text-muted-foreground text-sm'>
          {tagCount > 0 ? `${tagCount} tag(s) configured` : 'No tags'}
        </div>
      </div>
    )
  }

  if (!isLoading && tagDefinitions.length === 0 && knowledgeBaseId) {
    return (
      <div className='flex h-32 items-center justify-center rounded-[4px] border border-[var(--border-1)] border-dashed bg-[var(--surface-3)] dark:bg-[#1F1F1F]'>
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

  /**
   * Renders the tag header with name, badge, and action buttons
   * Shows tag name only when collapsed (as summary), generic label when expanded
   */
  const renderTagHeader = (tag: DocumentTag, index: number) => (
    <div
      className='flex cursor-pointer items-center justify-between rounded-t-[4px] bg-[var(--surface-4)] px-[10px] py-[5px]'
      onClick={() => toggleCollapse(tag.id)}
    >
      <div className='flex min-w-0 flex-1 items-center gap-[8px]'>
        <span className='block truncate font-medium text-[14px] text-[var(--text-tertiary)]'>
          {tag.collapsed ? tag.tagName || `Tag ${index + 1}` : `Tag ${index + 1}`}
        </span>
        {tag.collapsed && tag.tagName && (
          <Badge variant='type' size='sm'>
            {FIELD_TYPE_LABELS[tag.fieldType] || 'Text'}
          </Badge>
        )}
      </div>
      <div className='flex items-center gap-[8px] pl-[8px]' onClick={(e) => e.stopPropagation()}>
        <Button
          variant='ghost'
          onClick={addTag}
          disabled={isReadOnly || !canAddMoreTags}
          className='h-auto p-0'
        >
          <Plus className='h-[14px] w-[14px]' />
          <span className='sr-only'>Add Tag</span>
        </Button>
        <Button
          variant='ghost'
          onClick={() => removeTag(tag.id)}
          disabled={isReadOnly}
          className='h-auto p-0 text-[var(--text-error)] hover:text-[var(--text-error)]'
        >
          <Trash className='h-[14px] w-[14px]' />
          <span className='sr-only'>Delete Tag</span>
        </Button>
      </div>
    </div>
  )

  /**
   * Renders the value input with tag dropdown support
   */
  const renderValueInput = (tag: DocumentTag) => {
    const fieldValue = tag.value || ''
    const cellKey = `${tag.id}-value`
    const placeholder = getPlaceholderForFieldType(tag.fieldType)

    const fieldState = inputController.fieldHelpers.getFieldState(cellKey)
    const handlers = inputController.fieldHelpers.createFieldHandlers(
      cellKey,
      fieldValue,
      (newValue) => updateTag(tag.id, 'value', newValue)
    )
    const tagSelectHandler = inputController.fieldHelpers.createTagSelectHandler(
      cellKey,
      fieldValue,
      (newValue) => handleTagDropdownSelection(tag.id, newValue)
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
          className='allow-scroll w-full overflow-auto text-transparent caret-foreground'
        />
        <div
          ref={(el) => {
            if (el) overlayRefs.current[cellKey] = el
          }}
          className='pointer-events-none absolute inset-0 flex items-center overflow-x-auto bg-transparent px-[8px] py-[6px] font-medium font-sans text-sm'
        >
          <div className='w-full whitespace-pre' style={{ minWidth: 'fit-content' }}>
            {formatDisplayText(
              fieldValue,
              accessiblePrefixes ? { accessiblePrefixes } : { highlightAll: true }
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

  /**
   * Renders the tag content (tag selector and value input)
   */
  const renderTagContent = (tag: DocumentTag) => {
    // Show tags that are either available OR currently selected for this tag
    const selectableTags = tagDefinitions.filter(
      (def) => def.displayName === tag.tagName || !usedTagNames.has(def.displayName.toLowerCase())
    )

    const tagOptions: ComboboxOption[] = selectableTags.map((t) => ({
      value: t.displayName,
      label: t.displayName,
    }))

    return (
      <div className='flex flex-col gap-[8px] border-[var(--border-1)] border-t px-[10px] pt-[6px] pb-[10px]'>
        <div className='flex flex-col gap-[6px]'>
          <Label className='text-[13px]'>Tag</Label>
          <Combobox
            options={tagOptions}
            value={tag.tagName}
            onChange={(value) => updateTag(tag.id, 'tagName', value)}
            disabled={isReadOnly || isLoading}
            placeholder='Select tag'
          />
        </div>

        <div className='flex flex-col gap-[6px]'>
          <Label className='text-[13px]'>Value</Label>
          {renderValueInput(tag)}
        </div>
      </div>
    )
  }

  return (
    <div className='space-y-[8px]'>
      {tags.map((tag, index) => (
        <div
          key={tag.id}
          data-tag-id={tag.id}
          className={cn(
            'rounded-[4px] border border-[var(--border-1)]',
            tag.collapsed ? 'overflow-hidden' : 'overflow-visible'
          )}
        >
          {renderTagHeader(tag, index)}
          {!tag.collapsed && renderTagContent(tag)}
        </div>
      ))}
    </div>
  )
}
