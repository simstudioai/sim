/** @vitest-environment node */
import { db } from '@sim/db'
import { slackApp, slackSearchInstallation } from '@sim/db/schema'
import { queueTableRows, resetDbChainMock } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const m = vi.hoisted(() => ({
  hosted: true,
  flag: vi.fn(),
  env: {
    SLACK_SEARCH_APP_ID: 'A1',
    SLACK_SEARCH_CLIENT_ID: 'client',
    SLACK_SEARCH_CLIENT_SECRET: 'secret',
    SLACK_SEARCH_SIGNING_SECRET: 'signing',
  },
}))
vi.mock('@/lib/core/config/env', () => ({ env: m.env }))
vi.mock('@/lib/core/config/env-flags', () => ({
  get isHosted() {
    return m.hosted
  },
}))
vi.mock('@/lib/core/config/feature-flags', () => ({ isFeatureEnabled: m.flag }))

import {
  findSharedSlackSearchInstallation,
  readSharedSlackSearchApp,
  requireSlackSearchAppAvailable,
} from '@/lib/slack-search/shared-app'

beforeEach(() => {
  vi.clearAllMocks()
  resetDbChainMock()
  m.hosted = true
  Object.assign(m.env, {
    SLACK_SEARCH_APP_ID: 'A1',
    SLACK_SEARCH_CLIENT_ID: 'client',
    SLACK_SEARCH_CLIENT_SECRET: 'secret',
    SLACK_SEARCH_SIGNING_SECRET: 'signing',
  })
  m.flag.mockResolvedValue(true)
})
describe('shared Slack rollout', () => {
  it('only exposes and authorizes the shared app for an enabled organization', async () => {
    m.flag.mockImplementation(async (_flag, context) => context?.orgId === 'review-org')
    await expect(readSharedSlackSearchApp('review-org')).resolves.toHaveProperty('id', 'A1')
    await expect(requireSlackSearchAppAvailable('A1', 'review-org')).resolves.toBeUndefined()
    await expect(readSharedSlackSearchApp('other-org')).resolves.toBeNull()
    await expect(requireSlackSearchAppAvailable('A1', 'other-org')).rejects.toThrow('unavailable')
    await expect(findSharedSlackSearchInstallation('other-org')).resolves.toBeNull()
    expect(db.select).not.toHaveBeenCalled()
  })
  it('requires a hosted deployment even when configured and enabled', async () => {
    m.hosted = false
    await expect(readSharedSlackSearchApp('org')).resolves.toBeNull()
    await expect(requireSlackSearchAppAvailable('A1', 'org')).rejects.toThrow('unavailable')
    expect(m.flag).not.toHaveBeenCalled()
  })
  it('preserves custom bot handling on self-hosted deployments', async () => {
    m.hosted = false
    queueTableRows(slackApp, [{ kind: 'custom' }])
    await expect(requireSlackSearchAppAvailable('CUSTOM', 'org')).resolves.toBeUndefined()
  })
  it.each([false, true])('requires both flag and configured app (flag=%s)', async (flag) => {
    m.flag.mockResolvedValue(flag)
    if (flag) m.env.SLACK_SEARCH_APP_ID = ''
    await expect(readSharedSlackSearchApp('org')).resolves.toBeNull()
  })
  it.each([
    'SLACK_SEARCH_CLIENT_ID',
    'SLACK_SEARCH_CLIENT_SECRET',
    'SLACK_SEARCH_SIGNING_SECRET',
  ] as const)('fails closed without %s', async (key) => {
    m.env[key] = ''
    await expect(readSharedSlackSearchApp('org')).rejects.toThrow('Configure SLACK_SEARCH_APP_ID')
  })
  it('uses deployment credentials without requiring a registered database row', async () => {
    await expect(readSharedSlackSearchApp('org')).resolves.toMatchObject({
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
    await expect(requireSlackSearchAppAvailable('CUSTOM', 'org')).resolves.toBeUndefined()
    expect(m.flag).not.toHaveBeenCalled()
  })
  it('refuses a shared bot while the shared flag is off', async () => {
    m.flag.mockResolvedValue(false)
    queueTableRows(slackApp, [{ kind: 'shared' }])
    await expect(requireSlackSearchAppAvailable('A1', 'org')).rejects.toThrow('unavailable')
  })
  it('rejects ambiguous organization installations', async () => {
    queueTableRows(slackApp, [{ id: 'A1', kind: 'shared', organizationId: null }])
    queueTableRows(slackSearchInstallation, [{ id: 'one' }, { id: 'two' }])
    await expect(findSharedSlackSearchInstallation('org')).rejects.toThrow('single Slack workspace')
  })
})
