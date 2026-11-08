import { useCallback } from 'react'
import { toRecord } from '@sim/utils/object'
import { useCollaborativeWorkflow } from '@/hooks/use-collaborative-workflow'
import { useWorkflowStore } from '@/stores/workflows/workflow/store'
import type { BlockState } from '@/stores/workflows/workflow/types'

type LoopType = 'for' | 'forEach' | 'while' | 'doWhile'
type ParallelType = 'count' | 'collection'

const LOOP_TYPE_LABELS: Record<LoopType, string> = {
  for: 'For Loop',
  forEach: 'For Each',
  while: 'While Loop',
  doWhile: 'Do While Loop',
}
const PARALLEL_TYPE_LABELS: Record<ParallelType, string> = {
  count: 'Parallel Count',
  collection: 'Parallel Each',
}
const DEFAULT_ITERATIONS = 5
/** The widest batch a parallel runs at once, and its default. */
const MAX_PARALLEL_BATCH_SIZE = 20

/**
 * A loop's or parallel's iteration settings as the canvas holds them (falling back to the block's
 * own data before its subflow entry exists), with the collaborative writes that change them.
 */
export function useSubflowConfig(block: BlockState, blockId: string) {
  const kind = block.type === 'parallel' ? 'parallel' : 'loop'
  const node = useWorkflowStore(
    useCallback(
      (state) =>
        kind === 'loop' ? (state.loops[blockId] ?? null) : (state.parallels[blockId] ?? null),
      [kind, blockId]
    )
  )
  const nodeData = toRecord(node)
  const blockData = toRecord(block.data)
  const read = (key: string) => nodeData[key] ?? blockData[key]

  const {
    collaborativeUpdateLoopType,
    collaborativeUpdateParallelType,
    collaborativeUpdateParallelBatchSize,
    collaborativeUpdateIterationCount,
    collaborativeUpdateIterationCollection,
  } = useCollaborativeWorkflow()

  const typeKey = kind === 'loop' ? 'loopType' : 'parallelType'
  const currentType = String(read(typeKey) || (kind === 'loop' ? 'for' : 'count'))
  const isCountMode = currentType === 'for' || currentType === 'count'
  const isConditionMode = currentType === 'while' || currentType === 'doWhile'

  const iterationsValue = kind === 'loop' ? nodeData.iterations : nodeData.count
  const iterations = Number(iterationsValue ?? blockData.count ?? DEFAULT_ITERATIONS)
  const collection =
    (kind === 'loop' ? nodeData.forEachItems : nodeData.distribution) ?? blockData.collection ?? ''
  const conditionKey =
    currentType === 'while'
      ? 'whileCondition'
      : currentType === 'doWhile'
        ? 'doWhileCondition'
        : null
  const condition = conditionKey ? read(conditionKey) : ''
  const batchSize = Number(read('batchSize') ?? MAX_PARALLEL_BATCH_SIZE)

  const collectionString =
    typeof collection === 'string' ? collection : JSON.stringify(collection) || ''
  const editorValue = isConditionMode
    ? typeof condition === 'string'
      ? condition
      : ''
    : collectionString

  const typeOptions = Object.entries(kind === 'loop' ? LOOP_TYPE_LABELS : PARALLEL_TYPE_LABELS).map(
    ([value, label]) => ({ value, label })
  )

  const setType = (next: string) => {
    if (kind === 'loop') collaborativeUpdateLoopType(blockId, next as LoopType)
    else collaborativeUpdateParallelType(blockId, next as ParallelType)
  }
  const setIterations = (count: number) =>
    collaborativeUpdateIterationCount(blockId, kind, Math.max(1, count))
  const setBatchSize = (size: number) =>
    collaborativeUpdateParallelBatchSize(
      blockId,
      Math.min(MAX_PARALLEL_BATCH_SIZE, Math.max(1, size))
    )
  const setEditorValue = (value: string) =>
    collaborativeUpdateIterationCollection(blockId, kind, value)

  return {
    kind,
    currentType,
    isCountMode,
    isConditionMode,
    iterations,
    batchSize,
    editorValue,
    typeOptions,
    setType,
    setIterations,
    setBatchSize,
    setEditorValue,
  }
}
