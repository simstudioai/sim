/** @vitest-environment node */
import { slackApp, slackSearchInstallation } from '@sim/db/schema'
import { queueTableRows, resetDbChainMock } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const m = vi.hoisted(() => ({ flag: vi.fn(), env: { SLACK_SEARCH_APP_ID: 'A1' } }))
vi.mock('@/lib/core/config/env', () => ({ env: m.env }))
vi.mock('@/lib/core/config/feature-flags', () => ({ isFeatureEnabled: m.flag }))

import {
  findSharedSlackSearchInstallation,
  readSharedSlackSearchApp,
  requireSlackSearchAppAvailable,
} from '@/lib/slack-search/shared-app'

beforeEach(() => {
  vi.clearAllMocks()
  resetDbChainMock()
  m.env.SLACK_SEARCH_APP_ID = 'A1'
  m.flag.mockResolvedValue(true)
})
describe('shared Slack rollout', () => {
  it.each([false, true])('requires both flag and configured app (flag=%s)', async (flag) => {
    m.flag.mockResolvedValue(flag)
    if (flag) m.env.SLACK_SEARCH_APP_ID = ''
    await expect(readSharedSlackSearchApp()).resolves.toBeNull()
  })
  it.each(
    [
      [],
      [{ id: 'A1', kind: 'custom', organizationId: 'org' }],
      [{ id: 'A1', kind: 'shared', organizationId: 'org' }],
    ].map((rows) => ({ rows }))
  )('fails closed for invalid registration %#', async ({ rows }) => {
    queueTableRows(slackApp, rows)
    await expect(readSharedSlackSearchApp()).rejects.toThrow('not registered')
  })
  it('preserves custom bot handling while the shared flag is off', async () => {
    m.flag.mockResolvedValue(false)
    queueTableRows(slackApp, [{ kind: 'custom' }])
    await expect(requireSlackSearchAppAvailable('CUSTOM')).resolves.toBeUndefined()
    expect(m.flag).not.toHaveBeenCalled()
  })
  it('refuses a shared bot while the shared flag is off', async () => {
    m.flag.mockResolvedValue(false)
    queueTableRows(slackApp, [{ kind: 'shared' }])
    await expect(requireSlackSearchAppAvailable('A1')).rejects.toThrow('unavailable')
  })
  it('rejects ambiguous organization installations', async () => {
    queueTableRows(slackApp, [{ id: 'A1', kind: 'shared', organizationId: null }])
    queueTableRows(slackSearchInstallation, [{ id: 'one' }, { id: 'two' }])
    await expect(findSharedSlackSearchInstallation('org')).rejects.toThrow('single Slack workspace')
  })
})
