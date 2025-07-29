'use client'

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

interface KnowledgeTagFilterProps {
  blockId: string
  subBlock: SubBlockConfig
  disabled?: boolean
  isPreview?: boolean
  previewValue?: string | null
  isConnecting?: boolean
}

export function KnowledgeTagFilter({
  blockId,
  subBlock,
  disabled = false,
  isPreview = false,
  previewValue,
  isConnecting = false,
}: KnowledgeTagFilterProps) {
  const [storeValue, setStoreValue] = useSubBlockValue(blockId, subBlock.id)

  // Get the knowledge base ID and document ID from other sub-blocks
  const [knowledgeBaseIdValue] = useSubBlockValue(blockId, 'knowledgeBaseIds')
  const [knowledgeBaseIdSingleValue] = useSubBlockValue(blockId, 'knowledgeBaseId')
  const [documentIdValue] = useSubBlockValue(blockId, 'documentId')

  // Determine which knowledge base ID to use
  const knowledgeBaseId =
    knowledgeBaseIdSingleValue ||
    (typeof knowledgeBaseIdValue === 'string' ? knowledgeBaseIdValue.split(',')[0] : null)

  // Use KB tag definitions hook to get available tags
  const { tagDefinitions, isLoading, getTagLabel } = useKnowledgeBaseTagDefinitions(knowledgeBaseId)

  // Parse the current value to extract tag name and value
  const parseTagFilter = (filterValue: string) => {
    if (!filterValue) return { tagName: '', tagValue: '' }
    const [tagName, ...valueParts] = filterValue.split(':')
    return { tagName: tagName?.trim() || '', tagValue: valueParts.join(':').trim() || '' }
  }

  const currentValue = isPreview ? previewValue : storeValue
  const { tagName, tagValue } = parseTagFilter(currentValue || '')

  const handleTagNameChange = (newTagName: string) => {
    if (isPreview) return
    const newValue =
      newTagName && tagValue ? `${newTagName}:${tagValue}` : newTagName || tagValue || ''
    setStoreValue(newValue.trim() || null)
  }

  const handleTagValueChange = (newTagValue: string) => {
    if (isPreview) return
    const newValue =
      tagName && newTagValue ? `${tagName}:${newTagValue}` : tagName || newTagValue || ''
    setStoreValue(newValue.trim() || null)
  }

  if (isPreview) {
    return (
      <div className='space-y-1'>
        <Label className='font-medium text-muted-foreground text-xs'>Tag Filter</Label>
        <Input
          value={currentValue || ''}
          disabled
          placeholder='Tag filter preview'
          className='text-sm'
        />
      </div>
    )
  }

  return (
    <div className='space-y-2'>
      {/* Tag Name Selector */}
      <Select
        value={tagName}
        onValueChange={handleTagNameChange}
        disabled={disabled || isConnecting || isLoading}
      >
        <SelectTrigger className='text-sm'>
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

      {/* Tag Value Input - only show if tag is selected */}
      {tagName && (
        <Input
          value={tagValue}
          onChange={(e) => handleTagValueChange(e.target.value)}
          placeholder={`Enter ${tagName} value`}
          disabled={disabled || isConnecting}
          className='text-sm'
        />
      )}
    </div>
  )
}
