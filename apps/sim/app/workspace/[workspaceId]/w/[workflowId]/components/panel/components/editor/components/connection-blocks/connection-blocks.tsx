'use client'

import { useCallback, useMemo, useRef, useState } from 'react'
import {
  ChipInput,
  cn,
  handleKeyboardActivation,
  thinScrollbarClass,
  toast,
  useCopyToClipboard,
} from '@sim/emcn'
import { Box, ChevronDown, Repeat, Search, Split } from '@sim/emcn/icons'
import { createLogger } from '@sim/logger'
import { WorkflowTypeTag } from '@sim/workflow-renderer'
import { useShallow } from 'zustand/react/shallow'
import {
  FieldItem,
  type SchemaField,
} from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/editor/components/connection-blocks/components/field-item/field-item'
import type { ConnectedBlock } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/editor/hooks/use-block-connections'
import { useBlockOutputFields } from '@/app/workspace/[workspaceId]/w/[workflowId]/hooks/use-block-output-fields'
import { getBlock } from '@/blocks/registry'
import { normalizeName } from '@/executor/constants'
import { useWorkflowRegistry } from '@/stores/workflows/registry/store'
import { EMPTY_SUBBLOCK_VALUES, useSubBlockStore } from '@/stores/workflows/subblock/store'
import { useWorkflowStore } from '@/stores/workflows/workflow/store'

const logger = createLogger('ConnectionBlocks')

interface ConnectionBlocksProps {
  connections: ConnectedBlock[]
}

interface FieldTreeNodesProps {
  fields: SchemaField[]
  parentPath: string
  connection: ConnectedBlock
  isFieldExpanded: (connectionId: string, fieldPath: string) => boolean
  onToggleFieldExpansion: (connectionId: string, fieldPath: string) => void
  onSelectReference: (reference: string) => void
}

function FieldTreeNodes({
  fields,
  parentPath,
  connection,
  isFieldExpanded,
  onToggleFieldExpansion,
  onSelectReference,
}: FieldTreeNodesProps) {
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
          hasChildren={hasChildren}
          isExpanded={expanded}
          onToggleExpand={(p) => onToggleFieldExpansion(connection.id, p)}
          onSelectReference={onSelectReference}
        />
        {hasChildren && expanded && (
          <div className='relative mt-0.5 ml-1.5 space-y-0.5 pl-2.5'>
            <div className='pointer-events-none absolute top-1 bottom-1 left-0 w-px bg-[var(--border)]' />
            <FieldTreeNodes
              fields={field.children!}
              parentPath={fieldPath}
              connection={connection}
              isFieldExpanded={isFieldExpanded}
              onToggleFieldExpansion={onToggleFieldExpansion}
              onSelectReference={onSelectReference}
            />
          </div>
        )}
      </div>
    )
  })
}

interface ConnectionItemProps {
  connection: ConnectedBlock
  isExpanded: boolean
  onToggleExpand: (connectionId: string) => void
  isFieldExpanded: (connectionId: string, fieldPath: string) => boolean
  onToggleFieldExpansion: (connectionId: string, fieldPath: string) => void
  onConnectionDragStart: (e: React.DragEvent, connection: ConnectedBlock) => void
  connectionRef: (el: HTMLDivElement | null) => void
  mergedSubBlocks: Record<string, any>
  sourceBlock: { triggerMode?: boolean } | undefined
  onSelectReference: (reference: string) => void
}

/**
 * Individual connection item component that uses the hook
 */
function ConnectionItem({
  connection,
  isExpanded,
  onToggleExpand,
  isFieldExpanded,
  onToggleFieldExpansion,
  onConnectionDragStart,
  connectionRef,
  mergedSubBlocks,
  sourceBlock,
  onSelectReference,
}: ConnectionItemProps) {
  const blockConfig = getBlock(connection.type)

  const fields = useBlockOutputFields({
    blockId: connection.id,
    blockType: connection.type,
    mergedSubBlocks,
    triggerMode: sourceBlock?.triggerMode,
  })
  const hasFields = fields.length > 0

  const Icon =
    blockConfig?.icon ??
    (connection.type === 'loop' ? Repeat : connection.type === 'parallel' ? Split : Box)
  const reference = `<${normalizeName(connection.name)}>`
  return (
    <div className='mb-0.5 last:mb-0' ref={connectionRef}>
      <div
        role='treeitem'
        aria-expanded={hasFields ? isExpanded : undefined}
        tabIndex={0}
        draggable
        onDragStart={(e) => onConnectionDragStart(e, connection)}
        className={cn(
          'group flex h-[26px] cursor-grab items-center gap-2 rounded-lg px-1.5 text-sm hover-hover:bg-[var(--surface-6)] active:cursor-grabbing dark:hover-hover:bg-[var(--surface-5)]',
          hasFields ? 'cursor-pointer' : 'cursor-copy'
        )}
        onClick={() => (hasFields ? onToggleExpand(connection.id) : onSelectReference(reference))}
        onKeyDown={(event) => {
          handleKeyboardActivation(event, () =>
            hasFields ? onToggleExpand(connection.id) : onSelectReference(reference)
          )
        }}
      >
        <WorkflowTypeTag
          type={connection.type}
          typeLabel={connection.name}
          Icon={Icon}
          iconBgColor={blockConfig?.bgColor ?? ''}
          isIntegration={blockConfig?.category === 'tools'}
        />
        <span
          className={cn(
            'truncate font-medium',
            'text-[var(--text-secondary)] group-hover:text-[var(--text-primary)]'
          )}
        >
          {connection.name}
        </span>
        {hasFields && (
          <ChevronDown
            className={cn(
              'size-[8px] flex-shrink-0 text-[var(--text-tertiary)] transition-transform duration-100 group-hover:text-[var(--text-primary)]',
              !isExpanded && '-rotate-90'
            )}
          />
        )}
      </div>

      {isExpanded && hasFields && (
        <div className='relative mt-0.5 ml-3 space-y-0.5 pl-2.5'>
          <div className='pointer-events-none absolute top-1 bottom-1 left-0 w-px bg-[var(--border)]' />
          <FieldTreeNodes
            fields={fields}
            parentPath=''
            connection={connection}
            isFieldExpanded={isFieldExpanded}
            onToggleFieldExpansion={onToggleFieldExpansion}
            onSelectReference={onSelectReference}
          />
        </div>
      )}
    </div>
  )
}

/**
 * Connection blocks component that displays incoming connections with their schemas
 */
export function ConnectionBlocks({ connections }: ConnectionBlocksProps) {
  const [expandedConnections, setExpandedConnections] = useState<Set<string>>(() => new Set())
  const [expandedFieldPaths, setExpandedFieldPaths] = useState<Set<string>>(() => new Set())
  const [searchQuery, setSearchQuery] = useState('')
  const scrollContainerRef = useRef<HTMLDivElement>(null)
  const connectionRefs = useRef<Map<string, HTMLDivElement>>(new Map())
  const { copy } = useCopyToClipboard({ resetMs: 1500 })

  const { blocks } = useWorkflowStore(
    useShallow((state) => ({
      blocks: state.blocks,
    }))
  )

  const workflowId = useWorkflowRegistry((state) => state.activeWorkflowId)
  const workflowSubBlockValues = useSubBlockStore((state) =>
    workflowId ? (state.workflowValues[workflowId] ?? EMPTY_SUBBLOCK_VALUES) : EMPTY_SUBBLOCK_VALUES
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

  const handleSelectReference = async (reference: string) => {
    if (await copy(reference)) {
      toast.success('Reference copied')
    }
  }

  const handleConnectionDragStart = useCallback(
    (e: React.DragEvent, connection: ConnectedBlock) => {
      const normalizedBlockName = normalizeName(connection.name)

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

  const normalizedQuery = searchQuery.trim().toLowerCase()
  const filteredConnections = useMemo(
    () =>
      normalizedQuery
        ? connections.filter((connection) =>
            connection.name.toLowerCase().includes(normalizedQuery)
          )
        : connections,
    [connections, normalizedQuery]
  )

  if (!connections || connections.length === 0) {
    return null
  }

  const directConnections = filteredConnections.filter((connection) => connection.distance === 1)
  const earlierConnections = filteredConnections.filter((connection) => connection.distance > 1)

  const renderConnections = (items: ConnectedBlock[]) =>
    items.map((connection) => {
      const mergedSubBlocks = getMergedSubBlocks(connection.id)
      const sourceBlock = blocks[connection.id]

      return (
        <ConnectionItem
          key={connection.id}
          connection={connection}
          isExpanded={expandedConnections.has(connection.id)}
          onToggleExpand={toggleConnectionExpansion}
          isFieldExpanded={isFieldExpanded}
          onToggleFieldExpansion={toggleFieldExpansion}
          onConnectionDragStart={handleConnectionDragStart}
          onSelectReference={handleSelectReference}
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
    })

  return (
    <div className='flex min-h-0 flex-col'>
      <div className='px-3 py-2'>
        <ChipInput
          icon={Search}
          value={searchQuery}
          onChange={(event) => setSearchQuery(event.target.value)}
          placeholder='Search sources...'
          aria-label='Search available data sources'
        />
        <p className='mt-1.5 px-1 text-[var(--text-muted)] text-micro'>
          Drag into a field, or click an output to copy its reference.
        </p>
      </div>
      <div
        ref={scrollContainerRef}
        className={cn('max-h-[280px] overflow-y-auto px-3 pb-3', thinScrollbarClass)}
      >
        {filteredConnections.length === 0 ? (
          <div className='py-6 text-center text-[var(--text-muted)] text-small'>
            No matching sources
          </div>
        ) : (
          <div className='space-y-3'>
            {directConnections.length > 0 && (
              <section aria-labelledby='direct-data-sources'>
                <h3
                  id='direct-data-sources'
                  className='mb-1 px-1.5 font-medium text-[var(--text-muted)] text-micro'
                >
                  {directConnections.length === 1 ? 'Previous step' : 'Previous steps'}
                </h3>
                <div className='space-y-0.5'>{renderConnections(directConnections)}</div>
              </section>
            )}
            {earlierConnections.length > 0 && (
              <section aria-labelledby='earlier-data-sources'>
                <h3
                  id='earlier-data-sources'
                  className='mb-1 px-1.5 font-medium text-[var(--text-muted)] text-micro'
                >
                  Earlier steps
                </h3>
                <div className='space-y-0.5'>{renderConnections(earlierConnections)}</div>
              </section>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
