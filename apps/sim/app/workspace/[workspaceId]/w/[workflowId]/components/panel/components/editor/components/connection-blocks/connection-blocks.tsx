'use client'

import { useCallback, useRef, useState } from 'react'
import { createLogger } from '@sim/logger'
import clsx from 'clsx'
import { RepeatIcon, SplitIcon } from 'lucide-react'
import { useShallow } from 'zustand/react/shallow'
import { ChevronDown } from '@/components/emcn'
import {
  FieldItem,
  type SchemaField,
} from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/editor/components/connection-blocks/components/field-item/field-item'
import type { ConnectedBlock } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/editor/hooks/use-block-connections'
import { useBlockOutputFields } from '@/app/workspace/[workspaceId]/w/[workflowId]/hooks/use-block-output-fields'
import { getBlock } from '@/blocks/registry'
import { useWorkflowRegistry } from '@/stores/workflows/registry/store'
import { useSubBlockStore } from '@/stores/workflows/subblock/store'
import { useWorkflowStore } from '@/stores/workflows/workflow/store'

const logger = createLogger('ConnectionBlocks')

interface ConnectionBlocksProps {
  connections: ConnectedBlock[]
  currentBlockId: string
}

interface ConnectionItemProps {
  connection: ConnectedBlock
  isExpanded: boolean
  onToggleExpand: (connectionId: string) => void
  isFieldExpanded: (connectionId: string, fieldPath: string) => boolean
  onConnectionDragStart: (e: React.DragEvent, connection: ConnectedBlock) => void
  renderFieldTree: (
    fields: SchemaField[],
    parentPath: string,
    level: number,
    connection: ConnectedBlock
  ) => React.ReactNode
  connectionRef: (el: HTMLDivElement | null) => void
  mergedSubBlocks: Record<string, any>
  sourceBlock: { triggerMode?: boolean } | undefined
}

/**
 * Individual connection item component that uses the hook
 */
function ConnectionItem({
  connection,
  isExpanded,
  onToggleExpand,
  isFieldExpanded,
  onConnectionDragStart,
  renderFieldTree,
  connectionRef,
  mergedSubBlocks,
  sourceBlock,
}: ConnectionItemProps) {
  const blockConfig = getBlock(connection.type)

  const fields = useBlockOutputFields({
    blockId: connection.id,
    blockType: connection.type,
    mergedSubBlocks,
    responseFormat: connection.responseFormat,
    operation: connection.operation,
    triggerMode: sourceBlock?.triggerMode,
  })
  const hasFields = fields.length > 0

  let Icon = blockConfig?.icon
  let bgColor = blockConfig?.bgColor || '#6B7280'

  if (!blockConfig) {
    if (connection.type === 'loop') {
      Icon = RepeatIcon as typeof Icon
      bgColor = '#2FB3FF'
    } else if (connection.type === 'parallel') {
      Icon = SplitIcon as typeof Icon
      bgColor = '#FEE12B'
    }
  }

  return (
    <div className='mb-[2px] last:mb-0' ref={connectionRef}>
      <div
        draggable
        onDragStart={(e) => onConnectionDragStart(e, connection)}
        className={clsx(
          'group flex h-[26px] cursor-grab items-center gap-[8px] rounded-[8px] px-[6px] text-[14px] hover:bg-[var(--surface-6)] active:cursor-grabbing dark:hover:bg-[var(--surface-5)]',
          hasFields && 'cursor-pointer'
        )}
        onClick={() => hasFields && onToggleExpand(connection.id)}
      >
        <div
          className='relative flex h-[14px] w-[14px] flex-shrink-0 items-center justify-center overflow-hidden rounded-[4px]'
          style={{ background: bgColor }}
        >
          {Icon && (
            <Icon
              className={clsx(
                'text-white transition-transform duration-200',
                hasFields && 'group-hover:scale-110',
                '!h-[9px] !w-[9px]'
              )}
            />
          )}
        </div>
        <span
          className={clsx(
            'truncate font-medium',
            'text-[var(--text-secondary)] group-hover:text-[var(--text-primary)]'
          )}
        >
          {connection.name}
        </span>
        {hasFields && (
          <ChevronDown
            className={clsx(
              'h-[8px] w-[8px] flex-shrink-0 text-[var(--text-tertiary)] transition-transform duration-100 group-hover:text-[var(--text-primary)]',
              !isExpanded && '-rotate-90'
            )}
          />
        )}
      </div>

      {isExpanded && hasFields && (
        <div className='relative mt-[2px] ml-[12px] space-y-[2px] pl-[10px]'>
          <div className='pointer-events-none absolute top-[4px] bottom-[4px] left-0 w-px bg-[var(--border)]' />
          {renderFieldTree(fields, '', 0, connection)}
        </div>
      )}
    </div>
  )
}

/**
 * Connection blocks component that displays incoming connections with their schemas
 */
export function ConnectionBlocks({ connections, currentBlockId }: ConnectionBlocksProps) {
  const [expandedConnections, setExpandedConnections] = useState<Set<string>>(new Set())
  const [expandedFieldPaths, setExpandedFieldPaths] = useState<Set<string>>(new Set())
  const scrollContainerRef = useRef<HTMLDivElement>(null)
  const connectionRefs = useRef<Map<string, HTMLDivElement>>(new Map())

  const { blocks } = useWorkflowStore(
    useShallow((state) => ({
      blocks: state.blocks,
    }))
  )

  const workflowId = useWorkflowRegistry((state) => state.activeWorkflowId)
  const workflowSubBlockValues = useSubBlockStore((state) =>
    workflowId ? (state.workflowValues[workflowId] ?? {}) : {}
  )

  const getMergedSubBlocks = useCallback(
    (sourceBlockId: string): Record<string, any> => {
      const base = blocks[sourceBlockId]?.subBlocks || {}
      const live = workflowSubBlockValues?.[sourceBlockId] || {}
      const merged: Record<string, any> = { ...base }
      for (const [subId, liveVal] of Object.entries(live)) {
        merged[subId] = { ...(base[subId] || {}), value: liveVal }
      }
      return merged
    },
    [blocks, workflowSubBlockValues]
  )

  const toggleConnectionExpansion = useCallback((connectionId: string) => {
    setExpandedConnections((prev) => {
      const newSet = new Set(prev)
      const isExpanding = !newSet.has(connectionId)

      if (newSet.has(connectionId)) {
        newSet.delete(connectionId)
      } else {
        newSet.add(connectionId)
      }

      if (isExpanding) {
        setTimeout(() => {
          const connectionElement = connectionRefs.current.get(connectionId)
          const scrollContainer = scrollContainerRef.current

          if (connectionElement && scrollContainer) {
            const containerRect = scrollContainer.getBoundingClientRect()
            const elementRect = connectionElement.getBoundingClientRect()
            const scrollOffset = elementRect.top - containerRect.top + scrollContainer.scrollTop

            scrollContainer.scrollTo({
              top: scrollOffset,
              behavior: 'smooth',
            })
          }
        }, 0)
      }

      return newSet
    })
  }, [])

  const toggleFieldExpansion = useCallback((connectionId: string, fieldPath: string) => {
    setExpandedFieldPaths((prev) => {
      const next = new Set(prev)
      const key = `${connectionId}|${fieldPath}`
      if (next.has(key)) {
        next.delete(key)
      } else {
        next.add(key)
      }
      return next
    })
  }, [])

  const isFieldExpanded = useCallback(
    (connectionId: string, fieldPath: string) =>
      expandedFieldPaths.has(`${connectionId}|${fieldPath}`),
    [expandedFieldPaths]
  )

  const handleConnectionDragStart = useCallback(
    (e: React.DragEvent, connection: ConnectedBlock) => {
      const normalizedBlockName = connection.name.replace(/\s+/g, '').toLowerCase()

      e.dataTransfer.setData(
        'application/json',
        JSON.stringify({
          type: 'connectionBlock',
          connectionData: {
            sourceBlockId: connection.id,
            tag: normalizedBlockName,
            blockName: connection.name,
            fieldName: null,
            fieldType: 'connection',
          },
        })
      )
      e.dataTransfer.effectAllowed = 'copy'

      logger.info('Connection block drag started', {
        tag: normalizedBlockName,
        blockName: connection.name,
      })
    },
    []
  )

  const renderFieldTree = useCallback(
    (fields: SchemaField[], parentPath: string, level: number, connection: ConnectedBlock) => {
      return fields.map((field) => {
        const fieldPath = parentPath ? `${parentPath}.${field.name}` : field.name
        const hasChildren = !!(field.children && field.children.length > 0)
        const expanded = isFieldExpanded(connection.id, fieldPath)

        return (
          <div key={fieldPath}>
            <FieldItem
              connection={connection}
              field={field}
              path={fieldPath}
              level={level}
              hasChildren={hasChildren}
              isExpanded={expanded}
              onToggleExpand={(p) => toggleFieldExpansion(connection.id, p)}
            />
            {hasChildren && expanded && (
              <div className='relative mt-[2px] ml-[6px] space-y-[2px] pl-[10px]'>
                <div className='pointer-events-none absolute top-[4px] bottom-[4px] left-0 w-px bg-[var(--border)]' />
                {renderFieldTree(field.children!, fieldPath, level + 1, connection)}
              </div>
            )}
          </div>
        )
      })
    },
    [isFieldExpanded, toggleFieldExpansion]
  )

  if (!connections || connections.length === 0) {
    return null
  }

  return (
    <div ref={scrollContainerRef} className='space-y-[2px]'>
      {connections.map((connection) => {
        const mergedSubBlocks = getMergedSubBlocks(connection.id)
        const sourceBlock = blocks[connection.id]

        return (
          <ConnectionItem
            key={connection.id}
            connection={connection}
            isExpanded={expandedConnections.has(connection.id)}
            onToggleExpand={toggleConnectionExpansion}
            isFieldExpanded={isFieldExpanded}
            onConnectionDragStart={handleConnectionDragStart}
            renderFieldTree={renderFieldTree}
            connectionRef={(el) => {
              if (el) {
                connectionRefs.current.set(connection.id, el)
              } else {
                connectionRefs.current.delete(connection.id)
              }
            }}
            mergedSubBlocks={mergedSubBlocks}
            sourceBlock={sourceBlock}
          />
        )
      })}
    </div>
  )
}
