'use client'

import {
  type Dispatch,
  memo,
  type ReactNode,
  type SetStateAction,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { Icon } from '@sim/emcn/icon'
import { OverflowText } from '@sim/emcn/overflow-text'
import { StatusText } from '@sim/emcn/status'
import { BlockTile } from '@/app/(product)/workspace/[workspaceId]/workflows/_components/canvas/block-tile/block-tile'
import { humanizeBlockName } from '@/app/(product)/workspace/[workspaceId]/workflows/_components/canvas/workflow-block/humanize-block-name'
import styles from '@/app/(product)/workspace/[workspaceId]/workflows/_components/deploy/compare-versions/compare-versions.module.css'
import { FieldChangeRow } from '@/app/(product)/workspace/[workspaceId]/workflows/_components/deploy/compare-versions/field-change-row'
import {
  type BlockChangeEntry,
  buildSubBlockValues,
  type EdgeChange,
  listBlockChanges,
  type WorkflowDiffSummary,
} from '@/platform/lib/data/workflow-deploy'
import {
  type BlockState,
  getCanvasPorts,
  WORKFLOW_SOURCE_HANDLE_ID,
  WORKFLOW_TARGET_HANDLE_ID,
  type WorkflowState,
} from '@/platform/lib/data/workflows'

type SignKind = 'added' | 'removed' | 'changed'

const DIFF_SIGN: Record<SignKind, string> = { added: '+', removed: '−', changed: '~' }

const STATUS_TAG: Record<
  BlockChangeEntry['status'],
  { label: string; intent: 'success' | 'warning' | 'neutral' }
> = {
  added: { label: 'Added', intent: 'success' },
  modified: { label: 'Modified', intent: 'warning' },
  removed: { label: 'Removed', intent: 'neutral' },
}

function connectionLabel(edge: EdgeChange, blocks: Record<string, BlockState>): string {
  const endpoint = (type: 'source' | 'target') => {
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
  return `${endpoint('source')} → ${endpoint('target')}`
}

/** Whether the selected block is this entry or one nested under it. */
function containsSelection(entry: BlockChangeEntry, selectedBlockId: string | null): boolean {
  if (!selectedBlockId) return false
  if (entry.id === selectedBlockId) return true
  return entry.children.some((child) => containsSelection(child, selectedBlockId))
}

interface ChangeListProps {
  summary: WorkflowDiffSummary
  baseBlocks: Record<string, BlockState>
  targetBlocks: Record<string, BlockState>
  containers: {
    base: Pick<WorkflowState, 'loops' | 'parallels'>
    target: Pick<WorkflowState, 'loops' | 'parallels'>
  }
  selectedBlockId: string | null
  onSelectBlock: Dispatch<SetStateAction<string | null>>
}

/**
 * What changed: one card per touched block with its field diffs, then the connections drawn or
 * cut, then variables. Selecting a card selects its block on the canvas and the other way round.
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

  if (!summary.hasChanges)
    return (
      <p className={styles.identical} data-type='T060'>
        These two versions are identical.
      </p>
    )

  const hasConnectionChanges = summary.edgeChanges.added > 0 || summary.edgeChanges.removed > 0
  const hasVariableChanges =
    summary.variableChanges.added > 0 ||
    summary.variableChanges.removed > 0 ||
    summary.variableChanges.modified > 0

  return (
    <div className={styles.changeList}>
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
          <div className={styles.namedRows}>
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
          </div>
        </Section>
      )}
      {hasVariableChanges && (
        <Section title='Variables'>
          <div className={styles.namedRows}>
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

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className={styles.section}>
      <h3 className={styles.sectionTitle} data-type='T052'>
        {title}
      </h3>
      <div className={styles.sectionBody}>{children}</div>
    </section>
  )
}

interface BlockCardProps {
  entry: BlockChangeEntry
  baseBlocks: Record<string, BlockState>
  targetBlocks: Record<string, BlockState>
  /** The selected block id when it is this card or one nested inside it, else null. */
  selectedBlockId: string | null
  onToggleSelected: (id: string) => void
  registerCard: (id: string, node: HTMLDivElement | null) => void
}

/**
 * One touched block. Its header selects the block on the canvas and folds the body (open by
 * default): a modified block's field diffs, every field of an added or removed one against nothing,
 * and the blocks nested under a container added or removed as a whole, each as its own card.
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
  const hasBody =
    entry.changes.length > 0 ||
    entry.children.length > 0 ||
    Boolean(entry.moved) ||
    Boolean(entry.membership)
  const open = hasBody && !collapsed
  const status = STATUS_TAG[entry.status]

  return (
    <div ref={setCardRef} className={styles.card} data-selected={selected || undefined}>
      <button
        type='button'
        className={styles.cardHeader}
        aria-expanded={hasBody ? open : undefined}
        aria-pressed={selected}
        onClick={() => {
          onToggleSelected(entry.id)
          if (hasBody) setCollapsed((value) => !value)
        }}
      >
        <BlockTile blockType={entry.type} size='sm' as='span' />
        <span className={styles.cardTitle} data-type={selected ? 'T059' : 'T060'}>
          <OverflowText text={humanizeBlockName(entry.name)}>
            {humanizeBlockName(entry.name)}
          </OverflowText>
        </span>
        <StatusText label={status.label} intent={status.intent} />
        {hasBody && (
          <span className={styles.chevron}>
            <Icon name={open ? 'I051' : 'I090'} />
          </span>
        )}
      </button>
      {open && (
        <div className={styles.cardBody}>
          {entry.moved && (
            <div className={styles.moves} data-type='T060'>
              {entry.moved.into && (
                <span>
                  Moved into <strong>{humanizeBlockName(entry.moved.into)}</strong>
                </span>
              )}
              {entry.moved.outOf && (
                <span>
                  Moved out of <strong>{humanizeBlockName(entry.moved.outOf)}</strong>
                </span>
              )}
            </div>
          )}
          {entry.changes.map((change) => (
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
            <div className={styles.fieldChange}>
              <span className={styles.fieldLabel} data-type='T059'>
                Blocks inside
              </span>
              <div className={styles.sectionBody}>
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
            </div>
          )}
        </div>
      )}
    </div>
  )
})

/** A signed one-line entry: a connection, a variable, or a block entering or leaving a container. */
function NamedRow({ kind, name }: { kind: SignKind; name: string }) {
  return (
    <div className={styles.namedRow} data-kind={kind} data-type='T060'>
      <span className={styles.sign} aria-hidden='true'>
        {DIFF_SIGN[kind]}
      </span>
      <span data-visually-hidden=''>
        {kind === 'added' ? 'Added: ' : kind === 'removed' ? 'Removed: ' : 'Changed: '}
      </span>
      <span className={styles.namedText}>
        <OverflowText text={name}>{name}</OverflowText>
      </span>
    </div>
  )
}
