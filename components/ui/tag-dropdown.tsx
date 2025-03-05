import React, { useEffect, useMemo, useState } from 'react'
import { cn } from '@/lib/utils'
import { useSubBlockStore } from '@/stores/workflows/subblock/store'
import { useWorkflowStore } from '@/stores/workflows/workflow/store'

interface Field {
  name: string
  type: string
  description?: string
}

interface Metric {
  name: string
  description: string
  range: {
    min: number
    max: number
  }
}

interface TagDropdownProps {
  visible: boolean
  onSelect: (newValue: string) => void
  blockId: string
  activeSourceBlockId: string | null
  className?: string
  inputValue: string
  cursorPosition: number
  onClose?: () => void
  style?: React.CSSProperties
}

export const TagDropdown: React.FC<TagDropdownProps> = ({
  visible,
  onSelect,
  blockId,
  activeSourceBlockId,
  className,
  inputValue,
  cursorPosition,
  onClose,
  style,
}) => {
  const [selectedIndex, setSelectedIndex] = useState(0)

  // Get available tags from workflow state
  const blocks = useWorkflowStore((state) => state.blocks)
  const edges = useWorkflowStore((state) => state.edges)

  // Extract search term from input
  const searchTerm = useMemo(() => {
    const textBeforeCursor = inputValue.slice(0, cursorPosition)
    const match = textBeforeCursor.match(/<([^>]*)$/)
    return match ? match[1].toLowerCase() : ''
  }, [inputValue, cursorPosition])

  // Get source block and compute tags
  const { tags } = useMemo(() => {
    // Helper function to get output paths
    const getOutputPaths = (obj: any, prefix = '', isStarterBlock = false): string[] => {
      if (typeof obj !== 'object' || obj === null) {
        return prefix ? [prefix] : []
      }

      // Special handling for starter block.
      // TODO: In the future, we will support response formats and required input types. For now, we just take the input altogether.
      if (isStarterBlock && prefix === 'response') {
        return ['response.input']
      }

      if ('type' in obj && typeof obj.type === 'string') {
        return [prefix]
      }

      return Object.entries(obj).flatMap(([key, value]) => {
        const newPrefix = prefix ? `${prefix}.${key}` : key
        return getOutputPaths(value, newPrefix, isStarterBlock)
      })
    }

    // If we have an active source block ID from a drop, use that specific block only
    if (activeSourceBlockId) {
      const sourceBlock = blocks[activeSourceBlockId]
      if (!sourceBlock) return { tags: [] }

      const blockName = sourceBlock.name || sourceBlock.type
      const normalizedBlockName = blockName.replace(/\s+/g, '').toLowerCase()

      // First check for evaluator metrics
      if (sourceBlock.type === 'evaluator') {
        try {
          const metricsValue = useSubBlockStore
            .getState()
            .getValue(activeSourceBlockId, 'metrics') as unknown as Metric[]
          if (Array.isArray(metricsValue)) {
            return {
              tags: metricsValue.map(
                (metric) => `${normalizedBlockName}.response.${metric.name.toLowerCase()}`
              ),
            }
          }
        } catch (e) {
          console.error('Error parsing metrics:', e)
        }
      }

      // Then check for response format
      try {
        const responseFormatValue = useSubBlockStore
          .getState()
          .getValue(activeSourceBlockId, 'responseFormat')
        if (typeof responseFormatValue === 'string' && responseFormatValue) {
          const responseFormat = JSON.parse(responseFormatValue)
          if (responseFormat?.fields) {
            return {
              tags: responseFormat.fields.map(
                (field: Field) => `${normalizedBlockName}.${field.name}`
              ),
            }
          }
        }
      } catch (e) {
        console.error('Error parsing response format:', e)
      }

      // Fall back to default outputs if no response format
      const outputPaths = getOutputPaths(sourceBlock.outputs, '', sourceBlock.type === 'starter')
      return {
        tags: outputPaths.map((path) => `${normalizedBlockName}.${path}`),
      }
    }

    // Otherwise, show tags from all incoming connections
    const sourceEdges = edges.filter((edge) => edge.target === blockId)
    const sourceTags = sourceEdges.flatMap((edge) => {
      const sourceBlock = blocks[edge.source]
      if (!sourceBlock) return []

      const blockName = sourceBlock.name || sourceBlock.type
      const normalizedBlockName = blockName.replace(/\s+/g, '').toLowerCase()

      // Check for response format first
      try {
        const responseFormatValue = useSubBlockStore
          .getState()
          .getValue(edge.source, 'responseFormat')
        if (typeof responseFormatValue === 'string' && responseFormatValue) {
          const responseFormat = JSON.parse(responseFormatValue)
          if (responseFormat?.fields) {
            return responseFormat.fields.map(
              (field: Field) => `${normalizedBlockName}.${field.name}`
            )
          }
        }
      } catch (e) {
        console.error('Error parsing response format:', e)
      }

      if (sourceBlock.type === 'evaluator') {
        try {
          const metricsValue = useSubBlockStore
            .getState()
            .getValue(edge.source, 'metrics') as unknown as Metric[]
          if (Array.isArray(metricsValue)) {
            return metricsValue.map(
              (metric) => `${normalizedBlockName}.response.${metric.name.toLowerCase()}`
            )
          }
        } catch (e) {
          console.error('Error parsing metrics:', e)
          return []
        }
      }

      // Fall back to default outputs if no response format
      const outputPaths = getOutputPaths(sourceBlock.outputs, '', sourceBlock.type === 'starter')
      return outputPaths.map((path) => `${normalizedBlockName}.${path}`)
    })

    return { tags: sourceTags }
  }, [blocks, edges, blockId, activeSourceBlockId])

  // Filter tags based on search term
  const filteredTags = useMemo(() => {
    if (!searchTerm) return tags
    return tags.filter((tag: string) => tag.toLowerCase().includes(searchTerm))
  }, [tags, searchTerm])

  // Reset selection when filtered results change
  useEffect(() => {
    setSelectedIndex(0)
  }, [searchTerm])

  // Handle tag selection
  const handleTagSelect = (tag: string) => {
    const textBeforeCursor = inputValue.slice(0, cursorPosition)
    const textAfterCursor = inputValue.slice(cursorPosition)

    // Find the position of the last '<' before cursor
    const lastOpenBracket = textBeforeCursor.lastIndexOf('<')
    if (lastOpenBracket === -1) return

    const newValue = textBeforeCursor.slice(0, lastOpenBracket) + '<' + tag + '>' + textAfterCursor

    onSelect(newValue)
    onClose?.()
  }

  // Add and remove keyboard event listener
  useEffect(() => {
    if (visible) {
      const handleKeyboardEvent = (e: KeyboardEvent) => {
        if (!filteredTags.length) return

        switch (e.key) {
          case 'ArrowDown':
            e.preventDefault()
            e.stopPropagation()
            setSelectedIndex((prev) => (prev < filteredTags.length - 1 ? prev + 1 : prev))
            break
          case 'ArrowUp':
            e.preventDefault()
            e.stopPropagation()
            setSelectedIndex((prev) => (prev > 0 ? prev - 1 : prev))
            break
          case 'Enter':
            e.preventDefault()
            e.stopPropagation()
            handleTagSelect(filteredTags[selectedIndex])
            break
          case 'Escape':
            e.preventDefault()
            e.stopPropagation()
            onClose?.()
            break
        }
      }

      window.addEventListener('keydown', handleKeyboardEvent, true)
      return () => window.removeEventListener('keydown', handleKeyboardEvent, true)
    }
  }, [visible, selectedIndex, filteredTags])

  // Don't render if not visible or no tags
  if (!visible || tags.length === 0 || filteredTags.length === 0) return null

  return (
    <div
      className={cn(
        'absolute z-[9999] w-full mt-1 overflow-hidden bg-popover rounded-md border shadow-md',
        className
      )}
      style={style}
    >
      <div className="py-1">
        {filteredTags.length === 0 ? (
          <div className="px-3 py-2 text-sm text-muted-foreground">No matching tags found</div>
        ) : (
          filteredTags.map((tag: string, index: number) => (
            <button
              key={tag}
              className={cn(
                'w-full px-3 py-1.5 text-sm text-left',
                'hover:bg-accent hover:text-accent-foreground',
                'focus:bg-accent focus:text-accent-foreground focus:outline-none',
                index === selectedIndex && 'bg-accent text-accent-foreground'
              )}
              onMouseEnter={() => setSelectedIndex(index)}
              onMouseDown={(e) => {
                e.preventDefault() // Prevent input blur
                handleTagSelect(tag)
              }}
            >
              {tag}
            </button>
          ))
        )}
      </div>
    </div>
  )
}

// Helper function to check for '<' trigger
export const checkTagTrigger = (text: string, cursorPosition: number): { show: boolean } => {
  if (cursorPosition >= 1) {
    const textBeforeCursor = text.slice(0, cursorPosition)
    const lastOpenBracket = textBeforeCursor.lastIndexOf('<')
    const lastCloseBracket = textBeforeCursor.lastIndexOf('>')

    // Show if we have an unclosed '<' that's not part of a completed tag
    if (lastOpenBracket !== -1 && (lastCloseBracket === -1 || lastCloseBracket < lastOpenBracket)) {
      return { show: true }
    }
  }
  return { show: false }
}
