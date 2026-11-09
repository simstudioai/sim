'use client'

import { useMemo } from 'react'
import { Disclosure } from '@sim/emcn/disclosure'
import { EmptyState } from '@sim/emcn/empty-state'
import { SelectField, TextAreaField, TextField } from '@sim/emcn/field'
import { ReactFlowProvider } from '@xyflow/react'
import { MetadataFields } from '@/app/(product)/_components/workspace/metadata-fields/metadata-fields'
import { SpanInspector } from '@/app/(product)/_components/workspace/span-inspector/span-inspector'
import { PreviewScope } from '@/app/(product)/_components/workspace/workflows/canvas/workflow-preview/preview-scope'
import {
  SubBlock,
  type SubBlockValues,
} from '@/app/(product)/workspace/[workspaceId]/workflows/_components/editor/sub-block/sub-block'
import { WorkflowBlockPreview } from '@/app/(product)/workspace/[workspaceId]/workflows/_components/editor/workflow-block-preview/workflow-block-preview'
import styles from '@/app/(product)/workspace/[workspaceId]/workflows/_components/snapshot-block/snapshot-block.module.css'
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
import type { TraceSpan } from '@/platform/shared/workspace-records'

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

interface SnapshotBlockProps {
  workspaceId: string
  workflowState: WorkflowState
  blockId: string
  /**
   * A run's snapshot: the block's recorded step, absent when the run never reached it, and every
   * block's recorded output, which the block's references read. A deployed version has no run.
   */
  run?: { step?: TraceSpan; outputs: ReadonlyMap<string, { output?: unknown }> }
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

interface ReferenceGroupProps {
  label: string
  references: readonly SnapshotReference[]
  copyable: boolean
}

function ReferenceGroup({ label, references, copyable }: ReferenceGroupProps) {
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
      />
    </Disclosure>
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
  if (!block) return null
  const name = block.name || config?.name || block.type
  const isSubflow = block.type === 'loop' || block.type === 'parallel'
  const fields = config && !isSubflow ? visibleSubBlocks(config, block, values) : []
  const childWorkflowId =
    !run &&
    (block.type === 'workflow' || block.type === 'workflow_input') &&
    typeof values.workflowId === 'string' &&
    values.workflowId
      ? values.workflowId
      : undefined
  const hasConnections =
    connections.blocks.length > 0 ||
    connections.variables.length > 0 ||
    connections.secrets.length > 0

  return (
    <ReactFlowProvider>
      <PreviewScope workspaceId={workspaceId}>
        <div className={styles.panel}>
          {run?.step ? (
            <SpanInspector span={run.step} />
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
          {childWorkflowId && (
            <WorkflowBlockPreview workspaceId={workspaceId} workflowId={childWorkflowId} />
          )}
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
          {hasConnections && (
            <section className={styles.section} aria-label='Connections'>
              <h3 className={styles.sectionHeading} data-type='T051'>
                Connections
              </h3>
              {connections.blocks.map((connection) => (
                <ReferenceGroup
                  key={connection.blockId}
                  label={connection.blockName}
                  references={connection.fields}
                  copyable
                />
              ))}
              {connections.variables.length > 0 && (
                <ReferenceGroup label='Variables' references={connections.variables} copyable />
              )}
              {connections.secrets.length > 0 && (
                <ReferenceGroup label='Secrets' references={connections.secrets} copyable={false} />
              )}
            </section>
          )}
        </div>
      </PreviewScope>
    </ReactFlowProvider>
  )
}
