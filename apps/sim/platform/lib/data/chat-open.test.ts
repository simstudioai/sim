import { describe, expect, it } from 'vitest'
import { canOpenOrganizationChat } from '@/platform/lib/data/chat-open'

const access = (canBuild: boolean, memberScoped: boolean, mothershipAvailable = true) => ({
  mothershipAvailable,
  canBuild,
  searchAccess: { memberScoped },
})

/** Failure mode: a chat is offered and then its route sends the viewer elsewhere. */
describe('canOpenOrganizationChat', () => {
  it.each([
    ['a search-only member on an agent chat', access(false, true), true, 'agent', false],
    [
      'a builder without search on an assistant chat',
      access(true, false),
      true,
      'assistant',
      false,
    ],
    ['a Plan chat once Plan is off', access(true, true), false, 'plan', false],
    ['anything with the assistant off', access(true, true, false), true, 'agent', false],
    ['a search-only member on an assistant chat', access(false, true), true, 'assistant', true],
    ['an optimistic chat with no mode', access(false, true), true, undefined, true],
  ])('%s', (_case, viewer, planEnabled, mode, expected) => {
    expect(canOpenOrganizationChat(viewer, planEnabled, mode)).toBe(expected)
  })
})
