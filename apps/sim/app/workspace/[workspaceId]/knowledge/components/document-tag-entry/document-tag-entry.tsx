'use client'

import { useEffect, useRef, useState } from 'react'
import { Plus, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { useKnowledgeBaseTagDefinitions } from '@/hooks/use-knowledge-base-tag-definitions'
import { type TagDefinitionInput, useTagDefinitions } from '@/hooks/use-tag-definitions'

export interface DocumentTag {
  slot: 'tag1' | 'tag2' | 'tag3' | 'tag4' | 'tag5' | 'tag6' | 'tag7'
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

const TAG_SLOTS = ['tag1', 'tag2', 'tag3', 'tag4', 'tag5', 'tag6', 'tag7'] as const

export function DocumentTagEntry({
  tags,
  onTagsChange,
  disabled = false,
  knowledgeBaseId = null,
  documentId = null,
  onSave,
}: DocumentTagEntryProps) {
  const { saveTagDefinitions } = useTagDefinitions(knowledgeBaseId, documentId)
  const { tagDefinitions: kbTagDefinitions } = useKnowledgeBaseTagDefinitions(knowledgeBaseId)
  const [inputValue, setInputValue] = useState('')
  const [showSuggestions, setShowSuggestions] = useState(false)
  const [showInput, setShowInput] = useState(false)
  const [editingTag, setEditingTag] = useState<{
    index: number
    value: string
    tagName: string
    isNew: boolean
  } | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const suggestionsRef = useRef<HTMLDivElement>(null)

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
      .filter((tag) => tag.displayName.trim())
      .map((tag) => ({
        tagSlot: tag.slot,
        displayName: tag.displayName.trim(),
        fieldType: tag.fieldType,
      }))

    // Save the definitions
    await saveTagDefinitions(definitions)
  }

  // Filter suggestions based on input
  const filteredSuggestions = kbTagDefinitions.filter((tag) =>
    tag.displayName.toLowerCase().includes(inputValue.toLowerCase())
  )

  // Check if current input would create a duplicate
  const wouldCreateDuplicate =
    inputValue.trim() &&
    tags.some((tag) => tag.displayName.toLowerCase() === inputValue.trim().toLowerCase())

  const handleInputChange = (value: string) => {
    setInputValue(value)
    setShowSuggestions(value.length > 0)
    // Keep input visible if there's a value, but don't hide it if we're editing a tag
    if (!value && !editingTag) {
      setShowInput(false)
      setShowSuggestions(false)
    }
  }

  const handleSuggestionClick = (tagName: string) => {
    setInputValue('')
    setShowSuggestions(false)
    setEditingTag({ index: -1, value: '', tagName, isNew: false }) // Existing tag
    // Focus will be handled by the edit input
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
    onTagsChange(updatedTags)

    // Save immediately - document values first, then definitions
    try {
      // First save the document tag values
      if (onSave) {
        await onSave(updatedTags)
      }
      // Then save the tag definitions (cleanup will run and see the updated document values)
      await handleSaveDefinitions(updatedTags)
    } catch (error) {
      console.error('Failed to save tag:', error)
    }
  }

  const handleUpdateTag = async (index: number, newValue: string) => {
    if (!newValue.trim()) return

    const updatedTags = tags.map((tag, i) =>
      i === index ? { ...tag, value: newValue.trim() } : tag
    )
    onTagsChange(updatedTags)

    // Save immediately - document values first, then definitions
    try {
      // First save the document tag values
      if (onSave) {
        await onSave(updatedTags)
      }
      // Then save the tag definitions (cleanup will run and see the updated document values)
      await handleSaveDefinitions(updatedTags)
    } catch (error) {
      console.error('Failed to update tag:', error)
    }
  }

  const handleRemoveTag = async (index: number) => {
    const updatedTags = tags.filter((_, i) => i !== index)
    onTagsChange(updatedTags)

    // Save immediately
    try {
      // First save the document tag values
      if (onSave) {
        await onSave(updatedTags)
      }
      // Then save the tag definitions (cleanup will run and see the updated document values)
      await handleSaveDefinitions(updatedTags)

      // The document page will automatically rebuild tags when definitions change
    } catch (error) {
      console.error('Failed to remove tag:', error)
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && inputValue.trim()) {
      e.preventDefault()
      // If there's an exact match, use it; otherwise create new
      const exactMatch = kbTagDefinitions.find(
        (tag) => tag.displayName.toLowerCase() === inputValue.toLowerCase()
      )
      if (exactMatch) {
        handleSuggestionClick(exactMatch.displayName)
      } else if (!wouldCreateDuplicate) {
        // Create new tag only if it's not a duplicate
        const tagName = inputValue.trim()
        setEditingTag({ index: -1, value: '', tagName, isNew: true })
        setShowSuggestions(false)
        // Don't clear input here - let the modal handle it
      }
      // If it would create duplicate, do nothing (user sees the disabled state)
    } else if (e.key === 'Escape') {
      setInputValue('')
      setShowSuggestions(false)
      setShowInput(false)
    }
  }

  // Close suggestions when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        suggestionsRef.current &&
        !suggestionsRef.current.contains(event.target as Node) &&
        inputRef.current &&
        !inputRef.current.contains(event.target as Node)
      ) {
        setShowSuggestions(false)
      }
    }

    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

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

      {/* Add Tag Input or Plus Button */}
      {showInput ? (
        <div className='relative'>
          <Input
            ref={inputRef}
            placeholder='Add tag...'
            value={inputValue}
            onChange={(e) => handleInputChange(e.target.value)}
            onKeyDown={handleKeyDown}
            onFocus={() => inputValue && setShowSuggestions(true)}
            onBlur={() => {
              // Hide input if empty and no suggestions showing
              setTimeout(() => {
                if (!inputValue && !showSuggestions) {
                  setShowInput(false)
                }
              }, 150) // Small delay to allow clicking suggestions
            }}
            disabled={disabled || tags.length >= 7}
            className='text-sm'
            autoFocus
          />

          {/* Suggestions Dropdown */}
          {showSuggestions && (
            <div
              ref={suggestionsRef}
              className='absolute top-full right-0 left-0 z-50 mt-1 max-h-48 overflow-y-auto rounded-md border bg-white shadow-lg'
            >
              {filteredSuggestions.length > 0 && (
                <>
                  {filteredSuggestions.map((tag) => (
                    <button
                      key={tag.id}
                      type='button'
                      className='flex w-full items-center justify-between px-3 py-2 text-left text-sm hover:bg-gray-100'
                      onClick={() => handleSuggestionClick(tag.displayName)}
                    >
                      <span>{tag.displayName}</span>
                      <span className='text-gray-500 text-xs'>{tag.fieldType}</span>
                    </button>
                  ))}
                  <div className='border-gray-200 border-t' />
                </>
              )}
              <button
                type='button'
                className={`w-full px-3 py-2 text-left text-sm ${
                  wouldCreateDuplicate
                    ? 'cursor-not-allowed text-gray-400'
                    : 'text-blue-600 hover:bg-gray-100'
                }`}
                onClick={() => {
                  if (!wouldCreateDuplicate) {
                    const tagName = inputValue.trim()
                    setEditingTag({ index: -1, value: '', tagName, isNew: true })
                    setShowSuggestions(false)
                    // Don't clear input here - let the modal handle it
                  }
                }}
                disabled={!!wouldCreateDuplicate}
              >
                {wouldCreateDuplicate
                  ? `"${inputValue}" already exists`
                  : `+ Create "${inputValue}" tag`}
              </button>
            </div>
          )}
        </div>
      ) : (
        <Button
          type='button'
          variant='outline'
          size='sm'
          onClick={() => setShowInput(true)}
          disabled={disabled || tags.length >= 7}
          className='gap-1 text-muted-foreground'
        >
          <Plus className='h-4 w-4' />
          Add Tag
        </Button>
      )}

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
          onSave={(value, type) => {
            if (editingTag.index === -1) {
              // Creating new tag
              handleCreateNewTag(editingTag.tagName, value, type)
            } else {
              // Updating existing tag
              handleUpdateTag(editingTag.index, value)
            }
            setEditingTag(null)
            setInputValue('')
            setShowInput(false)
          }}
          onCancel={() => {
            setEditingTag(null)
            setInputValue('')
            setShowInput(false)
          }}
        />
      )}

      {tags.length > 0 && (
        <div className='text-muted-foreground text-xs'>{tags.length} of 7 tags used</div>
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
  onSave: (value: string, type?: string) => void
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
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (value.trim()) {
      onSave(value.trim(), fieldType)
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
            {isNew ? `Create "${tagName}" tag` : `Edit "${tagName}" value`}
          </h3>
          {/* Type Badge in Top Right */}
          {!isNew && existingType && (
            <span className='rounded bg-gray-100 px-2 py-1 font-medium text-gray-500 text-xs'>
              {existingType.toUpperCase()}
            </span>
          )}
        </div>
        <form onSubmit={handleSubmit} className='space-y-3'>
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
            <Button type='submit' size='sm' disabled={!value.trim()}>
              {isNew ? 'Create' : 'Save'}
            </Button>
          </div>
        </form>
      </div>
    </div>
  )
}
