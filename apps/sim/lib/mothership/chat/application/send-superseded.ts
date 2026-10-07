import { OrchestrationError } from '@/lib/core/orchestration/types'

/**
 * Admission found this send's claim taken by another attempt with the same
 * `userMessageId`: this attempt held its in-progress claim past the 60s TTL
 * before admitting (branch, attachment and context preparation can run that
 * long), and a retry re-claimed it. That attempt may admit the turn, so the
 * client must treat this like a duplicate, not a refusal.
 */
export class ChatSendSupersededError extends OrchestrationError {
  constructor() {
    super('conflict', 'This send was superseded; retry the message')
    this.name = 'ChatSendSupersededError'
  }
}
