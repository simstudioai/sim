import { OrchestrationError } from '@/lib/core/orchestration/types'

export class InvitationNotPendingError extends OrchestrationError {
  constructor(action: 'resend' | 'revoke') {
    super('conflict', `Can only ${action} unexpired pending invitations`)
    this.name = 'InvitationNotPendingError'
  }
}
