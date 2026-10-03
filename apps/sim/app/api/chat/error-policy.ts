import {
  createInternalResourceConcealmentPolicy,
  type InternalErrorPolicy,
  internalErrorResponse,
} from '@/lib/api/server/routes'
import { ChatIdentifierInUseError } from '@/lib/chat-deployments/application'
import { asOrchestrationError, statusForOrchestrationError } from '@/lib/core/orchestration/types'

/**
 * Message the editor has always received for both a missing deployment and one
 * in a workspace the caller cannot reach — the two must stay indistinguishable.
 */
const CHAT_NOT_FOUND_MESSAGE = 'Chat not found or access denied'

/**
 * The internal chat surface's error envelope.
 *
 * Mirrors the `{ error, code }` body the hand-written routes emitted, including
 * the `code` derived from the message, so the editor's client sees no change.
 *
 * The one deliberate special case is {@link ChatIdentifierInUseError}. It is a
 * conflict, and the public API reports it as `409`; the editor has always
 * received `400` for it and its client recognises that pairing, so the status
 * is pinned here rather than by weakening the domain error.
 */
export function createInternalChatDeploymentErrorPolicy(fallback: string): InternalErrorPolicy {
  if (!fallback.trim()) throw new Error('Internal chat deployment error fallback is required')
  return createInternalResourceConcealmentPolicy({
    notFoundMessage: CHAT_NOT_FOUND_MESSAGE,
    base: {
      project(error) {
        if (error instanceof ChatIdentifierInUseError) {
          return internalErrorResponse(400, {
            error: error.message,
            code: legacyCode(error.message),
          })
        }
        const classified = asOrchestrationError(error)
        if (!classified) return null
        /**
         * A not-found is concealed wherever it came from, not only when the
         * concealment policy rewrites an authorization failure into one.
         *
         * The domain answers an absent deployment with its own wording, so the
         * editor received `Chat deployment not found` for a deployment that is
         * not there and `Chat not found or access denied` for one it may not
         * reach — two 404s a caller can tell apart, which is the existence
         * oracle this policy exists to close. The `code` is derived from the
         * message, so leaving the message alone leaked it twice over.
         *
         * Every `not_found` reachable here means the same thing: the chat
         * deployment is not available to this caller. None of them carries a
         * distinction worth preserving at the cost of the one they must not
         * make.
         */
        const message =
          classified.code === 'not_found' ? CHAT_NOT_FOUND_MESSAGE : classified.message
        return internalErrorResponse(statusForOrchestrationError(classified.code), {
          error: message,
          code: legacyCode(message),
        })
      },
      unhandled() {
        return internalErrorResponse(500, { error: fallback, code: legacyCode(fallback) })
      },
    },
  })
}

function legacyCode(message: string): string {
  return message.toUpperCase().replace(/\s+/g, '_')
}
