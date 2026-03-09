'use client'

import { useCallback } from 'react'
import { createLogger } from '@sim/logger'
import clsx from 'clsx'
import { ChevronDown } from 'lucide-react'
import { Badge } from '@/components/emcn'
import type { ConnectedBlock } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/editor/hooks/use-block-connections'

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
        'group flex h-[26px] cursor-grab items-center gap-[8px] rounded-[8px] px-[6px] text-[14px] hover:bg-[var(--surface-6)] active:cursor-grabbing dark:hover:bg-[var(--surface-5)]',
        hasChildren && 'cursor-pointer'
      )}
    >
      <span
        className={clsx(
          'min-w-0 flex-1 truncate font-medium',
          'text-[var(--text-secondary)] group-hover:text-[var(--text-primary)]'
        )}
      >
        {field.name}
      </span>
      <Badge className='flex-shrink-0 rounded-[4px] px-[6px] py-[1px] font-mono text-[11px]'>
        {field.type}
      </Badge>
      {hasChildren && (
        <ChevronDown
          className={clsx(
            'h-3.5 w-3.5 flex-shrink-0 transition-transform duration-100',
            'text-[var(--text-secondary)] group-hover:text-[var(--text-primary)]',
            isExpanded && 'rotate-180'
          )}
        />
      )}
    </div>
  )
}
