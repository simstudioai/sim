'use client'

import { useEffect, useRef, useState } from 'react'
import { ChevronDown, Plus, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { MAX_TAG_SLOTS, TAG_SLOTS, type TagSlot } from '@/lib/constants/knowledge'
import { useKnowledgeBaseTagDefinitions } from '@/hooks/use-knowledge-base-tag-definitions'
import { type TagDefinitionInput, useTagDefinitions } from '@/hooks/use-tag-definitions'

export interface DocumentTag {
  slot: TagSlot
  displayName: string
  fieldType: string
  value: string
}

interface DocumentTagEntryProps {
  tags: DocumentTag[]
  onTagsChange: (tags: DocumentTag[]) => void
  disabled?: boolean
  knowledgeBaseId?: string | null
  documentId?: string | null
  onSave?: (tags: DocumentTag[]) => Promise<void>
}

// TAG_SLOTS is now imported from constants

export function DocumentTagEntry({
  tags,
  onTagsChange,
  disabled = false,
  knowledgeBaseId = null,
  documentId = null,
  onSave,
}: DocumentTagEntryProps) {
  const { saveTagDefinitions } = useTagDefinitions(knowledgeBaseId, documentId)
  const { tagDefinitions: kbTagDefinitions, fetchTagDefinitions: refreshTagDefinitions } =
    useKnowledgeBaseTagDefinitions(knowledgeBaseId)

  const [editingTag, setEditingTag] = useState<{
    index: number
    value: string
    tagName: string
    isNew: boolean
  } | null>(null)

  const getNextAvailableSlot = (): DocumentTag['slot'] => {
    const usedSlots = new Set(tags.map((tag) => tag.slot))
    for (const slot of TAG_SLOTS) {
      if (!usedSlots.has(slot)) {
        return slot
      }
    }
    return 'tag1' // fallback
  }

  const handleSaveDefinitions = async (tagsToSave?: DocumentTag[]) => {
    if (!knowledgeBaseId || !documentId) return

    const currentTags = tagsToSave || tags

    // Create definitions for tags that have display names
    const definitions: TagDefinitionInput[] = currentTags
      .filter((tag) => tag?.displayName?.trim())
      .map((tag) => ({
        tagSlot: tag.slot as TagSlot,
        displayName: tag.displayName.trim(),
        fieldType: tag.fieldType || 'text',
      }))

    // Only save if we have valid definitions
    if (definitions.length > 0) {
      await saveTagDefinitions(definitions)
    }
  }

  const handleCleanupUnusedTags = async () => {
    if (!knowledgeBaseId || !documentId) return

    try {
      const response = await fetch(
        `/api/knowledge/${knowledgeBaseId}/documents/${documentId}/tag-definitions?action=cleanup`,
        {
          method: 'DELETE',
        }
      )

      if (!response.ok) {
        throw new Error(`Cleanup failed: ${response.statusText}`)
      }

      const result = await response.json()
      console.log('Cleanup result:', result)
    } catch (error) {
      console.error('Failed to cleanup unused tags:', error)
    }
  }

  // Get available tag names that aren't already used in this document
  const availableTagNames = kbTagDefinitions
    .map((tag) => tag.displayName)
    .filter((tagName) => !tags.some((tag) => tag.displayName === tagName))

  // Check if we can add more tags (KB has less than MAX_TAG_SLOTS tag definitions)
  const canAddMoreTags = kbTagDefinitions.length < MAX_TAG_SLOTS

  const handleSuggestionClick = (tagName: string) => {
    setEditingTag({ index: -1, value: '', tagName, isNew: false })
  }

  const handleCreateNewTag = async (tagName: string, value: string, fieldType = 'text') => {
    if (!tagName.trim() || !value.trim()) return

    // Check if tag name already exists in current document
    const tagNameLower = tagName.trim().toLowerCase()
    const existingTag = tags.find((tag) => tag.displayName.toLowerCase() === tagNameLower)
    if (existingTag) {
      alert(`Tag "${tagName}" already exists. Please choose a different name.`)
      return
    }

    const newTag: DocumentTag = {
      slot: getNextAvailableSlot(),
      displayName: tagName.trim(),
      fieldType: fieldType,
      value: value.trim(),
    }

    const updatedTags = [...tags, newTag]

    // SIMPLE ATOMIC OPERATION - NO CLEANUP
    try {
      // 1. Save tag definition first
      await handleSaveDefinitions(updatedTags)

      // 2. Save document values
      if (onSave) {
        await onSave(updatedTags)
      }

      // 3. Update UI
      onTagsChange(updatedTags)
    } catch (error) {
      console.error('Failed to save tag:', error)
      alert(`Failed to save tag "${tagName}". Please try again.`)
    }
  }

  const handleUpdateTag = async (index: number, newValue: string) => {
    if (!newValue.trim()) return

    const updatedTags = tags.map((tag, i) =>
      i === index ? { ...tag, value: newValue.trim() } : tag
    )

    // SIMPLE ATOMIC OPERATION - NO CLEANUP
    try {
      // 1. Save document values
      if (onSave) {
        await onSave(updatedTags)
      }
      // 2. Save tag definitions
      await handleSaveDefinitions(updatedTags)
      // 3. Update UI
      onTagsChange(updatedTags)
    } catch (error) {
      console.error('Failed to update tag:', error)
    }
  }

  const handleRemoveTag = async (index: number) => {
    const updatedTags = tags.filter((_, i) => i !== index)

    console.log('Removing tag, updated tags:', updatedTags)

    // FULLY SYNCHRONOUS - DO NOT UPDATE UI UNTIL ALL OPERATIONS COMPLETE
    try {
      // 1. Save the document tag values
      console.log('Saving document values after tag removal...')
      if (onSave) {
        await onSave(updatedTags)
      }

      // 2. Save the tag definitions
      console.log('Saving tag definitions after tag removal...')
      await handleSaveDefinitions(updatedTags)

      // 3. Run cleanup to remove unused tag definitions
      console.log('Running cleanup to remove unused tag definitions...')
      await handleCleanupUnusedTags()

      // 4. ONLY NOW update the UI
      onTagsChange(updatedTags)

      // 5. Refresh tag definitions for dropdown
      await refreshTagDefinitions()
    } catch (error) {
      console.error('Failed to remove tag:', error)
    }
  }

  return (
    <div className='space-y-3'>
      {/* Existing Tags as Chips */}
      <div className='flex flex-wrap gap-2'>
        {tags.map((tag, index) => (
          <div
            key={`${tag.slot}-${index}`}
            className='inline-flex cursor-pointer items-center gap-1 rounded-full bg-gray-100 px-3 py-1 text-sm transition-colors hover:bg-gray-200'
            onClick={() =>
              setEditingTag({ index, value: tag.value, tagName: tag.displayName, isNew: false })
            }
          >
            <span className='font-medium'>{tag.displayName}:</span>
            <span className='text-muted-foreground'>{tag.value}</span>
            <Button
              type='button'
              variant='ghost'
              size='sm'
              onClick={(e) => {
                e.stopPropagation()
                handleRemoveTag(index)
              }}
              disabled={disabled}
              className='ml-1 h-4 w-4 p-0 text-muted-foreground hover:text-red-600'
            >
              <X className='h-3 w-3' />
            </Button>
          </div>
        ))}
      </div>

      {/* Add Tag Dropdown Selector */}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            type='button'
            variant='outline'
            size='sm'
            disabled={disabled || (!canAddMoreTags && availableTagNames.length === 0)}
            className='gap-1 text-muted-foreground hover:text-foreground'
          >
            <Plus className='h-4 w-4' />
            <span>Add Tag</span>
            <ChevronDown className='h-3 w-3' />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align='start' className='w-48'>
          {/* Existing tag names */}
          {availableTagNames.length > 0 && (
            <>
              {availableTagNames.map((tagName) => {
                const tagDefinition = kbTagDefinitions.find((def) => def.displayName === tagName)
                return (
                  <DropdownMenuItem
                    key={tagName}
                    onClick={() => handleSuggestionClick(tagName)}
                    className='flex items-center justify-between'
                  >
                    <span>{tagName}</span>
                    <span className='text-muted-foreground text-xs'>
                      {tagDefinition?.fieldType || 'text'}
                    </span>
                  </DropdownMenuItem>
                )
              })}
              <div className='my-1 h-px bg-border' />
            </>
          )}

          {/* Create new tag option or disabled message */}
          {canAddMoreTags ? (
            <DropdownMenuItem
              onClick={() => {
                setEditingTag({ index: -1, value: '', tagName: '', isNew: true })
              }}
              className='flex items-center gap-2 text-blue-600'
            >
              <Plus className='h-4 w-4' />
              <span>Create new tag</span>
            </DropdownMenuItem>
          ) : (
            <div className='px-2 py-1.5 text-muted-foreground text-sm'>
              All {MAX_TAG_SLOTS} tag slots used in this knowledge base
            </div>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      {/* Edit Tag Value Modal */}
      {editingTag !== null && (
        <EditTagModal
          tagName={editingTag.tagName}
          initialValue={editingTag.value}
          isNew={editingTag.isNew}
          existingType={
            editingTag.isNew
              ? undefined
              : kbTagDefinitions.find((t) => t.displayName === editingTag.tagName)?.fieldType
          }
          onSave={(value, type, newTagName) => {
            if (editingTag.index === -1) {
              // Creating new tag - use newTagName if provided, otherwise fall back to editingTag.tagName
              const tagName = newTagName || editingTag.tagName
              handleCreateNewTag(tagName, value, type)
            } else {
              // Updating existing tag
              handleUpdateTag(editingTag.index, value)
            }
            setEditingTag(null)
          }}
          onCancel={() => {
            setEditingTag(null)
          }}
        />
      )}

      {/* Tag count display */}
      {kbTagDefinitions.length > 0 && (
        <div className='text-muted-foreground text-xs'>
          {kbTagDefinitions.length} of {MAX_TAG_SLOTS} tag slots used in this knowledge base
        </div>
      )}
    </div>
  )
}

// Simple modal for editing tag values
interface EditTagModalProps {
  tagName: string
  initialValue: string
  isNew: boolean
  existingType?: string
  onSave: (value: string, type?: string, newTagName?: string) => void
  onCancel: () => void
}

function EditTagModal({
  tagName,
  initialValue,
  isNew,
  existingType,
  onSave,
  onCancel,
}: EditTagModalProps) {
  const [value, setValue] = useState(initialValue)
  const [fieldType, setFieldType] = useState(existingType || 'text')
  const [newTagName, setNewTagName] = useState(tagName)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (value.trim() && (isNew ? newTagName.trim() : true)) {
      onSave(value.trim(), fieldType, isNew ? newTagName.trim() : undefined)
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      onCancel()
    }
  }

  return (
    <div className='fixed inset-0 z-50 flex items-center justify-center bg-black/50'>
      <div className='mx-4 w-96 max-w-sm rounded-lg bg-white p-4'>
        <div className='mb-3 flex items-start justify-between'>
          <h3 className='font-medium text-sm'>
            {isNew ? 'Create new tag' : `Edit "${tagName}" value`}
          </h3>
          {/* Type Badge in Top Right */}
          {!isNew && existingType && (
            <span className='rounded bg-gray-100 px-2 py-1 font-medium text-gray-500 text-xs'>
              {existingType.toUpperCase()}
            </span>
          )}
        </div>
        <form onSubmit={handleSubmit} className='space-y-3'>
          {/* Tag Name Input for New Tags */}
          {isNew && (
            <div>
              <Label className='font-medium text-muted-foreground text-xs'>Tag Name</Label>
              <Input
                value={newTagName}
                onChange={(e) => setNewTagName(e.target.value)}
                placeholder='Enter tag name'
                className='mt-1 text-sm'
              />
            </div>
          )}

          {/* Type Selection for New Tags */}
          {isNew && (
            <div>
              <Label className='font-medium text-muted-foreground text-xs'>Type</Label>
              <Select value={fieldType} onValueChange={setFieldType}>
                <SelectTrigger className='mt-1 text-sm'>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value='text'>Text</SelectItem>
                </SelectContent>
              </Select>
            </div>
          )}

          {/* Value Input */}
          <div>
            <Label className='font-medium text-muted-foreground text-xs'>Value</Label>
            <Input
              ref={inputRef}
              value={value}
              onChange={(e) => setValue(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder='Enter tag value'
              className='mt-1 text-sm'
            />
          </div>

          <div className='flex justify-end gap-2'>
            <Button type='button' variant='outline' size='sm' onClick={onCancel}>
              Cancel
            </Button>
            <Button
              type='submit'
              size='sm'
              disabled={!value.trim() || (isNew && !newTagName.trim())}
            >
              {isNew ? 'Create' : 'Save'}
            </Button>
          </div>
        </form>
      </div>
    </div>
  )
}
