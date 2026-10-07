import { describe, expect, it } from 'vitest'
import {
  requeuedFields,
  sendPayload,
  withoutRequeueFields,
} from '@/app/workspace/[workspaceId]/home/hooks/send-queue-policy'

describe('requeuedFields', () => {
  it('holds an offline send for the network, on its chatless surface', () => {
    expect(requeuedFields('offline', 0, 'ws-1:home')).toEqual({
      retryRequired: true,
      heldUntilOnline: true,
      heldSurface: 'ws-1:home',
    })
  })

  it.each(['unreachable', 'busy'] as const)('retries a %s send on a growing delay', (reason) => {
    const before = Date.now()
    const fields = requeuedFields(reason, 2, undefined)

    expect(fields.sendRetries).toBe(3)
    expect(fields.notBefore).toBeGreaterThan(before)
    expect(fields.retryRequired).toBeUndefined()
    expect(fields.heldSurface).toBeUndefined()
  })

  it.each(['stop-failed', 'failed'] as const)(
    'leaves a %s send for the user, on any surface',
    (reason) => {
      expect(requeuedFields(reason, 4, 'ws-1:home')).toEqual({ retryRequired: true })
    }
  )

  it('sends a withdrawn message again as soon as the queue drains', () => {
    expect(requeuedFields('withdrawn', 1, undefined)).toEqual({})
  })
})

describe('withoutRequeueFields', () => {
  it('drops every hold, retry and surface field and keeps the message itself', () => {
    expect(
      withoutRequeueFields({
        id: 'm1',
        content: 'hello',
        resumeUserMessageId: 'attempt-1',
        admissionUnknown: true,
        retryRequired: true,
        heldUntilOnline: true,
        sendRetries: 2,
        notBefore: 123,
        heldSurface: 'ws-1:home',
      })
    ).toEqual({
      id: 'm1',
      content: 'hello',
      resumeUserMessageId: 'attempt-1',
      admissionUnknown: true,
    })
  })
})

describe('sendPayload', () => {
  it('keeps only the fields a send sets', () => {
    expect(
      sendPayload({
        content: 'hello',
        fileAttachments: undefined,
        requestMode: 'assistant',
        assistantSearchLevel: undefined,
      })
    ).toEqual({ content: 'hello', requestMode: 'assistant' })
  })
})
