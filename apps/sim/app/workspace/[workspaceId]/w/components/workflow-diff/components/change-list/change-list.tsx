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
import {
  ChipModalField,
  ChipTag,
  CollapsibleCard,
  cn,
  disclosureChevronClass,
  InfoCard,
  Label,
  OverflowText,
} from '@sim/emcn'
import { ChevronDown } from '@sim/emcn/icons'
import { humanizeBlockName } from '@sim/workflow-renderer'
import { WORKFLOW_SOURCE_HANDLE_ID, WORKFLOW_TARGET_HANDLE_ID } from '@sim/workflow-types/workflow'
import { getCanvasPorts } from '@/lib/workflows/blocks/canvas-ports'
import type { WorkflowDiffSummary } from '@/lib/workflows/comparison'
import type { EdgeChange } from '@/lib/workflows/comparison/compare'
import { buildSubBlockValues } from '@/lib/workflows/subblocks/visibility'
import { DIFF_LABEL } from '@/app/workspace/[workspaceId]/w/components/preview/components/preview-workflow/components/diff-label/diff-label'
import {
  DIFF_SIGN,
  DIFF_SIGN_CLASS,
  type DiffSignKind,
} from '@/app/workspace/[workspaceId]/w/components/workflow-diff/components/change-list/diff-signs'
import { FieldChangeRow } from '@/app/workspace/[workspaceId]/w/components/workflow-diff/components/change-list/field-change-row'
import {
  type BlockChangeEntry,
  listBlockChanges,
} from '@/app/workspace/[workspaceId]/w/components/workflow-diff/utils'
import { BlockTile } from '@/blocks/block-tile'
import type { BlockState, WorkflowState } from '@/stores/workflows/workflow/types'

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
}

function connectionLabel(edge: EdgeChange, blocks: Record<string, BlockState>): string {
  const endpointLabel = (type: 'source' | 'target') => {
    const block = blocks[edge[type]]
    const handle = type === 'source' ? edge.sourceHandle : edge.targetHandle
    const defaultHandle = type === 'source' ? WORKFLOW_SOURCE_HANDLE_ID : WORKFLOW_TARGET_HANDLE_ID
    const name = humanizeBlockName(block?.name || block?.type || 'Unavailable block')
    if (!handle || handle === defaultHandle) return name
    const ports = block ? getCanvasPorts(block, true).filter((port) => port.type === type) : []
    const index = ports.findIndex((port) => port.handleId === handle)
    const title = ports[index]?.title
    const label =
      title === 'else if'
        ? `else if ${index}`
        : (title ?? (type === 'source' ? 'Unavailable output' : 'Unavailable input'))
    return `${name} (${label})`
  }
  return `${endpointLabel('source')} → ${endpointLabel('target')}`
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
}: ChangeListProps) {
  const entries = useMemo(
    () => listBlockChanges(summary, baseBlocks, targetBlocks, containers),
    [summary, baseBlocks, targetBlocks, containers]
  )
  const cardRefs = useRef<Map<string, HTMLDivElement>>(null)
  cardRefs.current ??= new Map()

  const registerCard = useCallback((id: string, node: HTMLDivElement | null) => {
    if (node) cardRefs.current?.set(id, node)
    else cardRefs.current?.delete(id)
  }, [])
  // Stable across selections, so only the cards whose selection changed re-render.
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
        <Section title='Blocks'>
          {entries.map((entry) => (
            <BlockCard
              key={entry.id}
              entry={entry}
              baseBlocks={baseBlocks}
              targetBlocks={targetBlocks}
              selectedBlockId={containsSelection(entry, selectedBlockId) ? selectedBlockId : null}
              onToggleSelected={toggleSelected}
              registerCard={registerCard}
            />
          ))}
        </Section>
      )}

      {hasConnectionChanges && (
        <Section title='Connections'>
          <InfoCard className='flex flex-col gap-1.5 p-3'>
            {summary.edgeChanges.addedDetails.map((edge, index) => (
              <NamedRow
                key={`a-${index}`}
                kind='added'
                name={connectionLabel(edge, targetBlocks)}
              />
            ))}
            {summary.edgeChanges.removedDetails.map((edge, index) => (
              <NamedRow
                key={`r-${index}`}
                kind='removed'
                name={connectionLabel(edge, baseBlocks)}
              />
            ))}
          </InfoCard>
        </Section>
      )}

      {hasVariableChanges && (
        <Section title='Variables'>
          <InfoCard className='flex flex-col gap-1.5 p-3'>
            {summary.variableChanges.addedNames.map((name, index) => (
              <NamedRow key={`a-${index}-${name}`} kind='added' name={name} />
            ))}
            {summary.variableChanges.modifiedNames.map((name, index) => (
              <NamedRow key={`m-${index}-${name}`} kind='changed' name={name} />
            ))}
            {summary.variableChanges.removedNames.map((name, index) => (
              <NamedRow key={`r-${index}-${name}`} kind='removed' name={name} />
            ))}
          </InfoCard>
        </Section>
      )}
    </div>
  )
}

interface SectionProps {
  title: string
  children: React.ReactNode
}

function Section({ title, children }: SectionProps) {
  return (
    <div className='flex flex-col gap-2'>
      <Label>{title}</Label>
      <div className='flex flex-col gap-2'>{children}</div>
    </div>
  )
}

interface BlockCardProps {
  entry: BlockChangeEntry
  baseBlocks: Record<string, BlockState>
  targetBlocks: Record<string, BlockState>
  /** The selected block id when it is this card or one nested inside it, else null */
  selectedBlockId: string | null
  onToggleSelected: (id: string) => void
  registerCard: (id: string, node: HTMLDivElement | null) => void
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
  baseBlocks,
  targetBlocks,
  selectedBlockId,
  onToggleSelected,
  registerCard,
}: BlockCardProps) {
  const [collapsed, setCollapsed] = useState(false)
  const [seenSelection, setSeenSelection] = useState(selectedBlockId)
  const selected = selectedBlockId === entry.id
  // Selecting a block nested in this card on the canvas opens the card so its row can show.
  if (seenSelection !== selectedBlockId) {
    setSeenSelection(selectedBlockId)
    if (selectedBlockId !== null && !selected) setCollapsed(false)
  }
  const setCardRef = useCallback(
    (node: HTMLDivElement | null) => registerCard(entry.id, node),
    [registerCard, entry.id]
  )
  const baseValues = buildSubBlockValues(baseBlocks[entry.id]?.subBlocks ?? {})
  const targetValues = buildSubBlockValues(targetBlocks[entry.id]?.subBlocks ?? {})
  const fields = entry.changes
  const hasBody =
    fields.length > 0 ||
    entry.children.length > 0 ||
    Boolean(entry.moved) ||
    Boolean(entry.membership)

  const toggle = () => {
    onToggleSelected(entry.id)
    if (hasBody) setCollapsed((value) => !value)
  }

  return (
    <div ref={setCardRef}>
      <CollapsibleCard
        collapsed={!hasBody || collapsed}
        selected={selected}
        onToggleCollapse={toggle}
        title={
          <span className='flex min-w-0 items-center gap-2'>
            <BlockTile blockType={entry.type} size='sm' />
            <OverflowText
              label={humanizeBlockName(entry.name)}
              className={cn('min-w-0 flex-1', selected && 'font-medium')}
              focusTarget='nearest-interactive'
            />
          </span>
        }
        badge={
          <>
            <ChipTag variant='gray'>{DIFF_LABEL[entry.status]}</ChipTag>
            {hasBody && (
              <ChevronDown className={cn(disclosureChevronClass, collapsed && '-rotate-90')} />
            )}
          </>
        }
      >
        <div className='flex flex-col gap-4'>
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

          {fields.map((change) => (
            <FieldChangeRow
              key={`${change.scope}:${change.field}`}
              blockType={entry.type}
              scope={change.scope}
              field={change.field}
              oldValue={change.oldValue}
              newValue={change.newValue}
              baseValues={baseValues}
              targetValues={targetValues}
            />
          ))}

          {(entry.membership || entry.children.length > 0) && (
            <ChipModalField type='custom' title='Blocks inside' flush>
              <div className='flex flex-col gap-2'>
                {entry.children.map((child) => (
                  <BlockCard
                    key={child.id}
                    entry={child}
                    baseBlocks={baseBlocks}
                    targetBlocks={targetBlocks}
                    selectedBlockId={
                      containsSelection(child, selectedBlockId) ? selectedBlockId : null
                    }
                    onToggleSelected={onToggleSelected}
                    registerCard={registerCard}
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
            </ChipModalField>
          )}
        </div>
      </CollapsibleCard>
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
