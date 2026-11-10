import { describe, expect, it } from 'vitest'
import { canOpenOrganizationChat } from '@/platform/shared/chat-open'

const access = (memberScoped: boolean, mothershipAvailable = true) => ({
  mothershipAvailable,
  searchAccess: { memberScoped },
})

/** Failure mode: a chat is offered and then its route sends the viewer elsewhere. */
describe('canOpenOrganizationChat', () => {
  it.each([
    ['a member with chat on an agent chat', access(false), true, 'agent', true],
    ['a member without Search on an assistant chat', access(false), true, 'assistant', false],
    ['a Plan chat once Plan is off', access(true), false, 'plan', false],
    ['a Plan chat while Plan is on', access(false), true, 'plan', true],
    ['anything without chat', access(true, false), true, 'agent', false],
    ['an assistant chat without chat', access(true, false), true, 'assistant', false],
    ['a member with Search on an assistant chat', access(true), true, 'assistant', true],
    ['an optimistic chat with no mode', access(false), true, undefined, true],
  ])('%s', (_case, viewer, planEnabled, mode, expected) => {
    expect(canOpenOrganizationChat(viewer, planEnabled, mode)).toBe(expected)
  })
})
