'use client'

import { useCallback } from 'react'
import clsx from 'clsx'
import { ChevronDown } from 'lucide-react'
import { Badge, buttonVariants } from '@/components/emcn'
import { createLogger } from '@/lib/logs/console/logger'
import type { ConnectedBlock } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel-new/components/editor/hooks/use-block-connections'

const logger = createLogger('FieldItem')

/**
 * Represents a schema field with optional nested children
 */
export interface SchemaField {
  name: string
  type: string
  description?: string
  children?: SchemaField[]
}

interface FieldItemProps {
  connection: ConnectedBlock
  field: SchemaField
  path: string
  level: number
  hasChildren?: boolean
  isExpanded?: boolean
  onToggleExpand?: (path: string) => void
}

/**
 * Tree layout constants shared with parent component
 */
export const TREE_SPACING = {
  INDENT_PER_LEVEL: 20,
  BASE_INDENT: 20,
  VERTICAL_LINE_LEFT_OFFSET: 4,
  ITEM_GAP: 4,
  ITEM_HEIGHT: 26,
} as const

/**
 * Individual field item component with drag functionality
 */
export function FieldItem({
  connection,
  field,
  path,
  level,
  hasChildren,
  isExpanded,
  onToggleExpand,
}: FieldItemProps) {
  const indent = TREE_SPACING.BASE_INDENT + level * TREE_SPACING.INDENT_PER_LEVEL

  const handleDragStart = useCallback(
    (e: React.DragEvent) => {
      const normalizedBlockName = connection.name.replace(/\s+/g, '').toLowerCase()
      const fullTag = `${normalizedBlockName}.${path}`

      e.dataTransfer.setData(
        'application/json',
        JSON.stringify({
          type: 'connectionBlock',
          connectionData: {
            sourceBlockId: connection.id,
            tag: fullTag,
            blockName: connection.name,
            fieldName: field.name,
            fieldType: field.type,
          },
        })
      )
      e.dataTransfer.effectAllowed = 'copy'

      logger.info('Field drag started', { tag: fullTag, field: field.name })
    },
    [connection, field, path]
  )

  const handleClick = useCallback(() => {
    if (hasChildren) {
      onToggleExpand?.(path)
    }
  }, [hasChildren, onToggleExpand, path])

  return (
    <div
      draggable
      onDragStart={handleDragStart}
      onClick={handleClick}
      className={clsx(
        buttonVariants({ variant: 'active' }),
        'group !px-[8px] inline-flex h-[26px] gap-[8px] rounded-[6px] text-[14px]',
        'cursor-grab active:cursor-grabbing',
        hasChildren && 'cursor-pointer'
      )}
      style={{ marginLeft: `${indent}px` }}
    >
      <span className='truncate'>{field.name}</span>
      <Badge className='rounded-[2px] px-[4px] py-[1px] font-mono text-[10px]'>{field.type}</Badge>
      {hasChildren && (
        <ChevronDown
          className={clsx(
            'h-4 w-4 flex-shrink-0 opacity-50 transition-transform',
            isExpanded && 'rotate-180'
          )}
        />
      )}
    </div>
  )
}
