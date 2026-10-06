import { createLogger } from '@sim/logger'
import { toError } from '@sim/utils/errors'
import {
  completeAsyncToolCall,
  completePendingAsyncToolCall,
} from '@/lib/mothership/async-runs/repository'
import {
  MothershipStreamV1AsyncToolRecordStatus,
  MothershipStreamV1ToolOutcome,
} from '@/lib/mothership/generated/mothership-stream-v1'
import { publishToolConfirmation } from '@/lib/mothership/persistence/tool-confirm'
import {
  sealClientToolCompletion,
  sealClientToolContext,
} from '@/lib/mothership/request/tools/client-completion-seal.server'
import type { ResolvedSecretTraceRegistry } from '@/executor/utils/resolved-secret-trace-registry'

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
  registry?: ResolvedSecretTraceRegistry
  message: string
  data: Record<string, unknown>
  unclaimedOnly: boolean
  settledLocally?: () => boolean
}): Promise<ToolCallFailureSettlement> {
  const { toolCallId, message, data } = input
  try {
    let durableData: unknown = data
    if (input.runId && input.registry) {
      const binding = { toolCallId, runId: input.runId, userId: input.userId }
      const [completion, provenance] = await Promise.all([
        sealClientToolCompletion({ ...binding, message, data }),
        sealClientToolContext({
          ...binding,
          registry: input.registry,
          /** The fixed failure contains no output or arguments from the abandoned call. */
          toolInput: undefined,
        }),
      ])
      durableData = { ...completion, ...provenance }
    }
    if (input.settledLocally?.()) return 'superseded'
    const failure = {
      toolCallId,
      status: MothershipStreamV1AsyncToolRecordStatus.failed,
      result: durableData,
      error: message,
    }
    const completed = input.unclaimedOnly
      ? await completePendingAsyncToolCall(failure)
      : await completeAsyncToolCall(failure)
    if (!completed) return 'lost'
    publishToolConfirmation({
      toolCallId,
      status: MothershipStreamV1ToolOutcome.error,
      message,
      data: durableData,
      timestamp: new Date().toISOString(),
    })
    return 'settled'
  } catch (error) {
    logger.warn('Failed to persist a server-owned tool failure', {
      toolCallId,
      error: toError(error).message,
    })
    return 'failed'
  }
}
