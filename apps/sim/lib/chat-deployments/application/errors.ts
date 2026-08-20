import { OrchestrationError } from '@/lib/core/orchestration/types'

/**
 * The requested chat identifier is already taken by another live deployment.
 *
 * A distinct class rather than a bare conflict because the two surfaces answer
 * it differently: the public API reports the `409` the condition actually is,
 * while the internal editor keeps the `400` it has always sent, which its
 * client recognises. A shared error policy cannot tell one conflict from
 * another, so the distinction has to be a type rather than a message.
 */
export class ChatIdentifierInUseError extends OrchestrationError {
  constructor(message = 'Identifier already in use') {
    super('conflict', message)
    this.name = 'ChatIdentifierInUseError'
  }
}
