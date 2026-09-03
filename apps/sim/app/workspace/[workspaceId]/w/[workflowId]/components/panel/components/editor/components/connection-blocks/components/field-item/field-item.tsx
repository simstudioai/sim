'use client'

import { useCallback } from 'react'
import { Badge, cn, handleKeyboardActivation } from '@sim/emcn'
import { ChevronDown } from '@sim/emcn/icons'
import { createLogger } from '@sim/logger'
import type { ConnectedBlock } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/editor/hooks/use-block-connections'
import { normalizeName } from '@/executor/constants'

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
  hasChildren,
  isExpanded,
  onToggleExpand,
}: FieldItemProps) {
  const handleDragStart = useCallback(
    (e: React.DragEvent) => {
      const normalizedBlockName = normalizeName(connection.name)
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
      role='treeitem'
      aria-expanded={hasChildren ? isExpanded : undefined}
      tabIndex={hasChildren ? 0 : undefined}
      draggable
      onDragStart={handleDragStart}
      onClick={handleClick}
      onKeyDown={(event) => {
        if (!hasChildren) return
        handleKeyboardActivation(event, handleClick)
      }}
      className={cn(
        'group flex h-[26px] cursor-grab items-center gap-2 rounded-lg px-1.5 text-sm hover-hover:bg-[var(--surface-6)] active:cursor-grabbing dark:hover-hover:bg-[var(--surface-5)]',
        hasChildren && 'cursor-pointer'
      )}
    >
      <span
        className={cn(
          'min-w-0 flex-1 truncate',
          'text-[var(--text-secondary)] group-hover:text-[var(--text-primary)]'
        )}
      >
        {field.name}
      </span>
      <Badge className='shrink-0 rounded-sm px-1.5 py-[1px] font-mono text-xs'>{field.type}</Badge>
      {hasChildren && (
        <ChevronDown
          className={cn(
            'size-[14px] shrink-0 transition-transform duration-100',
            'text-[var(--text-secondary)] group-hover:text-[var(--text-primary)]',
            isExpanded && 'rotate-180'
          )}
        />
      )}
    </div>
  )
}
