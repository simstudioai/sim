'use client'

import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import type { SubBlockConfig } from '@/blocks/types'
import { useTagDefinitions } from '@/hooks/use-tag-definitions'
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

  // Use tag definitions hook to get custom label
  const { getTagLabel } = useTagDefinitions(knowledgeBaseId, documentIdValue)

  // Extract tag slot from subBlock id (e.g., 'tag1', 'tag2', 'createTag1', etc.)
  const tagSlot = subBlock.id.startsWith('createTag')
    ? subBlock.id.replace('createTag', 'tag').toLowerCase()
    : subBlock.id

  // Get the custom label or fallback to default
  const customLabel = getTagLabel(tagSlot)

  // Use preview value if in preview mode, otherwise use store value
  const currentValue = isPreview ? previewValue : storeValue

  const handleChange = (value: string) => {
    if (isPreview) return
    setStoreValue(value.trim() || null)
  }

  // Get placeholder text
  const placeholder = subBlock.placeholder || `Filter by ${customLabel.toLowerCase()}`

  return (
    <div className='space-y-1'>
      <Label className='font-medium text-muted-foreground text-xs'>{customLabel}</Label>
      <Input
        type='text'
        value={currentValue || ''}
        onChange={(e) => handleChange(e.target.value)}
        placeholder={placeholder}
        disabled={disabled || isPreview}
        className='text-sm'
      />
    </div>
  )
}
