import type { SessionPrincipal } from '@sim/auth/principal'
import type { CopilotChatSteerInput } from '@/lib/api/contracts/copilot'
import { defineOrganizationOperation } from '@/lib/core/application/organization-operation'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { defineAuthorizedChatUseCase } from '@/lib/mothership/chat/application/authorized-chat-use-case'
import {
  loadSteeringRecord,
  steeredRunHasEnded,
} from '@/lib/mothership/chat/application/steering-fallback'
import {
  appendSteeringMessageIfAbsent,
  recordSteeringDisposition,
} from '@/lib/mothership/chat/messages-store'
import { normalizeContexts } from '@/lib/mothership/chat/normalize-contexts'
import {
  buildPersistedUserMessage,
  type PersistedMessageContext,
} from '@/lib/mothership/chat/persisted-message'
import {
  resolveRunContext,
  runControlOperations,
} from '@/lib/mothership/request/application/controls'
import { prepareSteeringInput } from '@/lib/mothership/request/application/steering-input'
import { requestStreamSteering } from '@/lib/mothership/request/session/steer'

export class SteeringNotQueuedError extends Error {
  constructor(readonly goStatus: number) {
    super('Steering was not queued')
  }
}

export const steerRun = defineAuthorizedChatUseCase({
  operation: runControlOperations.steer,
  organizationOperation: defineOrganizationOperation({
    id: 'mothership.runs.steer',
    minimumRole: 'member',
    capability: 'copilot.use',
    principalKinds: ['session'],
  }),
  resolveContext: (args: { principal: SessionPrincipal; input: CopilotChatSteerInput }) =>
    resolveRunContext(args),
  authorizationOptions: {},
  /**
   * Returns the disposition of the steering id. The message is recorded (as steering
   * of its turn, with the exact input it sends) before the worker is asked, so a
   * retry of the same id re-sends identical input and reads the same disposition even
   * after the first answer was lost: the sender does that when its turn ended without
   * the `steering_applied` frame. A worker that refuses it leaves the record to be
   * cleared when the message goes out as a turn. Once final, the disposition is kept
   * on the record and answers later reads, and the input is dropped.
   *
   * A steering id that names a turn's own message is a conflict, and its row keeps its
   * content: a send the server admitted without answering must not steer itself, and
   * a stale tab must not turn someone's turn back into a record.
   */
  async execute({ principal, input, context }) {
    const { streamId, steeringId, content } = input
    const { userId, chatId } = context
    if (streamId === steeringId) throw alreadyATurn()
    let recorded = await loadSteeringRecord(chatId, steeringId)
    if (!recorded) {
      const prepared = await prepareSteeringInput({ principal, chat: context, input })
      const sent = {
        context: prepared.context,
        ...(prepared.assistantImages ? { assistantImages: prepared.assistantImages } : {}),
      }
      const stored = await appendSteeringMessageIfAbsent(
        chatId,
        {
          ...buildPersistedUserMessage({
            id: steeringId,
            content,
            ...(context.mode === 'assistant' || context.mode === 'plan' || context.mode === 'agent'
              ? { requestMode: context.mode }
              : {}),
            ...(prepared.fileAttachments ? { fileAttachments: prepared.fileAttachments } : {}),
            ...(input.contexts?.length
              ? { contexts: normalizeContexts(input.contexts) as PersistedMessageContext[] }
              : {}),
          }),
          steering: { streamId, input: sent },
        },
        { streamId }
      )
      recorded = stored
        ? { streamId, content, input: sent }
        : await loadSteeringRecord(chatId, steeringId)
      if (!recorded) throw alreadyATurn()
    }
    if (recorded.content !== content) {
      throw new OrchestrationError(
        'conflict',
        'This steering id was already used for other content.'
      )
    }
    if (recorded.disposition) return { steeringId, ...recorded.disposition }
    const result = await requestStreamSteering({
      streamId: recorded.streamId,
      userId,
      chatId,
      steeringId,
      content,
      ...recorded.input,
    })
    if (result.status === 'refused') throw new SteeringNotQueuedError(result.goStatus)
    if (result.status === 'queued') {
      if (!(await steeredRunHasEnded(recorded.streamId, userId))) return { steeringId, ...result }
      await recordSteeringDisposition(chatId, [steeringId], { status: 'not_applied' })
      return { steeringId, status: 'not_applied' as const }
    }
    await recordSteeringDisposition(chatId, [steeringId], result)
    return { steeringId, ...result }
  },
})

function alreadyATurn(): OrchestrationError {
  return new OrchestrationError('conflict', 'This message already went out as a turn.')
}
