/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { getSlackManagedUsersFailureNotification } from '@/ee/credential-groups/components/slack-managed-users-modal'

describe('Slack managed-user authorization notifications', () => {
  it('treats provider cancellation as a non-error outcome', () => {
    expect(getSlackManagedUsersFailureNotification('provider_error')).toEqual({
      message: 'Slack authorization canceled',
      variant: 'warning',
    })
  })

  it('keeps verification failures in the error state', () => {
    expect(getSlackManagedUsersFailureNotification('invalid_response')).toEqual({
      message: 'Slack app verification failed. Please try again.',
      variant: 'error',
    })
  })
})
