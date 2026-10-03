import { describe, expect, it } from 'vitest'
import { buildCredentialGroupTriggerPayload } from '@/lib/credential-groups/trigger'
import { credentialGroupEventTrigger } from '@/triggers/credential-group/event'

describe('Credential Group trigger definition', () => {
  it('keeps declared outputs aligned with runtime payload keys', () => {
    const payload = buildCredentialGroupTriggerPayload({
      event: 'form_submitted',
      workspaceId: 'workspace-1',
      credentialGroupId: 'group-1',
      credentialGroupName: 'Credential Group',
      enrollmentId: 'enrollment-1',
      email: 'person@example.com',
      enrollmentStatus: 'completed',
    })

    expect(Object.keys(payload).sort()).toEqual(
      Object.keys(credentialGroupEventTrigger.outputs).sort()
    )
  })
})
