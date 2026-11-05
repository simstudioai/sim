import type { ToolCallStatus } from '@/app/workspace/[workspaceId]/home/types'

export type MessagePhase = 'streaming' | 'revealing' | 'settled'

interface DeriveMessagePhaseArgs {
  isStreaming: boolean
  isRevealing: boolean
}

export function deriveMessagePhase({
  isStreaming,
  isRevealing,
}: DeriveMessagePhaseArgs): MessagePhase {
  if (isStreaming) return 'streaming'
  if (isRevealing) return 'revealing'
  return 'settled'
}

type ToolDisplayState = 'spinner' | 'awaiting_approval' | 'cancelled' | 'interrupted' | 'icon'

export function resolveToolDisplayState(status: ToolCallStatus): ToolDisplayState {
  // Pure projection of the tool's own status. A row spins iff it is genuinely
  // executing; every terminal status maps to a glyph. No transport/turn-live
  // gating — deterministic terminals (tool `result`, turn propagation) guarantee
  // a row never lingers `executing` after its work is done.
  if (status === 'executing') return 'spinner'
  // Waiting on a person, not on work: the row renders a permission card rather
  // than a spinner, so it must not read as in-progress.
  if (status === 'awaiting_approval') return 'awaiting_approval'
  if (status === 'cancelled') return 'cancelled'
  if (status === 'interrupted') return 'interrupted'
  return 'icon'
}

export function isToolDone(status: ToolCallStatus): boolean {
  return (
    status === 'success' ||
    status === 'error' ||
    status === 'cancelled' ||
    status === 'skipped' ||
    status === 'rejected' ||
    status === 'interrupted'
  )
}
