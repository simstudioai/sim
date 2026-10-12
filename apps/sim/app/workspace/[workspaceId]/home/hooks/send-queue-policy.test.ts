import { describe, expect, it } from 'vitest'
import {
  requeuedFields,
  resendVerdict,
  sendPayload,
  withoutRequeueFields,
} from '@/app/workspace/[workspaceId]/home/hooks/send-queue-policy'
import type { MothershipChatHistory } from '@/hooks/queries/mothership-chats'

describe('requeuedFields', () => {
  it('holds an offline send for the network, on its chatless surface', () => {
    expect(requeuedFields('offline', 0, 'ws-1:home')).toEqual({
      hold: 'online',
      heldSurface: 'ws-1:home',
    })
  })

  it.each(['unreachable', 'busy'] as const)('retries a %s send on a growing delay', (reason) => {
    const before = Date.now()
    const fields = requeuedFields(reason, 2, undefined)

    expect(fields.retry?.attempt).toBe(3)
    expect(fields.retry?.notBefore).toBeGreaterThan(before)
    expect(fields.hold).toBeUndefined()
    expect(fields.heldSurface).toBeUndefined()
  })

  it.each(['stop-failed', 'failed'] as const)(
    'leaves a %s send for the user, adoptable by its chatless surface',
    (reason) => {
      expect(requeuedFields(reason, 4, 'ws-1:home')).toEqual({
        hold: 'user',
        heldSurface: 'ws-1:home',
      })
      expect(requeuedFields(reason, 4, undefined)).toEqual({ hold: 'user' })
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
        hold: 'online',
        retry: { attempt: 2, notBefore: 123 },
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

describe('resendVerdict', () => {
  const history = (accepted: string[] = [], activeStreamId: string | null = null) =>
    ({
      id: 'chat-A',
      mode: 'agent',
      title: 'A',
      messages: accepted.map((id) => ({
        id,
        role: 'user' as const,
        content: 'sent',
        timestamp: new Date(0).toISOString(),
      })),
      activeStreamId,
      resources: [],
    }) satisfies MothershipChatHistory
  const resumed = {
    id: 'm1',
    content: 'hello',
    resumeUserMessageId: 'attempt-1',
    admissionUnknown: true,
  }

  it('sends a message the server cannot already hold, without reading history', () => {
    expect(resendVerdict({ id: 'm1', content: 'hello' }, null)).toBe('send')
    expect(resendVerdict({ ...resumed, admissionUnknown: false }, null)).toBe('send')
  })

  it('drops a message the history shows accepted, as a message or as the running turn', () => {
    expect(resendVerdict(resumed, history(['attempt-1']))).toBe('drop')
    expect(resendVerdict(resumed, history([], 'attempt-1'))).toBe('drop')
  })

  it('sends a message the history does not show', () => {
    expect(resendVerdict(resumed, history(['other']))).toBe('send')
  })

  it('waits when the history could not be read', () => {
    expect(resendVerdict(resumed, null)).toBe('wait')
  })
})
