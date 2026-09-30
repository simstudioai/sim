'use client'

import {
  type Dispatch,
  memo,
  type SetStateAction,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { Badge, cn, OverflowText } from '@sim/emcn'
import { ChevronDown } from '@sim/emcn/icons'
import { humanizeBlockName } from '@sim/workflow-renderer'
import type { BlockDiffStatus, WorkflowDiffSummary } from '@/lib/workflows/comparison'
import { DIFF_LABEL } from '@/app/workspace/[workspaceId]/w/components/preview/components/preview-workflow/components/diff-label/diff-label'
import { BindingChangeRow } from '@/app/workspace/[workspaceId]/w/components/workflow-diff/components/change-list/binding-change-row'
import {
  DIFF_SIGN,
  DIFF_SIGN_CLASS,
  type DiffSignKind,
} from '@/app/workspace/[workspaceId]/w/components/workflow-diff/components/change-list/diff-signs'
import { FieldChangeRow } from '@/app/workspace/[workspaceId]/w/components/workflow-diff/components/change-list/field-change-row'
import {
  type BlockChangeEntry,
  listBlockChanges,
  listOneSidedFields,
  splitEnvironmentBindings,
} from '@/app/workspace/[workspaceId]/w/components/workflow-diff/utils'
import { BlockTile } from '@/blocks/block-tile'
import type { BlockState, WorkflowState } from '@/stores/workflows/workflow/types'

const STATUS_BADGE_VARIANT: Record<BlockDiffStatus, 'green' | 'amber' | 'red'> = {
  added: 'green',
  modified: 'amber',
  removed: 'red',
}

interface ChangeListProps {
  summary: WorkflowDiffSummary
  /** The two sides, so cards can show an added or removed block's fields and detect moves */
  baseBlocks: Record<string, BlockState>
  targetBlocks: Record<string, BlockState>
  /** Each side's loop and parallel configs, so an added or removed container shows what it runs */
  containers: {
    base: Pick<WorkflowState, 'loops' | 'parallels'>
    target: Pick<WorkflowState, 'loops' | 'parallels'>
  }
  selectedBlockId: string | null
  onSelectBlock: Dispatch<SetStateAction<string | null>>
  /**
   * The two sides live in different workspaces, so credentials, picked
   * resources and trigger paths differ by design; group them apart, muted.
   */
  environmentBindings?: boolean
}

/** Whether the selected block is this entry or one nested under it. */
function containsSelection(entry: BlockChangeEntry, selectedBlockId: string | null): boolean {
  if (!selectedBlockId) return false
  if (entry.id === selectedBlockId) return true
  return entry.children.some((child) => containsSelection(child, selectedBlockId))
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
  containers,
  selectedBlockId,
  onSelectBlock,
  environmentBindings = false,
}: ChangeListProps) {
  const entries = useMemo(
    () => listBlockChanges(summary, baseBlocks, targetBlocks, containers),
    [summary, baseBlocks, targetBlocks, containers]
  )
  const blocks = useMemo(() => ({ ...baseBlocks, ...targetBlocks }), [baseBlocks, targetBlocks])
  const cardRefs = useRef<Map<string, HTMLDivElement>>(null)
  cardRefs.current ??= new Map()

  const registerCard = useCallback((id: string, node: HTMLDivElement | null) => {
    if (node) cardRefs.current?.set(id, node)
    else cardRefs.current?.delete(id)
  }, [])
  /* Stable across selections, so only the cards whose selection changed re-render. */
  const toggleSelected = useCallback(
    (id: string) => onSelectBlock((current) => (current === id ? null : id)),
    [onSelectBlock]
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
              /* Only a card holding the selection needs the id; every other card sees null. */
              selectedBlockId={containsSelection(entry, selectedBlockId) ? selectedBlockId : null}
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
            {summary.variableChanges.addedNames.map((name, index) => (
              <NamedRow key={`a-${index}-${name}`} kind='added' name={name} />
            ))}
            {summary.variableChanges.modifiedNames.map((name, index) => (
              <NamedRow key={`m-${index}-${name}`} kind='changed' name={name} />
            ))}
            {summary.variableChanges.removedNames.map((name, index) => (
              <NamedRow key={`r-${index}-${name}`} kind='removed' name={name} />
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
  /** The selected block id when it is this card or one nested inside it, else null */
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
  const [seenSelection, setSeenSelection] = useState(selectedBlockId)
  const selected = selectedBlockId === entry.id
  /* Selecting a block nested in this card on the canvas opens the card so its row can show. */
  if (seenSelection !== selectedBlockId) {
    setSeenSelection(selectedBlockId)
    if (selectedBlockId !== null && !selected) setCollapsed(false)
  }
  const block = blocks[entry.id]
  const setCardRef = useCallback(
    (node: HTMLDivElement | null) => registerCard(entry.id, node),
    [registerCard, entry.id]
  )
  const { logic, bindings } = useMemo(() => {
    /* A block on one side only is every field arriving or leaving; same rows, one side empty. */
    const fields =
      entry.status === 'modified'
        ? entry.changes
        : [...entry.changes, ...(block ? listOneSidedFields(block, entry.status) : [])]
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
      ref={setCardRef}
      className={cn(
        'flex flex-col overflow-hidden rounded-md border transition-colors',
        nested ? 'bg-[var(--surface-1)]' : 'bg-[var(--surface-2)]',
        selected ? 'border-[var(--text-secondary)]' : 'border-[var(--border)]'
      )}
    >
      <div
        role='button'
        tabIndex={0}
        aria-pressed={selected}
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
          'flex cursor-pointer items-center gap-2 transition-colors hover-hover:bg-[var(--surface-3)] focus-visible:outline-none focus-visible:ring-[1.5px] focus-visible:ring-[var(--text-secondary)] focus-visible:ring-inset',
          nested ? 'p-2' : 'p-3'
        )}
      >
        <BlockTile blockType={entry.type} size={nested ? 'sm' : 'lg'} />
        <OverflowText
          label={humanizeBlockName(entry.name)}
          className='flex-1 font-medium text-[var(--text-primary)] text-small'
        />
        <Badge variant={bindingsOnly ? 'gray' : STATUS_BADGE_VARIANT[entry.status]} size='sm'>
          {bindingsOnly ? 'Bindings only' : DIFF_LABEL[entry.status]}
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
                  selectedBlockId={
                    containsSelection(child, selectedBlockId) ? selectedBlockId : null
                  }
                  onToggleSelected={onToggleSelected}
                  registerCard={registerCard}
                  environmentBindings={environmentBindings}
                  nested
                />
              ))}
              {entry.membership?.added.map((row, index) => (
                <NamedRow
                  key={`a-${index}-${row.name}`}
                  kind='added'
                  name={`${humanizeBlockName(row.name)}${row.moved ? ' (moved in)' : ''}`}
                />
              ))}
              {entry.membership?.removed.map((row, index) => (
                <NamedRow
                  key={`r-${index}-${row.name}`}
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
  kind: DiffSignKind
  name: string
}

/** A signed one-line entry: a connection, a variable, or a block that entered or left a container. */
function NamedRow({ kind, name }: NamedRowProps) {
  return (
    <div className='flex items-center gap-2 text-small'>
      <span className={cn('w-3 shrink-0 text-center font-mono', DIFF_SIGN_CLASS[kind])}>
        {DIFF_SIGN[kind]}
      </span>
      <OverflowText
        label={name}
        className={
          kind === 'removed' ? 'text-[var(--text-tertiary)]' : 'text-[var(--text-primary)]'
        }
      />
    </div>
  )
}
