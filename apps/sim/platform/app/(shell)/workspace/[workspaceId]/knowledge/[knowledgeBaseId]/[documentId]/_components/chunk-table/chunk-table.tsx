'use client'

import type { ReactNode } from 'react'
import { Button } from '@sim/emcn/button'
import { Checkbox } from '@sim/emcn/checkbox'
import { ActionMenu, ContextActionMenu, type MenuAction } from '@sim/emcn/menu/action-menu'
import { StatusTag } from '@sim/emcn/status'
import { escapeRegExp } from '@sim/utils/string'
import { formatTokenCount } from '@/platform/app/(shell)/workspace/[workspaceId]/knowledge/[knowledgeBaseId]/_components/knowledge-base/model'
import styles from '@/platform/app/(shell)/workspace/[workspaceId]/knowledge/[knowledgeBaseId]/[documentId]/_components/chunk-table/chunk-table.module.css'
import type { ChunkData } from '@/platform/lib/data/knowledge'

const PREVIEW_LENGTH = 150
const CONTEXT_BEFORE = 30

/**
 * The chunk's first 150 characters, or 150 around the first search term it contains, so a match
 * deep in a long chunk is still in view.
 */
function preview(content: string, query: string) {
  if (content.length <= PREVIEW_LENGTH) return content
  for (const term of query.trim().toLowerCase().split(/\s+/).filter(Boolean)) {
    const at = content.toLowerCase().indexOf(term)
    if (at === -1) continue
    const start = Math.max(0, at - CONTEXT_BEFORE)
    const end = Math.min(content.length, start + PREVIEW_LENGTH)
    return `${start > 0 ? '…' : ''}${content.slice(start, end)}${end < content.length ? '…' : ''}`
  }
  return `${content.slice(0, PREVIEW_LENGTH - 1).trimEnd()}…`
}

/** Marks each search term where it appears. */
function Marked({ text, query }: { text: string; query: string }) {
  const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean)
  if (terms.length === 0) return text
  const pattern = new RegExp(`(${terms.map(escapeRegExp).join('|')})`, 'gi')
  return text.split(pattern).map((part, index) =>
    index % 2 === 1 ? (
      <mark key={index} className={styles.match}>
        {part}
      </mark>
    ) : (
      part
    )
  )
}

interface ChunkSelection {
  selected: ReadonlySet<string>
  toggle: (chunkId: string, checked: boolean) => void
  toggleAll: (checked: boolean) => void
}

interface ChunkTableProps {
  chunks: readonly ChunkData[]
  query: string
  selection?: ChunkSelection
  onOpen: (chunk: ChunkData) => void
  rowActions: (chunk: ChunkData) => readonly MenuAction[]
  backgroundActions: readonly MenuAction[]
  bulkActions: readonly MenuAction[]
  /** A document that has not finished indexing shows its state in place of chunks. */
  statusRow?: string
  /** What stands in for rows when there are none. */
  empty?: ReactNode
}

/**
 * A document's chunks in the Logs list's anatomy: the content preview with search matches marked,
 * the chunk's index in mono, its tokens on the trailing edge and whether it is searchable. A row
 * opens the chunk; its commands sit on an ellipsis and on right-click.
 */
export function ChunkTable({
  chunks,
  query,
  selection,
  onOpen,
  rowActions,
  backgroundActions,
  bulkActions,
  statusRow,
  empty,
}: ChunkTableProps) {
  const selectedCount = selection?.selected.size ?? 0
  const allSelected = chunks.length > 0 && selectedCount === chunks.length
  const header = (
    <div className={styles.header} data-type='T050'>
      {selection && (
        <span className={styles.check}>
          <Checkbox
            label='Select all chunks'
            labelHidden
            checked={allSelected}
            indeterminate={selectedCount > 0 && !allSelected}
            disabled={chunks.length === 0}
            onCheckedChange={selection.toggleAll}
          />
        </span>
      )}
      <span>Content</span>
      <span>Index</span>
      <span className={styles.numeric}>Tokens</span>
      <span>Status</span>
      <span className={styles.action} />
    </div>
  )
  const body = statusRow ? (
    <div className={styles.table}>
      {header}
      <div className={styles.row} data-passive=''>
        {selection && <span className={styles.check} />}
        <span className={styles.secondary} data-type='T060'>
          {statusRow}
        </span>
        <span className={styles.secondary}>—</span>
        <span className={styles.number}>—</span>
        <span className={styles.secondary}>—</span>
        <span className={styles.action} />
      </div>
    </div>
  ) : chunks.length === 0 ? (
    empty
  ) : (
    <div className={styles.table}>
      {header}
      <ol className={styles.rows} aria-label='Chunks'>
        {chunks.map((chunk) => {
          const isSelected = selection?.selected.has(chunk.id) ?? false
          const actions = () => rowActions(chunk)
          return (
            <li key={chunk.id}>
              <ContextActionMenu label={`Actions for chunk ${chunk.chunkIndex}`} actions={actions}>
                <div className={styles.row} data-selected={isSelected || undefined}>
                  {selection && (
                    <span className={styles.check}>
                      <Checkbox
                        label={`Select chunk ${chunk.chunkIndex}`}
                        labelHidden
                        checked={isSelected}
                        onCheckedChange={(checked) => selection.toggle(chunk.id, checked)}
                      />
                    </span>
                  )}
                  <button
                    type='button'
                    className={styles.open}
                    data-type='T060'
                    aria-label={`Chunk ${chunk.chunkIndex}`}
                    onClick={() => onOpen(chunk)}
                  >
                    <span className={styles.preview}>
                      <Marked text={preview(chunk.content, query)} query={query} />
                    </span>
                  </button>
                  <span className={styles.index} data-type='T011'>
                    {chunk.chunkIndex}
                  </span>
                  <span className={styles.number} data-type='T060'>
                    {formatTokenCount(chunk.tokenCount)}
                  </span>
                  <span className={styles.status}>
                    {chunk.enabled ? (
                      <StatusTag label='Enabled' intent='success' />
                    ) : (
                      <StatusTag label='Disabled' />
                    )}
                  </span>
                  <span className={styles.action}>
                    <ActionMenu
                      label={`Actions for chunk ${chunk.chunkIndex}`}
                      icon='I108'
                      triggerSize='compact'
                      tooltip={false}
                      align='end'
                      actions={actions}
                    />
                  </span>
                </div>
              </ContextActionMenu>
            </li>
          )
        })}
      </ol>
    </div>
  )

  return (
    <ContextActionMenu label='Chunk actions' actions={backgroundActions}>
      <div className={styles.area}>
        {body}
        {selection && selectedCount > 0 && bulkActions.length > 0 && (
          <div className={styles.bulkFrame}>
            <div
              className={styles.bulk}
              role='toolbar'
              aria-label='Selection actions'
              data-material='floating'
              data-elevation='menu'
            >
              <span className={styles.count} data-type='T060' role='status'>
                {selectedCount.toLocaleString()} selected
              </span>
              {bulkActions.map((action) => (
                <Button
                  key={action.id}
                  variant='quiet'
                  size='compact'
                  destructive={!action.children && action.destructive}
                  disabled={!action.children && action.disabled}
                  onClick={action.children ? undefined : action.onSelect}
                >
                  {action.label}
                </Button>
              ))}
            </div>
          </div>
        )}
      </div>
    </ContextActionMenu>
  )
}
