import { MothershipStreamV1ToolOutcome } from '@/lib/copilot/generated/mothership-stream-v1'

type TerminalToolOutcome =
  | typeof MothershipStreamV1ToolOutcome.success
  | typeof MothershipStreamV1ToolOutcome.error
  | typeof MothershipStreamV1ToolOutcome.cancelled
  | typeof MothershipStreamV1ToolOutcome.skipped
  | typeof MothershipStreamV1ToolOutcome.rejected

interface ResolveStreamToolOutcomeParams {
  output?: unknown
  status?: string
  success?: boolean
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

export function resolveStreamToolOutcome({
  output,
  status,
  success,
}: ResolveStreamToolOutcomeParams): TerminalToolOutcome {
  const outputRecord = isRecord(output) ? output : undefined
  const isCancelled =
    outputRecord?.reason === 'user_cancelled' ||
    outputRecord?.cancelledByUser === true ||
    status === MothershipStreamV1ToolOutcome.cancelled

  if (isCancelled) {
    return MothershipStreamV1ToolOutcome.cancelled
  }

  switch (status) {
    case MothershipStreamV1ToolOutcome.success:
    case MothershipStreamV1ToolOutcome.error:
    case MothershipStreamV1ToolOutcome.skipped:
    case MothershipStreamV1ToolOutcome.rejected:
      return status
    default:
      return success === true
        ? MothershipStreamV1ToolOutcome.success
        : MothershipStreamV1ToolOutcome.error
  }
}
