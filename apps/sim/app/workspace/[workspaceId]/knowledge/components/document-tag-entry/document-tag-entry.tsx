'use client'

import { useState } from 'react'
import { ChevronDown, Plus, X } from 'lucide-react'
import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  formatDisplayText,
  Input,
  Label,
} from '@/components/ui'
import { MAX_TAG_SLOTS, TAG_SLOTS, type TagSlot } from '@/lib/constants/knowledge'
import { useKnowledgeBaseTagDefinitions } from '@/hooks/use-knowledge-base-tag-definitions'
import { type TagDefinitionInput, useTagDefinitions } from '@/hooks/use-tag-definitions'

export interface DocumentTag {
  slot: string
  displayName: string
  fieldType: string
  value: string
}

interface DocumentTagEntryProps {
  tags: DocumentTag[]
  onTagsChange: (newTags: DocumentTag[]) => void
  disabled?: boolean
  knowledgeBaseId: string
  documentId: string | null
  onSave: (tagsToSave: DocumentTag[]) => Promise<void>
}

export function DocumentTagEntry({
  tags,
  onTagsChange,
  disabled = false,
  knowledgeBaseId,
  documentId,
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
    return TAG_SLOTS[0] // Fallback to first slot if all are used
  }

  const handleAddTag = () => {
    if (tags.length >= MAX_TAG_SLOTS) return

    const newTag: DocumentTag = {
      slot: getNextAvailableSlot(),
      displayName: '',
      fieldType: 'text',
      value: '',
    }

    const updatedTags = [...tags, newTag]
    onTagsChange(updatedTags)

    // Set editing state for the new tag
    setEditingTag({
      index: updatedTags.length - 1,
      value: '',
      tagName: '',
      isNew: true,
    })
  }

  const handleRemoveTag = (index: number) => {
    const updatedTags = tags.filter((_, i) => i !== index)
    onTagsChange(updatedTags)
  }

  const handleTagUpdate = (index: number, field: keyof DocumentTag, value: string) => {
    const updatedTags = [...tags]
    updatedTags[index] = { ...updatedTags[index], [field]: value }
    onTagsChange(updatedTags)
  }

  const handleSaveTag = async (index: number, tagName: string) => {
    if (!tagName.trim()) return

    // Check if this is creating a new tag definition
    const existingDefinition = kbTagDefinitions.find(
      (def) => def.displayName.toLowerCase() === tagName.toLowerCase()
    )

    if (!existingDefinition) {
      // Create new tag definition
      const newDefinition: TagDefinitionInput = {
        displayName: tagName,
        fieldType: 'text',
        tagSlot: tags[index].slot as TagSlot,
      }

      try {
        await saveTagDefinitions([newDefinition])
        await refreshTagDefinitions()
      } catch (error) {
        console.error('Failed to save tag definition:', error)
        return
      }
    }

    // Update the tag
    handleTagUpdate(index, 'displayName', tagName)
    setEditingTag(null)
  }

  const handleCancelEdit = () => {
    if (editingTag?.isNew) {
      // Remove the new tag if editing was cancelled
      handleRemoveTag(editingTag.index)
    }
    setEditingTag(null)
  }

  const handleSaveAll = async () => {
    try {
      await onSave(tags)
    } catch (error) {
      console.error('Failed to save tags:', error)
    }
  }

  // Filter available tag definitions (exclude already used ones)
  const availableDefinitions = kbTagDefinitions.filter(
    (def) => !tags.some((tag) => tag.displayName.toLowerCase() === def.displayName.toLowerCase())
  )

  return (
    <div className='space-y-4'>
      <div className='flex items-center justify-between'>
        <h3 className='font-medium text-sm'>Document Tags</h3>
        <div className='flex items-center gap-2'>
          <Button
            variant='outline'
            size='sm'
            onClick={handleAddTag}
            disabled={disabled || tags.length >= MAX_TAG_SLOTS}
          >
            <Plus className='mr-1 h-3 w-3' />
            Add Tag
          </Button>
          <Button variant='default' size='sm' onClick={handleSaveAll} disabled={disabled}>
            Save Tags
          </Button>
        </div>
      </div>

      {tags.length === 0 ? (
        <div className='rounded-md border border-dashed p-4 text-center'>
          <p className='text-muted-foreground text-sm'>No tags added yet</p>
        </div>
      ) : (
        <div className='space-y-2'>
          {tags.map((tag, index) => (
            <div key={index} className='flex items-center gap-2 rounded-md border p-3'>
              <div className='flex-1'>
                {editingTag?.index === index ? (
                  <div className='space-y-2'>
                    <div className='flex items-center gap-2'>
                      <Input
                        value={editingTag.tagName}
                        onChange={(e) => setEditingTag({ ...editingTag, tagName: e.target.value })}
                        placeholder='Tag name'
                        className='flex-1'
                        autoFocus
                      />
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant='outline' size='sm'>
                            Select Existing <ChevronDown className='ml-1 h-3 w-3' />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent>
                          {availableDefinitions.map((def) => (
                            <DropdownMenuItem
                              key={def.id}
                              onClick={() =>
                                setEditingTag({ ...editingTag, tagName: def.displayName })
                              }
                            >
                              {def.displayName}
                            </DropdownMenuItem>
                          ))}
                          {availableDefinitions.length === 0 && (
                            <DropdownMenuItem disabled>No available tags</DropdownMenuItem>
                          )}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                    <div className='flex items-center gap-2'>
                      <Button
                        size='sm'
                        onClick={() => handleSaveTag(index, editingTag.tagName)}
                        disabled={!editingTag.tagName.trim()}
                      >
                        Save
                      </Button>
                      <Button variant='outline' size='sm' onClick={handleCancelEdit}>
                        Cancel
                      </Button>
                    </div>
                  </div>
                ) : (
                  <div className='space-y-2'>
                    <div className='flex items-center justify-between'>
                      <div>
                        <div className='font-medium text-sm'>
                          {tag.displayName || 'Unnamed Tag'}
                        </div>
                        <div className='text-muted-foreground text-xs'>
                          Slot: {tag.slot} • Type: {tag.fieldType}
                        </div>
                      </div>
                      <Button
                        variant='ghost'
                        size='sm'
                        onClick={() =>
                          setEditingTag({
                            index,
                            value: tag.value,
                            tagName: tag.displayName,
                            isNew: false,
                          })
                        }
                        disabled={disabled}
                      >
                        Edit Name
                      </Button>
                    </div>
                    <div className='flex items-center gap-2'>
                      <Label htmlFor={`tag-value-${index}`} className='text-xs'>
                        Value:
                      </Label>
                      <div className='relative flex-1'>
                        <Input
                          id={`tag-value-${index}`}
                          value={tag.value}
                          onChange={(e) => handleTagUpdate(index, 'value', e.target.value)}
                          placeholder='Enter tag value'
                          disabled={disabled}
                          className='w-full text-transparent caret-foreground'
                        />
                        <div className='pointer-events-none absolute inset-0 flex items-center overflow-hidden bg-transparent px-3 text-sm'>
                          <div className='whitespace-pre'>{formatDisplayText(tag.value)}</div>
                        </div>
                      </div>
                    </div>
                  </div>
                )}
              </div>
              <Button
                variant='ghost'
                size='sm'
                onClick={() => handleRemoveTag(index)}
                disabled={disabled}
                className='text-red-600 hover:text-red-800'
              >
                <X className='h-4 w-4' />
              </Button>
            </div>
          ))}
        </div>
      )}

      <div className='text-muted-foreground text-xs'>
        {tags.length} of {MAX_TAG_SLOTS} tag slots used
      </div>
    </div>
  )
}
