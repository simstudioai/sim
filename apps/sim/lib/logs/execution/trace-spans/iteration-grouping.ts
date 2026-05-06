import { createLogger } from '@sim/logger'
import type { TraceSpan } from '@/lib/logs/types'
import { stripCloneSuffixes } from '@/executor/utils/subflow-utils'

const logger = createLogger('IterationGrouping')

/** Counter state for generating sequential container names. */
interface ContainerNameCounters {
  loopNumbers: Map<string, number>
  parallelNumbers: Map<string, number>
  loopCounter: number
  parallelCounter: number
}

/**
 * Builds a container-level TraceSpan (iteration wrapper or top-level container)
 * from its source spans and resolved children.
 */
function buildContainerSpan(opts: {
  id: string
  name: string
  type: string
  sourceSpans: TraceSpan[]
  children: TraceSpan[]
}): TraceSpan {
  const startTimes = opts.sourceSpans.map((s) => new Date(s.startTime).getTime())
  const endTimes = opts.sourceSpans.map((s) => new Date(s.endTime).getTime())

  // Guard against empty sourceSpans — Math.min/max of empty array returns ±Infinity
  // which produces NaN durations and invalid Dates downstream.
  const nowMs = Date.now()
  const earliestStart = startTimes.length > 0 ? Math.min(...startTimes) : nowMs
  const latestEnd = endTimes.length > 0 ? Math.max(...endTimes) : nowMs

  const hasErrors = opts.sourceSpans.some((s) => s.status === 'error')
  const allErrorsHandled =
    hasErrors && opts.children.every((s) => s.status !== 'error' || s.errorHandled)

  return {
    id: opts.id,
    name: opts.name,
    type: opts.type,
    duration: Math.max(0, latestEnd - earliestStart),
    startTime: new Date(earliestStart).toISOString(),
    endTime: new Date(latestEnd).toISOString(),
    status: hasErrors ? 'error' : 'success',
    ...(allErrorsHandled && { errorHandled: true }),
    children: opts.children,
  }
}

/**
 * Resolves a container name from normal (non-iteration) spans or assigns a sequential number.
 * Strips clone suffixes so all clones of the same container share one name/number.
 */
function resolveContainerName(
  containerId: string,
  containerType: 'parallel' | 'loop',
  normalSpans: TraceSpan[],
  counters: ContainerNameCounters
): string {
  const originalId = stripCloneSuffixes(containerId)

  const matchingBlock = normalSpans.find(
    (s) => s.blockId === originalId && s.type === containerType
  )
  if (matchingBlock?.name) return matchingBlock.name

  if (containerType === 'parallel') {
    if (!counters.parallelNumbers.has(originalId)) {
      counters.parallelNumbers.set(originalId, counters.parallelCounter++)
    }
    return `Parallel ${counters.parallelNumbers.get(originalId)}`
  }
  if (!counters.loopNumbers.has(originalId)) {
    counters.loopNumbers.set(originalId, counters.loopCounter++)
  }
  return `Loop ${counters.loopNumbers.get(originalId)}`
}

/**
 * Classifies a span's immediate container ID and type from its metadata.
 * Returns undefined for non-iteration spans.
 */
function classifySpanContainer(
  span: TraceSpan
): { containerId: string; containerType: 'parallel' | 'loop' } | undefined {
  if (span.parallelId) {
    return { containerId: span.parallelId, containerType: 'parallel' }
  }
  if (span.loopId) {
    return { containerId: span.loopId, containerType: 'loop' }
  }
  if (span.blockId?.includes('_parallel_')) {
    const match = span.blockId.match(/_parallel_([^_]+)_iteration_/)
    if (match) {
      return { containerId: match[1], containerType: 'parallel' }
    }
  }
  return undefined
}

/**
 * Finds the outermost container for a span. For nested spans, this is parentIterations[0].
 * For flat spans, this is the span's own immediate container.
 */
function getOutermostContainer(
  span: TraceSpan
): { containerId: string; containerType: 'parallel' | 'loop' } | undefined {
  if (span.parentIterations && span.parentIterations.length > 0) {
    const outermost = span.parentIterations[0]
    return {
      containerId: outermost.iterationContainerId,
      containerType: outermost.iterationType as 'parallel' | 'loop',
    }
  }
  return classifySpanContainer(span)
}

/**
 * Builds the iteration-level hierarchy for a container, recursively nesting
 * any deeper subflows. Works with both:
 * - Direct spans (spans whose immediate container matches)
 * - Nested spans (spans with parentIterations pointing through this container)
 */
function buildContainerChildren(
  containerType: 'parallel' | 'loop',
  containerId: string,
  spans: TraceSpan[],
  normalSpans: TraceSpan[],
  counters: ContainerNameCounters
): TraceSpan[] {
  const iterationType = containerType === 'parallel' ? 'parallel-iteration' : 'loop-iteration'

  const iterationGroups = new Map<number, TraceSpan[]>()

  for (const span of spans) {
    let iterIdx: number | undefined

    if (
      span.parentIterations &&
      span.parentIterations.length > 0 &&
      span.parentIterations[0].iterationContainerId === containerId
    ) {
      iterIdx = span.parentIterations[0].iterationCurrent
    } else {
      iterIdx = span.iterationIndex
    }

    if (iterIdx === undefined) {
      logger.warn('Skipping iteration span without iterationIndex', {
        spanId: span.id,
        blockId: span.blockId,
        containerId,
      })
      continue
    }

    if (!iterationGroups.has(iterIdx)) iterationGroups.set(iterIdx, [])
    iterationGroups.get(iterIdx)!.push(span)
  }

  const iterationChildren: TraceSpan[] = []
  const sortedIterations = Array.from(iterationGroups.entries()).sort(([a], [b]) => a - b)

  for (const [iterationIndex, iterSpans] of sortedIterations) {
    const directLeaves: TraceSpan[] = []
    const deeperSpans: TraceSpan[] = []

    for (const span of iterSpans) {
      if (
        span.parentIterations &&
        span.parentIterations.length > 0 &&
        span.parentIterations[0].iterationContainerId === containerId
      ) {
        deeperSpans.push({
          ...span,
          parentIterations: span.parentIterations.slice(1),
        })
      } else {
        directLeaves.push({
          ...span,
          name: span.name.replace(/ \(iteration \d+\)$/, ''),
        })
      }
    }

    const nestedResult = groupIterationBlocksRecursive(
      [...directLeaves, ...deeperSpans],
      normalSpans,
      counters
    )

    iterationChildren.push(
      buildContainerSpan({
        id: `${containerId}-iteration-${iterationIndex}`,
        name: `Iteration ${iterationIndex}`,
        type: iterationType,
        sourceSpans: iterSpans,
        children: nestedResult,
      })
    )
  }

  return iterationChildren
}

/**
 * Core recursive algorithm for grouping iteration blocks.
 *
 * Handles two cases:
 * 1. **Flat** (backward compat): spans have loopId/parallelId + iterationIndex but no
 *    parentIterations. Grouped by immediate container -> iteration -> leaf.
 * 2. **Nested** (new): spans have parentIterations chains. The outermost ancestor in the
 *    chain determines the top-level container. Iteration spans are peeled one level at a
 *    time and recursed.
 */
function groupIterationBlocksRecursive(
  spans: TraceSpan[],
  normalSpans: TraceSpan[],
  counters: ContainerNameCounters
): TraceSpan[] {
  const result: TraceSpan[] = []
  const iterationSpans: TraceSpan[] = []
  const nonIterationSpans: TraceSpan[] = []

  for (const span of spans) {
    if (
      (span.name.match(/^(.+) \(iteration (\d+)\)$/) &&
        (span.loopId || span.parallelId || span.blockId?.includes('_parallel_'))) ||
      (span.parentIterations && span.parentIterations.length > 0)
    ) {
      iterationSpans.push(span)
    } else {
      nonIterationSpans.push(span)
    }
  }

  const containerIdsWithIterations = new Set<string>()
  for (const span of iterationSpans) {
    const outermost = getOutermostContainer(span)
    if (outermost) containerIdsWithIterations.add(outermost.containerId)
  }

  const nonContainerSpans = nonIterationSpans.filter(
    (span) =>
      (span.type !== 'parallel' && span.type !== 'loop') ||
      span.status === 'error' ||
      (span.blockId && !containerIdsWithIterations.has(span.blockId))
  )

  if (iterationSpans.length === 0) {
    result.push(...nonContainerSpans)
    result.sort((a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime())
    return result
  }

  const containerGroups = new Map<
    string,
    { type: 'parallel' | 'loop'; containerId: string; containerName: string; spans: TraceSpan[] }
  >()

  for (const span of iterationSpans) {
    const outermost = getOutermostContainer(span)
    if (!outermost) continue

    const { containerId, containerType } = outermost
    const groupKey = `${containerType}_${containerId}`

    if (!containerGroups.has(groupKey)) {
      const containerName = resolveContainerName(containerId, containerType, normalSpans, counters)
      containerGroups.set(groupKey, {
        type: containerType,
        containerId,
        containerName,
        spans: [],
      })
    }
    containerGroups.get(groupKey)!.spans.push(span)
  }

  for (const [, group] of containerGroups) {
    const { type, containerId, containerName, spans: containerSpans } = group

    const iterationChildren = buildContainerChildren(
      type,
      containerId,
      containerSpans,
      normalSpans,
      counters
    )

    result.push(
      buildContainerSpan({
        id: `${type === 'parallel' ? 'parallel' : 'loop'}-execution-${containerId}`,
        name: containerName,
        type,
        sourceSpans: containerSpans,
        children: iterationChildren,
      })
    )
  }

  result.push(...nonContainerSpans)
  result.sort((a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime())

  return result
}

/**
 * Groups iteration-based blocks (parallel and loop) by organizing their iteration spans
 * into a hierarchical structure with proper parent-child relationships.
 * Supports recursive nesting via parentIterations (e.g., parallel-in-parallel, loop-in-loop).
 */
export function groupIterationBlocks(spans: TraceSpan[]): TraceSpan[] {
  const normalSpans = spans.filter((s) => !s.name.match(/^(.+) \(iteration (\d+)\)$/))
  const counters: ContainerNameCounters = {
    loopNumbers: new Map<string, number>(),
    parallelNumbers: new Map<string, number>(),
    loopCounter: 1,
    parallelCounter: 1,
  }
  return groupIterationBlocksRecursive(spans, normalSpans, counters)
}
