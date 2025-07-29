'use client'

import { Plus, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { MAX_TAG_SLOTS } from '@/lib/constants/knowledge'
import type { SubBlockConfig } from '@/blocks/types'
import { useKnowledgeBaseTagDefinitions } from '@/hooks/use-knowledge-base-tag-definitions'
import { useSubBlockValue } from '../../hooks/use-sub-block-value'

interface DocumentTag {
  id: string
  tagName: string // This will be mapped to displayName for API
  fieldType: string
  value: string
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
  const [storeValue, setStoreValue] = useSubBlockValue(blockId, subBlock.id)

  // Get the knowledge base ID from other sub-blocks
  const [knowledgeBaseIdValue] = useSubBlockValue(blockId, 'knowledgeBaseId')
  const knowledgeBaseId = knowledgeBaseIdValue || null

  // Use KB tag definitions hook to get available tags
  const { tagDefinitions, isLoading } = useKnowledgeBaseTagDefinitions(knowledgeBaseId)

  // Parse the current value to extract tags
  const parseTags = (tagValue: string): DocumentTag[] => {
    if (!tagValue) return []
    try {
      return JSON.parse(tagValue)
    } catch {
      return []
    }
  }

  const currentValue = isPreview ? previewValue : storeValue
  const tags = parseTags(currentValue || '')

  const updateTags = (newTags: DocumentTag[]) => {
    if (isPreview) return
    const value = newTags.length > 0 ? JSON.stringify(newTags) : null
    setStoreValue(value)
  }

  const removeTag = (tagId: string) => {
    updateTags(tags.filter((t) => t.id !== tagId))
  }

  const updateTag = (tagId: string, updates: Partial<DocumentTag>) => {
    updateTags(tags.map((tag) => (tag.id === tagId ? { ...tag, ...updates } : tag)))
  }

  // Get available tag names that aren't already used
  const usedTagNames = new Set(tags.map((tag) => tag.tagName).filter(Boolean))
  const availableTagNames = tagDefinitions
    .map((def) => def.displayName)
    .filter((name) => !usedTagNames.has(name))

  if (isLoading) {
    return <div className='p-4 text-muted-foreground text-sm'>Loading tag definitions...</div>
  }

  return (
    <div className='space-y-4'>
      {/* Available Tags Section */}
      {availableTagNames.length > 0 && (
        <div>
          <div className='mb-2 font-medium text-muted-foreground text-sm'>
            Available Tags (click to add)
          </div>
          <div className='flex flex-wrap gap-2'>
            {availableTagNames.map((tagName) => {
              const tagDef = tagDefinitions.find((def) => def.displayName === tagName)
              return (
                <button
                  key={tagName}
                  onClick={() => {
                    // Check for duplicates before adding
                    if (!usedTagNames.has(tagName)) {
                      const newTag: DocumentTag = {
                        id: Date.now().toString(),
                        tagName,
                        fieldType: tagDef?.fieldType || 'text',
                        value: '',
                      }
                      updateTags([...tags, newTag])
                    }
                  }}
                  disabled={disabled || isConnecting}
                  className='inline-flex items-center gap-1 rounded-full border border-gray-300 border-dashed bg-gray-50 px-3 py-1 text-gray-600 text-sm transition-colors hover:border-blue-300 hover:bg-blue-50 hover:text-blue-700 disabled:opacity-50'
                >
                  <Plus className='h-3 w-3' />
                  {tagName}
                  <span className='text-muted-foreground text-xs'>
                    ({tagDef?.fieldType || 'text'})
                  </span>
                </button>
              )
            })}
          </div>
        </div>
      )}

      {/* Selected Tags Section */}
      {tags.length > 0 && (
        <div>
          <div className='space-y-2'>
            {tags.map((tag) => (
              <div key={tag.id} className='flex items-center gap-2 rounded-lg border bg-white p-3'>
                {/* Tag Name */}
                <div className='flex-1'>
                  <div className='font-medium text-gray-900 text-sm'>
                    {tag.tagName || 'Unnamed Tag'}
                  </div>
                  <div className='text-muted-foreground text-xs'>{tag.fieldType}</div>
                </div>

                {/* Value Input */}
                <div className='flex-1'>
                  <Input
                    value={tag.value}
                    onChange={(e) => updateTag(tag.id, { value: e.target.value })}
                    placeholder='Value'
                    disabled={disabled || isConnecting}
                    className='h-9 placeholder:text-xs'
                    type={tag.fieldType === 'number' ? 'number' : 'text'}
                  />
                </div>

                {/* Remove Button */}
                <Button
                  onClick={() => removeTag(tag.id)}
                  variant='ghost'
                  size='sm'
                  disabled={disabled || isConnecting}
                  className='h-9 w-9 p-0 text-muted-foreground hover:text-red-600'
                >
                  <X className='h-4 w-4' />
                </Button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Create New Tag Section */}
      <div>
        <div className='mb-2 font-medium text-muted-foreground text-sm'>Create New Tag</div>
        <div className='flex items-center gap-2 rounded-lg border border-gray-300 border-dashed bg-gray-50 p-3'>
          <div className='flex-1'>
            <Input
              placeholder={tagDefinitions.length >= MAX_TAG_SLOTS ? '' : 'Tag name'}
              disabled={disabled || isConnecting || tagDefinitions.length >= MAX_TAG_SLOTS}
              className='h-9 border-0 bg-transparent p-0 placeholder:text-xs focus-visible:ring-0'
              onKeyDown={(e) => {
                if (e.key === 'Enter' && e.currentTarget.value.trim()) {
                  const tagName = e.currentTarget.value.trim()

                  // Check for duplicates
                  if (usedTagNames.has(tagName)) {
                    // Visual feedback for duplicate - could add toast notification here
                    e.currentTarget.style.borderColor = '#ef4444'
                    setTimeout(() => {
                      e.currentTarget.style.borderColor = ''
                    }, 1000)
                    return
                  }

                  const newTag: DocumentTag = {
                    id: Date.now().toString(),
                    tagName,
                    fieldType: 'text',
                    value: '',
                  }
                  updateTags([...tags, newTag])
                  e.currentTarget.value = ''
                }
              }}
            />
          </div>
          <div className='text-muted-foreground text-xs'>
            {tagDefinitions.length >= MAX_TAG_SLOTS
              ? `All ${MAX_TAG_SLOTS} tag slots used in this knowledge base`
              : usedTagNames.size > 0
                ? 'Press Enter (no duplicates)'
                : 'Press Enter to add'}
          </div>
        </div>
      </div>

      {/* Empty State */}
      {tags.length === 0 && availableTagNames.length === 0 && (
        <div className='py-8 text-center text-muted-foreground'>
          <div className='text-sm'>No tags available</div>
          <div className='text-xs'>Create a new tag above to get started</div>
        </div>
      )}
    </div>
  )
}
