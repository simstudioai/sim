import type { SessionPrincipal } from '@sim/auth/principal'
import type { CopilotChatSteerInput } from '@/lib/api/contracts/copilot'
import { defineOrganizationOperation } from '@/lib/core/application/organization-operation'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { defineAuthorizedChatUseCase } from '@/lib/mothership/chat/application/authorized-chat-use-case'
import {
  dropSteeringRecord,
  loadSteeringRecord,
  readSteeringRecord,
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
   * Steers the message into the turn and returns its disposition. It is recorded (as
   * steering of its turn) before the worker is asked, so a retry of the same id finds
   * the record and reads what became of it instead of sending it again. A record no
   * run holds (the first send never arrived, or the run it named is over) is stale:
   * it is dropped and the message is steered afresh. The worker keeps one identity
   * per steering id across the chat, so even then it is never applied twice. Once
   * final, the disposition is kept on the record and answers later reads.
   *
   * A steering id that names a turn's own message is a conflict, and its row keeps its
   * content: a send the server admitted without answering must not steer itself, and
   * a stale tab must not turn someone's turn back into a record.
   */
  async execute({ principal, input, context }) {
    const { streamId, steeringId, content } = input
    const { userId, chatId } = context
    if (streamId === steeringId) throw alreadyATurn()
    const recorded = await loadSteeringRecord(chatId, steeringId)
    if (recorded) {
      if (recorded.content !== content) {
        throw new OrchestrationError(
          'conflict',
          'This steering id was already used for other content.'
        )
      }
      const reading = await readSteeringRecord({
        chatId,
        messageId: steeringId,
        record: recorded,
        userId,
      })
      if (reading.status === 'held') return { steeringId, status: 'queued' as const }
      if (reading.status === 'applied') return { steeringId, ...reading }
      await dropSteeringRecord(chatId, steeringId)
    }
    const prepared = await prepareSteeringInput({ principal, chat: context, input })
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
        steering: { streamId },
      },
      { streamId }
    )
    if (!stored) throw alreadyATurn()
    const result = await requestStreamSteering({
      streamId,
      userId,
      chatId,
      steeringId,
      content,
      context: prepared.context,
      ...(prepared.assistantImages ? { assistantImages: prepared.assistantImages } : {}),
    })
    if (result.status === 'refused') throw new SteeringNotQueuedError(result.goStatus)
    if (result.status === 'queued') {
      if (!(await steeredRunHasEnded(streamId, userId))) return { steeringId, ...result }
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
