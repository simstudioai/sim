'use client'

import { type MouseEvent, memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Icon } from '@sim/emcn/icon'
import { useScrollEdges } from '@sim/emcn/scroll-area/use-scroll-edges'
import { StatusText } from '@sim/emcn/status'
import { formatDuration } from '@sim/utils/formatting'
import { useVirtualizer } from '@tanstack/react-virtual'
import { BlockTile } from '@/app/(product)/workspace/[workspaceId]/workflows/_components/canvas/block-tile/block-tile'
import styles from '@/app/(product)/workspace/[workspaceId]/workflows/_components/terminal/log-list/log-list.module.css'
import {
  type ConsoleEntry,
  type EntryNode,
  type ExecutionGroup,
  flattenVisibleExecutionRows,
  getBlockColor,
  getBlockIcon,
  type VisibleTerminalRow,
} from '@/platform/lib/data/workflow-deploy/terminal'
import { useWorkflowStore } from '@/platform/lib/data/workflows'

/** A log row is a 30px chip; rows sit one list gap apart. */
const ROW_HEIGHT = 30
const ROW_GAP = 2
const OVERSCAN = 8
const MAX_TREE_DEPTH = 50

function hasMatchInTree(
  nodes: EntryNode[],
  predicate: (entry: ConsoleEntry) => boolean,
  depth = 0
): boolean {
  if (depth >= MAX_TREE_DEPTH) return false
  return nodes.some(
    (node) => predicate(node.entry) || hasMatchInTree(node.children, predicate, depth + 1)
  )
}

const hasErrorInTree = (nodes: EntryNode[]) => hasMatchInTree(nodes, (e) => Boolean(e.error))
const hasRunningInTree = (nodes: EntryNode[]) => hasMatchInTree(nodes, (e) => Boolean(e.isRunning))
const hasCanceledInTree = (nodes: EntryNode[]) =>
  hasMatchInTree(nodes, (e) => Boolean(e.isCanceled))

interface RowStatusProps {
  isRunning: boolean
  isCanceled: boolean
  durationMs: number | undefined
}

/** A row's end: Running while it runs, then canceled or its duration. */
function RowStatus({ isRunning, isCanceled, durationMs }: RowStatusProps) {
  if (isRunning) return <StatusText label='Running' intent='info' live />
  return (
    <span className={styles.duration} data-type='T052'>
      {isCanceled ? 'canceled' : (formatDuration(durationMs, { precision: 2 }) ?? '-')}
    </span>
  )
}

interface LogRowProps {
  node: EntryNode
  selectedEntryId: string | null
  expandedNodes: Set<string>
  onSelectEntry: (entry: ConsoleEntry) => void
  onToggleNode: (nodeId: string) => void
  onContextMenu: (entry: ConsoleEntry, event: MouseEvent) => void
}

/**
 * One row of a run: a block, a Loop or Parallel, one of its iterations, or a child workflow. A
 * container toggles its children; a block (or a workflow block) selects its output.
 */
const LogRow = memo(function LogRow({
  node,
  selectedEntryId,
  expandedNodes,
  onSelectEntry,
  onToggleNode,
  onContextMenu,
}: LogRowProps) {
  const { entry, children, nodeType, iterationInfo } = node
  const hasChildren = children.length > 0
  const isExpanded = expandedNodes.has(entry.id)
  const containerId = nodeType === 'subflow' ? entry.iterationContainerId : undefined
  const storeBlockName = useWorkflowStore((state) =>
    containerId ? state.blocks[containerId]?.name : undefined
  )

  const status = useMemo(() => {
    if (nodeType === 'block') {
      return {
        error: Boolean(entry.error),
        running: Boolean(entry.isRunning),
        canceled: Boolean(entry.isCanceled),
      }
    }
    if (nodeType === 'iteration') {
      const running = children.some((child) => child.entry.isRunning)
      return {
        error: Boolean(entry.error) || children.some((child) => child.entry.error),
        running,
        canceled: children.some((child) => child.entry.isCanceled) && !running,
      }
    }
    const self = nodeType === 'workflow'
    const running = (self && Boolean(entry.isRunning)) || hasRunningInTree(children)
    return {
      error: Boolean(entry.error) || hasErrorInTree(children),
      running,
      canceled: ((self && Boolean(entry.isCanceled)) || hasCanceledInTree(children)) && !running,
    }
  }, [nodeType, entry, children])

  const label =
    nodeType === 'iteration' && iterationInfo
      ? `Iteration ${iterationInfo.current + 1}${iterationInfo.total !== undefined ? ` / ${iterationInfo.total}` : ''}`
      : nodeType === 'subflow'
        ? storeBlockName || entry.blockName
        : entry.blockName
  const selectable = nodeType === 'block' || nodeType === 'workflow'
  const selected = selectable && selectedEntryId === entry.id

  return (
    <button
      type='button'
      className={styles.row}
      data-entry-id={entry.id}
      aria-current={selected ? 'true' : undefined}
      aria-expanded={hasChildren ? isExpanded : undefined}
      onClick={(event) => {
        event.stopPropagation()
        if (nodeType === 'block') onSelectEntry(entry)
        else if (nodeType === 'workflow') {
          if (!selected) onSelectEntry(entry)
          if (hasChildren) onToggleNode(entry.id)
        } else onToggleNode(entry.id)
      }}
      onContextMenu={selectable ? (event) => onContextMenu(entry, event) : undefined}
    >
      <span className={styles.content}>
        {nodeType !== 'iteration' && (
          <span className={styles.tile}>
            <BlockTile
              as='span'
              blockType={entry.blockType}
              icon={getBlockIcon(entry.blockType) ?? undefined}
              bgColor={getBlockColor(entry.blockType)}
            />
          </span>
        )}
        <span className={styles.label} data-error={status.error || undefined} data-type='T060'>
          {label}
        </span>
        {hasChildren && (
          <span className={styles.chevron} data-collapsed={!isExpanded || undefined}>
            <Icon name='I051' />
          </span>
        )}
      </span>
      <RowStatus
        isRunning={status.running}
        isCanceled={status.canceled}
        durationMs={entry.durationMs}
      />
    </button>
  )
})

/** Indents a row by its depth in the run's tree. */
function indent(depth: number) {
  return (element: HTMLDivElement | null) => {
    element?.style.setProperty('padding-inline-start', `calc(var(--spacing-16) * ${depth})`)
  }
}

interface LogListProps {
  executionGroups: ExecutionGroup[]
  selectedEntryId: string | null
  expandedNodes: Set<string>
  onSelectEntry: (entry: ConsoleEntry) => void
  onToggleNode: (nodeId: string) => void
  onContextMenu: (entry: ConsoleEntry, event: MouseEvent) => void
}

/**
 * Every run of this workflow, newest first, as one virtualized list: each run's tree flattened to
 * its open rows, runs divided by a rule. The selected row scrolls into view as it changes.
 */
export const LogList = memo(function LogList({
  executionGroups,
  selectedEntryId,
  expandedNodes,
  onSelectEntry,
  onToggleNode,
  onContextMenu,
}: LogListProps) {
  const [viewport, setViewport] = useState<HTMLDivElement | null>(null)
  const measureEdges = useScrollEdges<HTMLDivElement>()
  const setList = useCallback(
    (element: HTMLDivElement | null) => {
      setViewport(element)
      return measureEdges(element)
    },
    [measureEdges]
  )
  const rows = useMemo(
    () => flattenVisibleExecutionRows(executionGroups, expandedNodes),
    [executionGroups, expandedNodes]
  )
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => viewport,
    estimateSize: () => ROW_HEIGHT,
    gap: ROW_GAP,
    overscan: OVERSCAN,
    getItemKey: (index) => rows[index]?.id ?? index,
    useFlushSync: false,
  })

  const rowsRef = useRef<VisibleTerminalRow[]>(rows)
  rowsRef.current = rows
  useEffect(() => {
    if (!selectedEntryId) return
    const index = rowsRef.current.findIndex(
      (row) => row.rowType === 'node' && row.node?.entry.id === selectedEntryId
    )
    if (index !== -1) virtualizer.scrollToIndex(index, { align: 'auto' })
  }, [selectedEntryId, virtualizer])

  const items = virtualizer.getVirtualItems()
  const before = Math.max(0, (items[0]?.start ?? 0) - ROW_GAP)
  const after = Math.max(0, virtualizer.getTotalSize() - (items.at(-1)?.end ?? 0) - ROW_GAP)

  return (
    <div ref={setList} className={styles.list}>
      <div className={styles.rows}>
        {before > 0 && <Spacer blockSize={before} />}
        {items.map((item) => {
          const row = rows[item.index]
          if (!row) return null
          return (
            <div key={item.key} ref={virtualizer.measureElement} data-index={item.index}>
              {row.rowType === 'separator' || !row.node ? (
                <div className={styles.separator} role='separator' />
              ) : (
                <div ref={indent(row.depth)}>
                  <LogRow
                    node={row.node}
                    selectedEntryId={selectedEntryId}
                    expandedNodes={expandedNodes}
                    onSelectEntry={onSelectEntry}
                    onToggleNode={onToggleNode}
                    onContextMenu={onContextMenu}
                  />
                </div>
              )}
            </div>
          )
        })}
        {after > 0 && <Spacer blockSize={after} />}
      </div>
    </div>
  )
})

/** Stands in for the rows outside the window, keeping the list's full height. */
function Spacer({ blockSize }: { blockSize: number }) {
  return (
    <div
      aria-hidden='true'
      ref={(element) => {
        element?.style.setProperty('block-size', `${blockSize}px`)
      }}
    />
  )
}
