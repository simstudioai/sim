/** @vitest-environment node */
import { db } from '@sim/db'
import { slackApp, slackSearchInstallation } from '@sim/db/schema'
import { queueTableRows, resetDbChainMock } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const m = vi.hoisted(() => ({
  flag: vi.fn(),
  env: {
    SLACK_SEARCH_APP_ID: 'A1',
    SLACK_SEARCH_CLIENT_ID: 'client',
    SLACK_SEARCH_CLIENT_SECRET: 'secret',
    SLACK_SEARCH_SIGNING_SECRET: 'signing',
  },
}))
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
  Object.assign(m.env, {
    SLACK_SEARCH_APP_ID: 'A1',
    SLACK_SEARCH_CLIENT_ID: 'client',
    SLACK_SEARCH_CLIENT_SECRET: 'secret',
    SLACK_SEARCH_SIGNING_SECRET: 'signing',
  })
  m.flag.mockResolvedValue(true)
})
describe('shared Slack rollout', () => {
  it.each([false, true])('requires both flag and configured app (flag=%s)', async (flag) => {
    m.flag.mockResolvedValue(flag)
    if (flag) m.env.SLACK_SEARCH_APP_ID = ''
    await expect(readSharedSlackSearchApp()).resolves.toBeNull()
  })
  it.each([
    'SLACK_SEARCH_CLIENT_ID',
    'SLACK_SEARCH_CLIENT_SECRET',
    'SLACK_SEARCH_SIGNING_SECRET',
  ] as const)('fails closed without %s', async (key) => {
    m.env[key] = ''
    await expect(readSharedSlackSearchApp()).rejects.toThrow('Configure SLACK_SEARCH_APP_ID')
  })
  it('uses deployment credentials without requiring a registered database row', async () => {
    await expect(readSharedSlackSearchApp()).resolves.toMatchObject({
      id: 'A1',
      clientId: 'client',
      clientSecret: 'secret',
      signingSecret: 'signing',
    })
    expect(db.select).not.toHaveBeenCalled()
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
