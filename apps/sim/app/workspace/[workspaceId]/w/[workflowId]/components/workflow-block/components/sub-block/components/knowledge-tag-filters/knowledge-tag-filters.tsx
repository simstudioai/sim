'use client'

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
import type { SubBlockConfig } from '@/blocks/types'
import { useKnowledgeBaseTagDefinitions } from '@/hooks/use-knowledge-base-tag-definitions'
import { useSubBlockValue } from '../../hooks/use-sub-block-value'

interface TagFilter {
  id: string
  tagName: string
  tagValue: string
}

interface KnowledgeTagFiltersProps {
  blockId: string
  subBlock: SubBlockConfig
  disabled?: boolean
  isPreview?: boolean
  previewValue?: string | null
  isConnecting?: boolean
}

export function KnowledgeTagFilters({
  blockId,
  subBlock,
  disabled = false,
  isPreview = false,
  previewValue,
  isConnecting = false,
}: KnowledgeTagFiltersProps) {
  const [storeValue, setStoreValue] = useSubBlockValue(blockId, subBlock.id)

  // Get the knowledge base ID from other sub-blocks
  const [knowledgeBaseIdValue] = useSubBlockValue(blockId, 'knowledgeBaseId')
  const knowledgeBaseId = knowledgeBaseIdValue || null

  // Use KB tag definitions hook to get available tags
  const { tagDefinitions, isLoading } = useKnowledgeBaseTagDefinitions(knowledgeBaseId)

  // Parse the current value to extract filters
  const parseFilters = (filterValue: string): TagFilter[] => {
    if (!filterValue) return []
    try {
      return JSON.parse(filterValue)
    } catch {
      return []
    }
  }

  const currentValue = isPreview ? previewValue : storeValue
  const filters = parseFilters(currentValue || '')

  const updateFilters = (newFilters: TagFilter[]) => {
    if (isPreview) return
    const value = newFilters.length > 0 ? JSON.stringify(newFilters) : null
    setStoreValue(value)
  }

  const addFilter = () => {
    const newFilter: TagFilter = {
      id: Date.now().toString(),
      tagName: '',
      tagValue: '',
    }
    updateFilters([...filters, newFilter])
  }

  const removeFilter = (filterId: string) => {
    updateFilters(filters.filter((f) => f.id !== filterId))
  }

  const updateFilter = (filterId: string, field: keyof TagFilter, value: string) => {
    updateFilters(filters.map((f) => (f.id === filterId ? { ...f, [field]: value } : f)))
  }

  if (isPreview) {
    return (
      <div className='space-y-1'>
        <Label className='font-medium text-muted-foreground text-xs'>Tag Filters</Label>
        <div className='text-muted-foreground text-sm'>
          {filters.length > 0 ? `${filters.length} filter(s)` : 'No filters'}
        </div>
      </div>
    )
  }

  return (
    <div className='space-y-3'>
      <div className='flex items-center justify-end'>
        <Button
          type='button'
          variant='ghost'
          size='sm'
          onClick={addFilter}
          disabled={disabled || isConnecting || isLoading}
          className='h-6 px-2 text-xs'
        >
          <Plus className='mr-1 h-3 w-3' />
          Add Filter
        </Button>
      </div>

      {filters.length === 0 && (
        <div className='py-4 text-center text-muted-foreground text-sm'>
          No tag filters. Click "Add Filter" to add one.
        </div>
      )}

      <div className='space-y-2'>
        {filters.map((filter) => (
          <div key={filter.id} className='flex items-center gap-2 rounded-md border p-2'>
            {/* Tag Name Selector */}
            <div className='flex-1'>
              <Select
                value={filter.tagName}
                onValueChange={(value) => updateFilter(filter.id, 'tagName', value)}
                disabled={disabled || isConnecting || isLoading}
              >
                <SelectTrigger className='h-8 text-sm'>
                  <SelectValue placeholder='Select tag' />
                </SelectTrigger>
                <SelectContent>
                  {tagDefinitions.map((tag) => (
                    <SelectItem key={tag.id} value={tag.displayName}>
                      {tag.displayName}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Tag Value Input */}
            <div className='flex-1'>
              <Input
                value={filter.tagValue}
                onChange={(e) => updateFilter(filter.id, 'tagValue', e.target.value)}
                placeholder={filter.tagName ? `Enter ${filter.tagName} value` : 'Enter value'}
                disabled={disabled || isConnecting}
                className='h-8 text-sm'
              />
            </div>

            {/* Remove Button */}
            <Button
              type='button'
              variant='ghost'
              size='sm'
              onClick={() => removeFilter(filter.id)}
              disabled={disabled || isConnecting}
              className='h-8 w-8 p-0 text-muted-foreground hover:text-destructive'
            >
              <X className='h-3 w-3' />
            </Button>
          </div>
        ))}
      </div>
    </div>
  )
}
