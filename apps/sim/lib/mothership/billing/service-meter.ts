import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { generateId } from '@sim/utils/id'
import { isHosted } from '@/lib/core/config/env-flags'
import { replayServiceUsage } from '@/lib/mothership/billing/service-delivery'
import { observeServiceCosts } from '@/lib/mothership/billing/service-observer'
import {
  beginServiceMeter,
  finishServiceUsage,
  saveServiceUsage,
} from '@/lib/mothership/billing/service-store'
import { ServiceUsageReceipt } from '@/lib/mothership/generated/billing'
import type { ToolExecutionContext } from '@/lib/mothership/tool-executor/types'

const logger = createLogger('CopilotServiceMeter')

/** Scope is supplied by the admitted tool runtime, never by model arguments. */
export async function withToolServiceMeter<T>(
  context: ToolExecutionContext,
  execute: () => Promise<T>
): Promise<T> {
  if (!isHosted || !context.copilotToolExecution) return execute()
  const streamId = context.messageId
  const toolCallId = context.toolCallId
  const workerOrigin = context.mothershipBaseURL
  if (!streamId || !toolCallId || !workerOrigin) throw new Error('Tool billing scope is missing')
  const id = generateId()
  await beginServiceMeter({ id, streamId, toolCallId, workerOrigin })
  let failed = false
  const markFailure = async (error: string) => {
    failed = true
    await finishServiceUsage(id, error)
  }
  try {
    return await observeServiceCosts(
      async (service, costUsd) => {
        const receipt = ServiceUsageReceipt.parse({
          id: generateId(),
          streamId,
          toolCallId,
          service,
          costUsd,
        })
        try {
          await saveServiceUsage(receipt, workerOrigin)
          void replayServiceUsage().catch((error) =>
            logger.warn('Immediate service delivery deferred to replay', {
              error: getErrorMessage(error),
            })
          )
        } catch (error) {
          await markFailure(getErrorMessage(error))
          throw error
        }
      },
      execute,
      markFailure
    )
  } catch (error) {
    if (!failed) await markFailure(getErrorMessage(error))
    throw error
  } finally {
    if (!failed) await finishServiceUsage(id)
  }
}
