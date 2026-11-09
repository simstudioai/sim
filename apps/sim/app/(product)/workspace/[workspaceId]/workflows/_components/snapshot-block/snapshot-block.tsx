'use client'

import {
  type MouseEvent,
  type PointerEvent,
  type ReactNode,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { IconButton } from '@sim/emcn/button'
import { Disclosure } from '@sim/emcn/disclosure'
import { EmptyState } from '@sim/emcn/empty-state'
import { useClipboard } from '@sim/emcn/feedback/use-clipboard'
import { SelectField, TextAreaField, TextField } from '@sim/emcn/field'
import { type MenuAction, PointActionMenu } from '@sim/emcn/menu/action-menu'
import { useScrollEdges } from '@sim/emcn/scroll-area/use-scroll-edges'
import { ReactFlowProvider } from '@xyflow/react'
import { FindBar } from '@/app/(product)/_components/find-bar/find-bar'
import {
  type MetadataField,
  MetadataFields,
} from '@/app/(product)/workspace/[workspaceId]/_components/metadata-fields/metadata-fields'
import { SpanInspector } from '@/app/(product)/workspace/[workspaceId]/_components/span-inspector/span-inspector'
import { PreviewScope } from '@/app/(product)/workspace/[workspaceId]/workflows/_components/canvas/workflow-preview/preview-scope'
import {
  SubBlock,
  type SubBlockValues,
} from '@/app/(product)/workspace/[workspaceId]/workflows/_components/editor/sub-block/sub-block'
import {
  FrozenWorkflowBlockPreview,
  WorkflowBlockPreview,
} from '@/app/(product)/workspace/[workspaceId]/workflows/_components/editor/workflow-block-preview/workflow-block-preview'
import { ResizeHandle } from '@/app/(product)/workspace/[workspaceId]/workflows/_components/resize-handle/resize-handle'
import styles from '@/app/(product)/workspace/[workspaceId]/workflows/_components/snapshot-block/snapshot-block.module.css'
import { useCodeViewerFeatures } from '@/platform/lib/data/workflow-deploy/terminal'
import {
  type BlockConfig,
  type BlockState,
  buildCanonicalIndexForSurface,
  evaluateSubBlockCondition,
  getBlock,
  hasAdvancedValues,
  isSubBlockFeatureEnabled,
  isSubBlockVisibleForMode,
  isSubBlockVisibleForTriggerMode,
  isToolInputOnlySubBlock,
  resolveSnapshotConnections,
  type SnapshotReference,
} from '@/platform/lib/data/workflow-editor'
import type { WorkflowState } from '@/platform/lib/data/workflows'
import type { TracePayload, TraceSpan } from '@/platform/shared/workspace-records'

const LOOP_TYPES = [
  { value: 'for', label: 'For Loop' },
  { value: 'forEach', label: 'For Each' },
  { value: 'while', label: 'While Loop' },
  { value: 'doWhile', label: 'Do While Loop' },
] as const
const PARALLEL_TYPES = [
  { value: 'count', label: 'Parallel Count' },
  { value: 'collection', label: 'Parallel Each' },
] as const
/** What the editor shows for a loop or parallel saved before it held its own setting. */
const DEFAULT_ITERATIONS = 5
const DEFAULT_PARALLEL_COUNT = 1
const DEFAULT_BATCH_SIZE = 20
const NO_OUTPUTS: ReadonlyMap<string, { output?: unknown }> = new Map()
/** The block types that run another workflow, whose child workflow the panel previews. */
const WORKFLOW_BLOCK_TYPES = new Set(['workflow', 'workflow_input'])
/** Legacy's Connections pane: collapsed to its header, its opening height and its tallest drag. */
const CONNECTIONS_MIN_HEIGHT = 30
const CONNECTIONS_DEFAULT_HEIGHT = 150
const CONNECTIONS_MAX_HEIGHT = 300

interface PanelMenu {
  x: number
  y: number
  actions: readonly MenuAction[]
}

interface SnapshotBlockProps {
  workspaceId: string
  workflowState: WorkflowState
  blockId: string
  /**
   * A run's snapshot: the block's recorded step, absent when the run never reached it, and every
   * block's recorded output, which the block's references read. A deployed version has no run.
   */
  run?: {
    step?: TraceSpan
    outputs: ReadonlyMap<string, { output?: unknown }>
    /** A Workflow block's child workflow as the run ran it, and where its own snapshot opens. */
    child?: { workflowState: WorkflowState; href: string }
  }
}

/** A stored value as it was saved, unwrapped from the `{ value }` entry the stores keep. */
function rawValuesOf(subBlocks: SubBlockValues): Record<string, unknown> {
  return Object.fromEntries(Object.entries(subBlocks).map(([id, entry]) => [id, entry?.value]))
}

/**
 * The fields legacy's preview editor shows for a frozen block: those its configuration shows for
 * the block's saved mode, opening the advanced ones when the block was saved advanced or holds an
 * advanced value, without fields that only configure the block as an agent tool.
 */
function visibleSubBlocks(config: BlockConfig, block: BlockState, values: Record<string, unknown>) {
  const trigger = block.triggerMode === true
  const canonicalIndex = buildCanonicalIndexForSurface(config.subBlocks, trigger)
  const advanced =
    (block.advancedMode ?? false) || hasAdvancedValues(config.subBlocks, values, canonicalIndex)
  const overrides = block.data?.canonicalModes
  return config.subBlocks.filter(
    (subBlock) =>
      !subBlock.hidden &&
      !subBlock.hideFromPreview &&
      isSubBlockVisibleForTriggerMode(subBlock, trigger, config) &&
      isSubBlockFeatureEnabled(subBlock) &&
      !isToolInputOnlySubBlock(subBlock) &&
      isSubBlockVisibleForMode(subBlock, advanced, canonicalIndex, values, overrides) &&
      evaluateSubBlockCondition(subBlock.condition, values)
  )
}

/** A frozen value as one line of text, as the editor's code field shows a collection. */
function textOf(value: unknown): string {
  if (value === undefined || value === null) return ''
  if (typeof value === 'string') return value
  return JSON.stringify(value) ?? ''
}

interface SubflowFieldsProps {
  block: BlockState
  workflowState: WorkflowState
}

/** A loop's or parallel's settings as the run or version froze them, read-only. */
function SubflowFields({ block, workflowState }: SubflowFieldsProps) {
  const data: NonNullable<BlockState['data']> = block.data ?? {}
  if (block.type === 'loop') {
    const loop = workflowState.loops[block.id]
    const type = loop?.loopType ?? data.loopType ?? 'for'
    const condition =
      type === 'while'
        ? (loop?.whileCondition ?? data.whileCondition)
        : (loop?.doWhileCondition ?? data.doWhileCondition)
    return (
      <div className={styles.fields}>
        <SelectField label='Loop Type' options={LOOP_TYPES} value={type} disabled />
        {type === 'for' ? (
          <TextField
            label='Loop Iterations'
            placeholder='5'
            value={String(loop?.iterations ?? data.count ?? DEFAULT_ITERATIONS)}
            viewOnly
          />
        ) : type === 'forEach' ? (
          <TextAreaField
            label='Collection Items'
            placeholder="['item1', 'item2', 'item3']"
            value={textOf(loop?.forEachItems ?? data.collection)}
            viewOnly
          />
        ) : (
          <TextAreaField
            label='While Condition'
            placeholder='<counter.value> < 10'
            value={textOf(condition)}
            viewOnly
          />
        )}
      </div>
    )
  }
  const parallel = workflowState.parallels[block.id]
  const type = parallel?.parallelType ?? data.parallelType ?? 'count'
  return (
    <div className={styles.fields}>
      <SelectField label='Parallel Type' options={PARALLEL_TYPES} value={type} disabled />
      {type === 'count' ? (
        <TextField
          label='Parallel Iterations'
          placeholder='1'
          value={String(parallel?.count ?? data.count ?? DEFAULT_PARALLEL_COUNT)}
          viewOnly
        />
      ) : (
        <TextAreaField
          label='Parallel Items'
          placeholder="['item1', 'item2', 'item3']"
          value={textOf(parallel?.distribution ?? data.collection)}
          viewOnly
        />
      )}
      <TextField
        label='Parallel Batch Size'
        placeholder='20'
        value={String(parallel?.batchSize ?? data.batchSize ?? DEFAULT_BATCH_SIZE)}
        viewOnly
      />
    </div>
  )
}

/** A field's frozen value as the text its Copy puts on the clipboard; secrets and accounts copy nothing. */
function copyableValue(config: BlockConfig['subBlocks'][number], subBlocks: SubBlockValues) {
  if (config.password || config.type === 'oauth-input') return ''
  const value: unknown = subBlocks[config.id]?.value
  if (value === undefined || value === null || value === '') return ''
  return typeof value === 'string' ? value : (JSON.stringify(value, null, 2) ?? '')
}

function payloadText(payload: TracePayload | undefined) {
  return payload && payload.format !== 'withheld' ? payload.content : ''
}

/** The step's input and output in one text, as legacy's Copy on the execution data put them. */
function stepText(step: TraceSpan) {
  return [
    ['Input', payloadText(step.input)],
    ['Output', payloadText(step.output)],
  ]
    .filter(([, content]) => content)
    .map(([label, content]) => `// ${label}\n${content}`)
    .join('\n\n')
}

interface ReferenceGroupProps {
  label: string
  references: readonly SnapshotReference[]
  copyable: boolean
  onFieldContextMenu: (event: MouseEvent, field: MetadataField) => void
}

function ReferenceGroup({ label, references, copyable, onFieldContextMenu }: ReferenceGroupProps) {
  return (
    <Disclosure label={label} initiallyOpen chevron>
      <MetadataFields
        label={`${label} values`}
        fields={references.map((reference) => ({
          id: reference.reference,
          label: reference.name,
          value: reference.value,
          copyable,
        }))}
        onFieldContextMenu={onFieldContextMenu}
      />
    </Disclosure>
  )
}

/**
 * Follows a drag on the pane's top edge, writing the height straight to the pane each frame and
 * committing it on release. Dragging up opens the pane, as legacy's docked Connections did.
 */
function trackPaneDrag(
  event: PointerEvent<HTMLDivElement>,
  pane: HTMLElement,
  startHeight: number,
  commit: (height: number) => void
) {
  event.preventDefault()
  const handle = event.currentTarget
  const { pointerId, clientY: startY } = event
  handle.setPointerCapture(pointerId)
  let height = startHeight
  const move = (moveEvent: globalThis.PointerEvent) => {
    if (moveEvent.pointerId !== pointerId) return
    height = Math.min(
      CONNECTIONS_MAX_HEIGHT,
      Math.max(CONNECTIONS_MIN_HEIGHT, startHeight + startY - moveEvent.clientY)
    )
    pane.style.setProperty('block-size', `${height}px`)
  }
  const end = (endEvent: globalThis.PointerEvent) => {
    if (endEvent.pointerId !== pointerId) return
    handle.removeEventListener('pointermove', move)
    handle.removeEventListener('pointerup', end)
    handle.removeEventListener('pointercancel', end)
    commit(height)
  }
  handle.addEventListener('pointermove', move)
  handle.addEventListener('pointerup', end)
  handle.addEventListener('pointercancel', end)
}

interface ConnectionsPaneProps {
  children: ReactNode
}

/**
 * Connections docked at the foot of the panel, as legacy's preview editor kept them: their own
 * scroll, a height the reader drags from the top edge, and a toggle that folds them to the header.
 * The height lasts while the block stays open.
 */
function ConnectionsPane({ children }: ConnectionsPaneProps) {
  const paneRef = useRef<HTMLElement>(null)
  const scrollEdges = useScrollEdges<HTMLDivElement>()
  const [height, setHeight] = useState(CONNECTIONS_DEFAULT_HEIGHT)
  useEffect(() => {
    paneRef.current?.style.setProperty('block-size', `${height}px`)
  }, [height])
  const collapsed = height <= CONNECTIONS_MIN_HEIGHT + 5
  return (
    <section ref={paneRef} className={styles.connections} aria-label='Connections'>
      <ResizeHandle
        edge='block-start'
        label='Resize connections'
        onPointerDown={(event) => {
          if (paneRef.current) trackPaneDrag(event, paneRef.current, height, setHeight)
        }}
      />
      <header className={styles.connectionsHeader}>
        <IconButton
          label={collapsed ? 'Expand connections' : 'Collapse connections'}
          icon={collapsed ? 'I032' : 'I051'}
          size='compact'
          onClick={() => setHeight(collapsed ? CONNECTIONS_DEFAULT_HEIGHT : CONNECTIONS_MIN_HEIGHT)}
        />
        <h3 className={styles.sectionHeading} data-type='T051'>
          Connections
        </h3>
      </header>
      {!collapsed && (
        <div ref={scrollEdges} className={styles.connectionsBody}>
          {children}
        </div>
      )}
    </section>
  )
}

/**
 * A block of a frozen workflow, as legacy's preview editor shows it beside a run snapshot or a
 * deployed version: the run's step for the block (or that the run never reached it), then every
 * field the block was configured with, rendered read-only by the editor's own field renderers from
 * the frozen values rather than the live stores, and what those fields reference.
 */
export function SnapshotBlock({ workspaceId, workflowState, blockId, run }: SnapshotBlockProps) {
  const block = workflowState.blocks[blockId]
  const config = block ? getBlock(block.type) : undefined
  const subBlocks: SubBlockValues = block?.subBlocks ?? {}
  const values = useMemo(() => rawValuesOf(subBlocks), [subBlocks])
  const canonicalModes = block?.data?.canonicalModes
  const dependencyContext = useMemo(
    () => ({ ...subBlocks, __canonicalModes: canonicalModes }),
    [subBlocks, canonicalModes]
  )
  const connections = useMemo(
    () => resolveSnapshotConnections(subBlocks, workflowState, run?.outputs ?? NO_OUTPUTS),
    [subBlocks, workflowState, run?.outputs]
  )
  const bodyRef = useRef<HTMLDivElement>(null)
  const find = useCodeViewerFeatures({ contentRef: bodyRef })
  const { copy } = useClipboard()
  const [menu, setMenu] = useState<PanelMenu | null>(null)
  const openMenu = (event: MouseEvent, actions: readonly MenuAction[]) => {
    event.preventDefault()
    setMenu({ x: event.clientX, y: event.clientY, actions })
  }
  const copyAction = (text: string): MenuAction => ({
    id: 'copy',
    label: 'Copy',
    onSelect: () => void copy(text),
  })
  const onReferenceContextMenu = (event: MouseEvent, field: MetadataField) => {
    if (field.copyable && field.value) openMenu(event, [copyAction(field.value)])
  }
  if (!block) return null
  const name = block.name || config?.name || block.type
  const isSubflow = block.type === 'loop' || block.type === 'parallel'
  const fields = config && !isSubflow ? visibleSubBlocks(config, block, values) : []
  const childWorkflowId =
    WORKFLOW_BLOCK_TYPES.has(block.type) &&
    typeof values.workflowId === 'string' &&
    values.workflowId
      ? values.workflowId
      : undefined
  const step = run?.step
  const stepCopy = step ? stepText(step) : ''
  const hasConnections =
    connections.blocks.length > 0 ||
    connections.variables.length > 0 ||
    connections.secrets.length > 0

  return (
    <ReactFlowProvider>
      <PreviewScope workspaceId={workspaceId}>
        <div className={styles.panel}>
          <div ref={bodyRef} className={styles.body}>
            {find.isSearchActive && (
              <FindBar
                label='Search step'
                query={find.searchQuery}
                onQueryChange={find.setSearchQuery}
                inputRef={find.searchInputRef}
                results={{ index: find.currentMatchIndex, count: find.matchCount }}
                onStep={(direction) =>
                  direction === 1 ? find.goToNextMatch() : find.goToPreviousMatch()
                }
                onClose={find.closeSearch}
              />
            )}
            {step ? (
              <div
                onContextMenu={(event) => {
                  if (stepCopy)
                    openMenu(event, [
                      copyAction(stepCopy),
                      { id: 'search', label: 'Search', onSelect: find.activateSearch },
                    ])
                }}
              >
                <SpanInspector
                  span={step}
                  search={
                    find.isSearchActive
                      ? {
                          query: find.searchQuery,
                          currentMatchIndex: find.currentMatchIndex,
                          onMatchCountChange: find.handleMatchCountChange,
                        }
                      : undefined
                  }
                />
              </div>
            ) : (
              <>
                <h2 className={styles.heading} data-type='T093'>
                  {name}
                </h2>
                {run && (
                  <MetadataFields
                    label={`${name} facts`}
                    fields={[{ id: 'status', label: 'Status', value: 'Not run' }]}
                  />
                )}
              </>
            )}
            {childWorkflowId &&
              (run ? (
                <FrozenWorkflowBlockPreview
                  workspaceId={workspaceId}
                  workflowState={run.child?.workflowState}
                  expandHref={run.child?.href}
                  unavailable={step ? 'Unable to load preview' : 'Not run'}
                />
              ) : (
                <WorkflowBlockPreview workspaceId={workspaceId} workflowId={childWorkflowId} />
              ))}
            <section className={styles.section} aria-label='Configuration'>
              <h3 className={styles.sectionHeading} data-type='T051'>
                Configuration
              </h3>
              {isSubflow ? (
                <SubflowFields block={block} workflowState={workflowState} />
              ) : !config ? (
                <EmptyState title='Block configuration not found' />
              ) : fields.length === 0 ? (
                <EmptyState title='This block has no configurable fields' />
              ) : (
                <div className={styles.fields}>
                  {fields.map((subBlock) => (
                    <div
                      key={subBlock.id}
                      className={styles.field}
                      data-tight={subBlock.hideDividerBefore || undefined}
                      onContextMenu={(event) => {
                        const text = copyableValue(subBlock, subBlocks)
                        if (text) openMenu(event, [copyAction(text)])
                      }}
                    >
                      <SubBlock
                        blockId={blockId}
                        config={subBlock}
                        isPreview
                        subBlockValues={subBlocks}
                        dependencyContext={dependencyContext}
                        disabled
                      />
                    </div>
                  ))}
                </div>
              )}
            </section>
          </div>
          {hasConnections && (
            <ConnectionsPane>
              {connections.blocks.map((connection) => (
                <ReferenceGroup
                  key={connection.blockId}
                  label={connection.blockName}
                  references={connection.fields}
                  copyable
                  onFieldContextMenu={onReferenceContextMenu}
                />
              ))}
              {connections.variables.length > 0 && (
                <ReferenceGroup
                  label='Variables'
                  references={connections.variables}
                  copyable
                  onFieldContextMenu={onReferenceContextMenu}
                />
              )}
              {connections.secrets.length > 0 && (
                <ReferenceGroup
                  label='Secrets'
                  references={connections.secrets}
                  copyable={false}
                  onFieldContextMenu={onReferenceContextMenu}
                />
              )}
            </ConnectionsPane>
          )}
          <PointActionMenu
            label='Value actions'
            point={menu}
            onClose={() => setMenu(null)}
            actions={menu?.actions ?? []}
          />
        </div>
      </PreviewScope>
    </ReactFlowProvider>
  )
}
