import type { TraceSpan } from '@/lib/logs/types'
import type { ConsoleEntry } from '@/stores/terminal/console/types'

/**
 * Parameters for extracting child workflow entries from trace spans
 */
interface ExtractChildWorkflowEntriesParams {
  parentBlockId: string
  executionId: string
  executionOrder: number
  workflowId: string
  childTraceSpans: TraceSpan[]
}

/**
 * Extracts child workflow trace spans into console entry payloads.
 * Handles recursive nesting for multi-level child workflows by flattening
 * nested children with a parent block ID chain.
 */
export function extractChildWorkflowEntries(
  params: ExtractChildWorkflowEntriesParams
): Omit<ConsoleEntry, 'id' | 'timestamp'>[] {
  const { parentBlockId, executionId, executionOrder, workflowId, childTraceSpans } = params
  const entries: Omit<ConsoleEntry, 'id' | 'timestamp'>[] = []

  for (const span of childTraceSpans) {
    if (!span.blockId) continue

    const childBlockId = `child-${parentBlockId}-${span.blockId}`

    entries.push({
      blockId: childBlockId,
      blockName: span.name || 'Unknown Block',
      blockType: span.type || 'unknown',
      parentWorkflowBlockId: parentBlockId,
      input: span.input || {},
      output: (span.output || {}) as ConsoleEntry['output'],
      durationMs: span.duration,
      startedAt: span.startTime,
      endedAt: span.endTime,
      success: span.status !== 'error',
      error:
        span.status === 'error'
          ? (span.output?.error as string) || `${span.name || 'Block'} failed`
          : undefined,
      executionId,
      executionOrder,
      workflowId,
    })

    // Recursively extract nested child workflow spans
    if (span.children && span.children.length > 0 && span.type === 'workflow') {
      const nestedEntries = extractChildWorkflowEntries({
        parentBlockId: childBlockId,
        executionId,
        executionOrder,
        workflowId,
        childTraceSpans: span.children,
      })
      entries.push(...nestedEntries)
    }
  }

  return entries
}

/**
 * Checks if a block completed event output contains child trace spans
 */
export function hasChildTraceSpans(output: unknown): output is Record<string, unknown> & {
  childTraceSpans: TraceSpan[]
} {
  return (
    output !== null &&
    typeof output === 'object' &&
    Array.isArray((output as Record<string, unknown>).childTraceSpans)
  )
}
