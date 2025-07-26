'use client'

import { useCallback, useState } from 'react'
import { Plus, Save, X } from 'lucide-react'
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
const FIELD_TYPES = [
  { value: 'text', label: 'Text' },
  // Future types can be added here
  // { value: 'date', label: 'Date' },
  // { value: 'number', label: 'Number' },
  // { value: 'range', label: 'Range' },
]

export function DocumentTagEntry({
  tags,
  onTagsChange,
  disabled = false,
  knowledgeBaseId = null,
  documentId = null,
  onSave,
}: DocumentTagEntryProps) {
  const { saveTagDefinitions, fetchTagDefinitions } = useTagDefinitions(knowledgeBaseId, documentId)
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const [initialTags, setInitialTags] = useState<DocumentTag[]>([])

  // Track initial tags to detect real changes
  if (initialTags.length === 0 && tags.length > 0) {
    setInitialTags([...tags])
  }

  const addTag = () => {
    if (tags.length >= 7) return

    // Find the next available slot
    const usedSlots = new Set(tags.map((tag) => tag.slot))
    const availableSlot = TAG_SLOTS.find((slot) => !usedSlots.has(slot))

    if (!availableSlot) return

    const newTag: DocumentTag = {
      slot: availableSlot,
      displayName: '',
      fieldType: 'text',
      value: '',
    }

    onTagsChange([...tags, newTag])
    setHasUnsavedChanges(true)
  }

  const removeTag = (index: number) => {
    const newTags = tags.filter((_, i) => i !== index)
    onTagsChange(newTags)
    setHasUnsavedChanges(true)
  }

  const updateTag = (index: number, field: keyof DocumentTag, value: string) => {
    const newTags = tags.map((tag, i) => (i === index ? { ...tag, [field]: value } : tag))
    onTagsChange(newTags)
    setHasUnsavedChanges(true)
  }

  // Validation helper
  const getTagValidation = (tag: DocumentTag) => {
    const hasValue = tag.value.trim().length > 0
    const hasDisplayName = tag.displayName.trim().length > 0

    return {
      isValid: !hasValue || hasDisplayName, // If has value, must have display name
      errorMessage:
        hasValue && !hasDisplayName ? 'Tag name is required when value is provided' : null,
    }
  }

  const handleSaveDefinitions = useCallback(
    async (tagsToSave?: DocumentTag[]) => {
      if (!knowledgeBaseId || !documentId) return

      const tagsData = tagsToSave || tags

      // Save tag definitions (only for tags with display names)
      const definitions: TagDefinitionInput[] = tagsData
        .filter((tag) => tag.displayName.trim())
        .map((tag) => ({
          tagSlot: tag.slot,
          displayName: tag.displayName.trim(),
          fieldType: tag.fieldType,
        }))

      try {
        await saveTagDefinitions(definitions)
      } catch (error) {
        console.error('Failed to save tag definitions:', error)
      }
    },
    [knowledgeBaseId, documentId, tags, saveTagDefinitions]
  )

  const handleSave = async () => {
    if (!knowledgeBaseId || !documentId) return

    setIsSaving(true)
    try {
      // Save tag definitions first
      await handleSaveDefinitions()

      // Then save document values if onSave is provided
      if (onSave) {
        await onSave(tags)
      }

      // Refresh tag definitions to get the latest data
      await fetchTagDefinitions()

      setHasUnsavedChanges(false)
    } catch (error) {
      console.error('Failed to save tags:', error)
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <div className='space-y-4'>
      <div className='flex items-center justify-between'>
        <Label className='font-medium text-sm'>Document Tags</Label>
        <div className='flex items-center gap-2'>
          {hasUnsavedChanges && (
            <Button
              type='button'
              variant='default'
              size='sm'
              onClick={handleSave}
              disabled={disabled || isSaving}
              className='h-8 bg-[#701FFC] hover:bg-[#6518E6]'
            >
              <Save className='mr-1 h-3 w-3' />
              {isSaving ? 'Saving...' : 'Save'}
            </Button>
          )}
          {tags.length < 7 && (
            <Button
              type='button'
              variant='outline'
              size='sm'
              onClick={addTag}
              disabled={disabled}
              className='h-8'
            >
              <Plus className='mr-1 h-3 w-3' />
              Add Tag
            </Button>
          )}
        </div>
      </div>

      {tags.length === 0 ? (
        <div className='rounded-md border border-muted-foreground/25 border-dashed p-4 text-center'>
          <p className='text-muted-foreground text-sm'>
            No tags added yet. Click "Add Tag" to create your first tag.
          </p>
        </div>
      ) : (
        <div className='space-y-3'>
          {tags.map((tag, index) => {
            const validation = getTagValidation(tag)

            return (
              <div
                key={`${tag.slot}-${index}`}
                className={`relative rounded-md border p-4 ${!validation.isValid ? 'border-red-200 bg-red-50/50' : ''}`}
              >
                {/* Remove button - positioned at top right */}
                <Button
                  type='button'
                  variant='ghost'
                  size='sm'
                  onClick={() => removeTag(index)}
                  disabled={disabled}
                  className='absolute top-2 right-2 h-6 w-6 p-0 text-muted-foreground hover:text-red-600'
                >
                  <X className='h-4 w-4' />
                </Button>

                <div className='grid grid-cols-1 gap-4 pr-8 sm:grid-cols-3'>
                  {/* Tag Name */}
                  <div>
                    <Label className='font-medium text-muted-foreground text-xs'>
                      Tag Name {tag.value.trim() && <span className='text-red-500'>*</span>}
                    </Label>
                    <Input
                      placeholder='e.g., Department, Priority'
                      value={tag.displayName}
                      onChange={(e) => updateTag(index, 'displayName', e.target.value)}
                      disabled={disabled}
                      className={`mt-1.5 text-sm ${!validation.isValid ? 'border-red-300 focus:border-red-500' : ''}`}
                    />
                    {validation.errorMessage && (
                      <p className='mt-1 text-red-600 text-xs'>{validation.errorMessage}</p>
                    )}
                  </div>

                  {/* Field Type */}
                  <div>
                    <Label className='font-medium text-muted-foreground text-xs'>Type</Label>
                    <Select
                      value={tag.fieldType}
                      onValueChange={(value) => updateTag(index, 'fieldType', value)}
                      disabled={disabled}
                    >
                      <SelectTrigger className='mt-1.5 text-sm'>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {FIELD_TYPES.map((type) => (
                          <SelectItem key={type.value} value={type.value}>
                            {type.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  {/* Tag Value */}
                  <div>
                    <Label className='font-medium text-muted-foreground text-xs'>Value</Label>
                    <Input
                      placeholder={`Enter ${tag.displayName || 'tag'} value`}
                      value={tag.value}
                      onChange={(e) => updateTag(index, 'value', e.target.value)}
                      disabled={disabled}
                      className='mt-1.5 text-sm'
                    />
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {tags.length > 0 && (
        <div className='text-muted-foreground text-xs'>{tags.length} of 7 tags used</div>
      )}
    </div>
  )
}
