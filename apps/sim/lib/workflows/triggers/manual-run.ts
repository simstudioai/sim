import {
  resolveStartCandidates,
  type StartBlockCandidate,
  StartBlockPath,
} from '@/lib/workflows/triggers/triggers'
import { selectBestTrigger } from '@/lib/workflows/triggers/utils'

export interface ManualRunEntryIssue {
  reason: 'no-trigger' | 'multiple-api-triggers' | 'trigger-not-connected'
  /** The error a manual run raises, word for word. */
  message: string
  /** The trigger the run would start from, when the problem is that trigger. */
  blockId?: string
  blockName?: string
  blockType?: string
}

type ManualRunBlock = {
  type: string
  name?: string
  enabled?: boolean
  subBlocks?: Record<string, unknown>
}

type ManualRunEntry<T extends ManualRunBlock> =
  | { ok: true; candidate: StartBlockCandidate<T> }
  | { ok: false; issue: ManualRunEntryIssue }

/**
 * Picks the block a manual (editor Run button) execution starts from, or the
 * reason that run is refused before it begins. Disabled blocks never qualify.
 * Shared by the run hook and the workflow lint so the two cannot disagree on
 * what a manual run accepts.
 */
export function resolveManualRunEntry<T extends ManualRunBlock>(
  blocks: Record<string, T>,
  edges: Array<{ source: string; target: string }>
): ManualRunEntry<T> {
  const candidates = resolveStartCandidates(blocks, { execution: 'manual' })
  if (candidates.length === 0) {
    return {
      ok: false,
      issue: {
        reason: 'no-trigger',
        message: 'Workflow requires at least one trigger block to execute',
      },
    }
  }

  if (candidates.filter((c) => c.path === StartBlockPath.SPLIT_API).length > 1) {
    return {
      ok: false,
      issue: {
        reason: 'multiple-api-triggers',
        message: 'Multiple API Trigger blocks found. Keep only one.',
      },
    }
  }

  const candidate = selectBestTrigger(candidates, edges)[0]
  if (
    candidate.path !== StartBlockPath.LEGACY_STARTER &&
    !edges.some((edge) => edge.source === candidate.blockId)
  ) {
    return {
      ok: false,
      issue: {
        reason: 'trigger-not-connected',
        message: `${candidate.block.name || candidate.block.type} must be connected to other blocks to execute`,
        blockId: candidate.blockId,
        blockName: candidate.block.name,
        blockType: candidate.block.type,
      },
    }
  }

  return { ok: true, candidate }
}
