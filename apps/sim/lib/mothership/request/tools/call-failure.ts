import { createLogger } from '@sim/logger'
import { toError } from '@sim/utils/errors'
import { MothershipStreamV1ToolOutcome } from '@/lib/mothership/generated/mothership-stream-v1'
import { sealProjectedClientToolCompletion } from '@/lib/mothership/request/tools/client-completion-seal.server'
import { settleClientToolCall } from '@/lib/mothership/request/tools/client-settlement.server'

const logger = createLogger('CopilotToolCallFailure')

/**
 * How a server-owned failure ended:
 * - `settled`: this write won and its result was published;
 * - `lost`: another transition (a claim or a result) already moved the row;
 * - `superseded`: the call settled locally while the failure was being sealed;
 * - `failed`: the failure could not be persisted.
 */
type ToolCallFailureSettlement = 'settled' | 'lost' | 'superseded' | 'failed'

/**
 * Settles a call Sim gives up on with a fixed server-owned failure, sealed like a client
 * completion so its waiter (in this process or another) restores it. No content of the abandoned
 * call is certified. With `unclaimedOnly` the failure applies only while nothing has claimed the
 * call, the inverse of the desktop's claim, so exactly one of the two wins.
 */
export async function settleToolCallFailure(input: {
  toolCallId: string
  runId?: string
  userId: string
  message: string
  data: Record<string, unknown>
  unclaimedOnly: boolean
  settledLocally?: () => boolean
}): Promise<ToolCallFailureSettlement> {
  const { toolCallId, message, data } = input
  try {
    let durableData: unknown = data
    if (input.runId) {
      // These server-authored failures contain no tool input or output to project.
      durableData = await sealProjectedClientToolCompletion({
        toolCallId,
        runId: input.runId,
        userId: input.userId,
        status: MothershipStreamV1ToolOutcome.error,
        message,
        data,
      })
    }
    if (input.settledLocally?.()) return 'superseded'
    const outcome = await settleClientToolCall({
      toolCallId,
      status: MothershipStreamV1ToolOutcome.error,
      message,
      data: durableData,
      guard: input.unclaimedOnly ? { kind: 'pending' } : { kind: 'open' },
    })
    return outcome === 'updated' ? 'settled' : 'lost'
  } catch (error) {
    logger.warn('Failed to persist a server-owned tool failure', {
      toolCallId,
      error: toError(error).message,
    })
    return 'failed'
  }
}
