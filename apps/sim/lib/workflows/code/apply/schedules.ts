import type { Diagnostic } from '@sim/workflow-code'
import type { GraphDiff, SourceGraph } from '@/lib/workflows/code/apply/graph-diff'
import { findScheduleBlocks, validateScheduleBlock } from '@/lib/workflows/schedules/validation'

export type InvalidScheduleDiagnostic = Diagnostic<'E_APPLY_INVALID_SCHEDULE'>

/**
 * Refuses an added or changed enabled schedule whose timing cannot schedule, with the validator
 * deploy runs (`validateScheduleBlock`), so a dry run fails where deploy would instead of passing
 * and leaving deploy to refuse. A schedule whose type is still missing a field is a draft not
 * filled in yet; deploy refuses it, but the required-field gates own that, so it is not refused
 * here. `keyOf` names a block's source key by id, to locate each refusal.
 */
export function findInvalidSchedules(
  target: SourceGraph,
  diff: GraphDiff,
  keyOf: (id: string) => string | undefined
): InvalidScheduleDiagnostic[] {
  const changed = new Set([...diff.added, ...diff.modified.map((change) => change.id)])
  const refusals: InvalidScheduleDiagnostic[] = []
  for (const block of findScheduleBlocks(target.blocks)) {
    if (!changed.has(block.id)) continue
    const result = validateScheduleBlock(block)
    if (result.isValid || result.reason !== 'invalid') continue
    const blockKey = keyOf(block.id)
    refusals.push({
      code: 'E_APPLY_INVALID_SCHEDULE',
      severity: 'error',
      message: `Schedule "${block.name}" cannot run: ${result.error ?? 'its timing is invalid'}.`,
      blockId: block.id,
      ...(blockKey !== undefined ? { blockKey } : {}),
      hint: 'Write a five-field cron expression (minute hour day-of-month month day-of-week) and an IANA timezone such as America/New_York; deploy refuses this schedule as written.',
    })
  }
  return refusals
}
