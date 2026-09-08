/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { buildCredentialGroupTriggerPayload } from '@/lib/credential-groups/trigger'
import { CREDENTIAL_GROUP_TRIGGER_EVENT_TYPES } from '@/lib/credential-groups/trigger-constants'
import { credentialGroupEventTrigger } from '@/triggers/credential-group/event'

describe('Credential Group trigger definition', () => {
  it('requires no group selection to watch workspace account events', () => {
    expect(credentialGroupEventTrigger.subBlocks.map((field) => field.id)).toEqual([
      'eventType',
      'triggerInstructions',
    ])
  })

  it('exposes the supported lifecycle events', () => {
    const eventType = credentialGroupEventTrigger.subBlocks.find(
      (subBlock) => subBlock.id === 'eventType'
    )
    const optionIds = Array.isArray(eventType?.options)
      ? eventType.options.map((option) => option.id)
      : []

    expect(optionIds).toEqual(CREDENTIAL_GROUP_TRIGGER_EVENT_TYPES)
  })

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
