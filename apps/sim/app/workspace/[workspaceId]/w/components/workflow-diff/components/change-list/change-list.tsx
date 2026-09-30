'use client'

import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Badge, cn } from '@sim/emcn'
import { ChevronDown } from '@sim/emcn/icons'
import { humanizeBlockName } from '@sim/workflow-renderer'
import type { WorkflowDiffSummary } from '@/lib/workflows/comparison'
import { BindingChangeRow } from '@/app/workspace/[workspaceId]/w/components/workflow-diff/components/change-list/binding-change-row'
import { FieldChangeRow } from '@/app/workspace/[workspaceId]/w/components/workflow-diff/components/change-list/field-change-row'
import {
  type BlockChangeEntry,
  type BlockChangeStatus,
  listBlockChanges,
  listOneSidedFields,
  splitEnvironmentBindings,
} from '@/app/workspace/[workspaceId]/w/components/workflow-diff/utils'
import { BlockTile } from '@/blocks/block-tile'
import type { BlockState } from '@/stores/workflows/workflow/types'

const STATUS_BADGE_VARIANT: Record<BlockChangeStatus, 'green' | 'amber' | 'red'> = {
  added: 'green',
  modified: 'amber',
  removed: 'red',
}

const STATUS_LABEL: Record<BlockChangeStatus, string> = {
  added: 'Added',
  modified: 'Modified',
  removed: 'Removed',
}

const SIGN_CLASS: Record<BlockChangeStatus, string> = {
  added: 'text-[var(--brand-accent)]',
  removed: 'text-[var(--text-error)]',
  modified: 'text-[var(--warning)]',
}

const SIGN: Record<BlockChangeStatus, string> = { added: '+', removed: '−', modified: '~' }

interface ChangeListProps {
  summary: WorkflowDiffSummary
  /** The two sides, so cards can show an added or removed block's fields and detect moves */
  baseBlocks: Record<string, BlockState>
  targetBlocks: Record<string, BlockState>
  selectedBlockId: string | null
  onSelectBlock: (blockId: string | null) => void
  /**
   * The two sides live in different workspaces, so credentials, picked
   * resources and trigger paths differ by design; group them apart, muted.
   */
  environmentBindings?: boolean
}

/**
 * The "what changed" pane: one card per touched block with its field diffs,
 * then the connections that were drawn or cut, then variables. Selecting a
 * card selects the block on the canvas and vice versa.
 */
export function ChangeList({
  summary,
  baseBlocks,
  targetBlocks,
  selectedBlockId,
  onSelectBlock,
  environmentBindings = false,
}: ChangeListProps) {
  const entries = useMemo(
    () => listBlockChanges(summary, baseBlocks, targetBlocks),
    [summary, baseBlocks, targetBlocks]
  )
  const blocks = useMemo(() => ({ ...baseBlocks, ...targetBlocks }), [baseBlocks, targetBlocks])
  const cardRefs = useRef<Map<string, HTMLDivElement>>(null)
  cardRefs.current ??= new Map()

  const registerCard = useCallback((id: string, node: HTMLDivElement | null) => {
    if (node) cardRefs.current?.set(id, node)
    else cardRefs.current?.delete(id)
  }, [])
  const toggleSelected = useCallback(
    (id: string) => onSelectBlock(selectedBlockId === id ? null : id),
    [onSelectBlock, selectedBlockId]
  )

  useEffect(() => {
    if (!selectedBlockId) return
    cardRefs.current?.get(selectedBlockId)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  }, [selectedBlockId])

  if (!summary.hasChanges) {
    return (
      <div className='flex h-full items-center justify-center px-6 text-center text-[var(--text-placeholder)] text-small'>
        These two versions are identical.
      </div>
    )
  }

  const hasConnectionChanges = summary.edgeChanges.added > 0 || summary.edgeChanges.removed > 0
  const hasVariableChanges =
    summary.variableChanges.added > 0 ||
    summary.variableChanges.removed > 0 ||
    summary.variableChanges.modified > 0

  return (
    <div className='flex flex-col gap-4 p-4'>
      {entries.length > 0 && (
        <Section title='Blocks' count={entries.length}>
          {entries.map((entry) => (
            <BlockCard
              key={entry.id}
              entry={entry}
              blocks={blocks}
              selectedBlockId={selectedBlockId}
              onToggleSelected={toggleSelected}
              registerCard={registerCard}
              environmentBindings={environmentBindings}
            />
          ))}
        </Section>
      )}

      {hasConnectionChanges && (
        <Section
          title='Connections'
          count={summary.edgeChanges.added + summary.edgeChanges.removed}
        >
          <div className='flex flex-col gap-1.5 rounded-md border border-[var(--border)] bg-[var(--surface-2)] p-3'>
            {summary.edgeChanges.addedDetails.map((edge, index) => (
              <NamedRow
                key={`a-${index}`}
                kind='added'
                name={`${humanizeBlockName(edge.sourceName)} → ${humanizeBlockName(edge.targetName)}`}
              />
            ))}
            {summary.edgeChanges.removedDetails.map((edge, index) => (
              <NamedRow
                key={`r-${index}`}
                kind='removed'
                name={`${humanizeBlockName(edge.sourceName)} → ${humanizeBlockName(edge.targetName)}`}
              />
            ))}
          </div>
        </Section>
      )}

      {hasVariableChanges && (
        <Section
          title='Variables'
          count={
            summary.variableChanges.added +
            summary.variableChanges.removed +
            summary.variableChanges.modified
          }
        >
          <div className='flex flex-col gap-1.5 rounded-md border border-[var(--border)] bg-[var(--surface-2)] p-3 text-small'>
            {summary.variableChanges.addedNames.map((name) => (
              <NamedRow key={`a-${name}`} kind='added' name={name} />
            ))}
            {summary.variableChanges.modifiedNames.map((name) => (
              <NamedRow key={`m-${name}`} kind='modified' name={name} />
            ))}
            {summary.variableChanges.removedNames.map((name) => (
              <NamedRow key={`r-${name}`} kind='removed' name={name} />
            ))}
          </div>
        </Section>
      )}
    </div>
  )
}

interface SectionProps {
  title: string
  count: number
  children: React.ReactNode
}

function Section({ title, count, children }: SectionProps) {
  return (
    <div className='flex flex-col gap-2'>
      <div className='flex items-center gap-2 px-0.5'>
        <span className='font-medium text-[var(--text-primary)] text-small'>{title}</span>
        <span className='text-[var(--text-muted)] text-caption tabular-nums'>{count}</span>
      </div>
      <div className='flex flex-col gap-2'>{children}</div>
    </div>
  )
}

interface BlockCardProps {
  entry: BlockChangeEntry
  blocks: Record<string, BlockState>
  selectedBlockId: string | null
  onToggleSelected: (id: string) => void
  registerCard: (id: string, node: HTMLDivElement | null) => void
  environmentBindings: boolean
  /** Rendered inside the card of the container it was added or removed with */
  nested?: boolean
}

/**
 * One touched block. The header toggles the body (open by default) and
 * selects the block on the canvas; the body is the field diffs for a modified
 * block, every field of an added or removed one diffed against nothing, plus
 * the blocks nested under a container that was added or removed as a whole,
 * each as a card of its own so their code and prompts stay reviewable.
 */
const BlockCard = memo(function BlockCard({
  entry,
  blocks,
  selectedBlockId,
  onToggleSelected,
  registerCard,
  environmentBindings,
  nested = false,
}: BlockCardProps) {
  const [collapsed, setCollapsed] = useState(false)
  const selected = selectedBlockId === entry.id
  const block = blocks[entry.id]
  const { logic, bindings } = useMemo(() => {
    /* A block on one side only is every field arriving or leaving; same rows, one side empty. */
    const fields =
      entry.status === 'modified'
        ? entry.changes
        : block
          ? listOneSidedFields(block, entry.status)
          : []
    return environmentBindings
      ? splitEnvironmentBindings(entry.type, fields)
      : { logic: fields, bindings: [] }
  }, [entry, block, environmentBindings])
  const bindingsOnly = entry.status === 'modified' && logic.length === 0 && bindings.length > 0
  const hasBody =
    logic.length > 0 ||
    bindings.length > 0 ||
    entry.children.length > 0 ||
    Boolean(entry.moved) ||
    Boolean(entry.membership)

  const toggle = () => {
    onToggleSelected(entry.id)
    if (hasBody) setCollapsed((value) => !value)
  }

  return (
    <div
      ref={(node) => registerCard(entry.id, node)}
      className={cn(
        'flex flex-col rounded-md border transition-colors',
        nested ? 'bg-[var(--surface-1)]' : 'bg-[var(--surface-2)]',
        selected ? 'border-[var(--text-secondary)]' : 'border-[var(--border)]'
      )}
    >
      <div
        role='button'
        tabIndex={0}
        aria-expanded={hasBody ? !collapsed : undefined}
        onClick={toggle}
        onKeyDown={(event) => {
          if (event.target !== event.currentTarget) return
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault()
            toggle()
          }
        }}
        className={cn(
          'flex cursor-pointer items-center gap-2 rounded-md hover-hover:bg-[var(--surface-3)] focus-visible:outline-none focus-visible:ring-[1.5px] focus-visible:ring-[var(--text-secondary)]',
          nested ? 'p-2' : 'p-3'
        )}
      >
        <BlockTile blockType={entry.type} size={nested ? 'sm' : 'lg'} />
        <span className='min-w-0 flex-1 truncate font-medium text-[var(--text-primary)] text-small'>
          {humanizeBlockName(entry.name)}
        </span>
        <Badge variant={bindingsOnly ? 'gray' : STATUS_BADGE_VARIANT[entry.status]} size='sm'>
          {bindingsOnly ? 'Bindings only' : STATUS_LABEL[entry.status]}
        </Badge>
        {hasBody && (
          <ChevronDown
            className={cn(
              'size-[14px] shrink-0 text-[var(--text-muted)] transition-transform',
              collapsed && '-rotate-90'
            )}
          />
        )}
      </div>

      {hasBody && !collapsed && (
        <div
          className={cn(
            'flex flex-col gap-3 border-[var(--border)] border-t',
            nested ? 'p-2' : 'px-3 pt-3 pb-3'
          )}
        >
          {entry.moved && (
            <div className='flex flex-col gap-1'>
              {entry.moved.into && (
                <span className='text-[var(--text-primary)] text-small'>
                  Moved into{' '}
                  <span className='font-medium'>{humanizeBlockName(entry.moved.into)}</span>
                </span>
              )}
              {entry.moved.outOf && (
                <span className='text-[var(--text-primary)] text-small'>
                  Moved out of{' '}
                  <span className='font-medium'>{humanizeBlockName(entry.moved.outOf)}</span>
                </span>
              )}
            </div>
          )}

          {logic.map((change) => (
            <FieldChangeRow
              key={change.field}
              blockType={entry.type}
              field={change.field}
              oldValue={change.oldValue}
              newValue={change.newValue}
            />
          ))}

          {bindings.length > 0 && (
            <div className='flex flex-col gap-1.5 rounded-sm bg-[var(--surface-3)] px-2.5 py-2'>
              <span className='text-[var(--text-muted)] text-caption'>Environment bindings</span>
              {bindings.map((change) => (
                <BindingChangeRow
                  key={change.field}
                  blockType={entry.type}
                  field={change.field}
                  oldValue={change.oldValue}
                  newValue={change.newValue}
                />
              ))}
            </div>
          )}

          {(entry.membership || entry.children.length > 0) && (
            <div className='flex flex-col gap-1.5'>
              <span className='text-[var(--text-tertiary)] text-caption'>Blocks inside</span>
              {entry.children.map((child) => (
                <BlockCard
                  key={child.id}
                  entry={child}
                  blocks={blocks}
                  selectedBlockId={selectedBlockId}
                  onToggleSelected={onToggleSelected}
                  registerCard={registerCard}
                  environmentBindings={environmentBindings}
                  nested
                />
              ))}
              {entry.membership?.added.map((row) => (
                <NamedRow
                  key={`a-${row.name}`}
                  kind='added'
                  name={`${humanizeBlockName(row.name)}${row.moved ? ' (moved in)' : ''}`}
                />
              ))}
              {entry.membership?.removed.map((row) => (
                <NamedRow
                  key={`r-${row.name}`}
                  kind='removed'
                  name={`${humanizeBlockName(row.name)}${row.moved ? ' (moved out)' : ''}`}
                />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
})

interface NamedRowProps {
  kind: BlockChangeStatus
  name: string
}

/** A signed one-line entry: a connection, a variable, or a block that entered or left a container. */
function NamedRow({ kind, name }: NamedRowProps) {
  return (
    <div className='flex items-center gap-2 text-small'>
      <span className={cn('w-3 shrink-0 text-center font-mono', SIGN_CLASS[kind])}>
        {SIGN[kind]}
      </span>
      <span
        className={cn(
          'min-w-0 truncate',
          kind === 'removed' ? 'text-[var(--text-tertiary)]' : 'text-[var(--text-primary)]'
        )}
      >
        {name}
      </span>
    </div>
  )
}
