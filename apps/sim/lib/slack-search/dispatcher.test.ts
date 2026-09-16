/** @vitest-environment node */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ home: vi.fn(), message: vi.fn(), stop: vi.fn() }))
vi.mock('@/lib/knowledge/application/slack-search/home', () => ({
  receiveSlackSearchHome: { execute: mocks.home },
}))
vi.mock('@/lib/knowledge/application/slack-search/process-message', () => ({
  receiveSlackSearchMessage: { execute: mocks.message },
}))
vi.mock('@/lib/knowledge/application/slack-search/stop', () => ({
  slackSearchStopSchema: { safeParse: () => ({ success: false }) },
  stopSlackSearchThread: { execute: mocks.stop },
}))

import { dispatchSlackSearch } from '@/lib/slack-search/dispatcher'

beforeEach(() => vi.clearAllMocks())
describe('authenticated Slack Home dispatch', () => {
  function dispatch(tab: string) {
    return dispatchSlackSearch({
      credentialId: 'c1',
      credentialVersion: 'v1',
      receivedAt: Date.now(),
      body: {
        type: 'event_callback',
        api_app_id: 'A1',
        team_id: 'T1',
        event_id: 'Ev1',
        event_time: Math.floor(Date.now() / 1000),
        event: { type: 'app_home_opened', user: 'U1', tab },
      },
    })
  }
  it('routes only Home opens to the Home application use case', async () => {
    await dispatch('home')
    expect(mocks.home).toHaveBeenCalledWith({
      principal: {
        kind: 'slack_installation',
        credentialId: 'c1',
        credentialVersion: 'v1',
        appId: 'A1',
        teamId: 'T1',
        eventId: 'Ev1',
        receivedAt: expect.any(Date),
      },
      input: { appId: 'A1', teamId: 'T1', eventId: 'Ev1', userId: 'U1' },
    })
    expect(mocks.message).not.toHaveBeenCalled()
    expect(mocks.stop).not.toHaveBeenCalled()
  })
  it('acknowledges opening Messages without sending a chat response or replacing Home', async () => {
    await dispatch('messages')
    expect(mocks.home).not.toHaveBeenCalled()
    expect(mocks.message).not.toHaveBeenCalled()
  })
})
