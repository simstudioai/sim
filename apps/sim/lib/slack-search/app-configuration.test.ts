/** @vitest-environment node */
import { db } from '@sim/db'
import { slackApp } from '@sim/db/schema'
import { queueTableRows, resetDbChainMock } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const m = vi.hoisted(() => ({
  env: {
    SLACK_SEARCH_APP_ID: 'ASHARED',
    SLACK_SEARCH_CLIENT_ID: '123.456',
    SLACK_SEARCH_CLIENT_SECRET: 'environment-client-secret',
    SLACK_SEARCH_SIGNING_SECRET: 'environment-signing-secret',
  },
  decrypt: vi.fn(async (value: string) => ({ decrypted: value.replace('encrypted:', '') })),
}))
vi.mock('@/lib/core/config/env', () => ({ env: m.env }))
vi.mock('@/lib/core/security/encryption', () => ({ decryptSecret: m.decrypt }))

import {
  loadSlackAppConfiguration,
  resolveSlackAppCredentials,
  slackBotCredentialVersion,
} from '@/lib/slack-search/app-configuration'
import { getSharedSlackSearchAppConfiguration } from '@/lib/slack-search/shared-app-env'

const stored = {
  id: 'ASHARED',
  kind: 'shared' as const,
  organizationId: null,
  clientId: 'old-client',
  encryptedClientSecret: 'encrypted:old-client-secret',
  encryptedSigningSecret: 'encrypted:old-signing-secret',
  revision: 'old-revision',
  createdAt: new Date(0),
  updatedAt: new Date(0),
}
const credentialKeys = [
  'SLACK_SEARCH_CLIENT_ID',
  'SLACK_SEARCH_CLIENT_SECRET',
  'SLACK_SEARCH_SIGNING_SECRET',
] as const

beforeEach(() => {
  vi.clearAllMocks()
  resetDbChainMock()
  Object.assign(m.env, {
    SLACK_SEARCH_APP_ID: 'ASHARED',
    SLACK_SEARCH_CLIENT_ID: '123.456',
    SLACK_SEARCH_CLIENT_SECRET: 'environment-client-secret',
    SLACK_SEARCH_SIGNING_SECRET: 'environment-signing-secret',
  })
})

describe('deployment-owned Slack app configuration', () => {
  it('authenticates shared ingress without a database registration', async () => {
    await expect(loadSlackAppConfiguration('ASHARED')).resolves.toMatchObject({
      signingSecret: 'environment-signing-secret',
      app: { id: 'ASHARED', kind: 'shared', organizationId: null },
    })
    expect(db.select).not.toHaveBeenCalled()
    expect(m.decrypt).not.toHaveBeenCalled()
  })

  it('ignores previously registered credentials for the configured company app', async () => {
    await expect(resolveSlackAppCredentials(stored)).resolves.toMatchObject({
      clientId: '123.456',
      clientSecret: 'environment-client-secret',
    })
    expect(m.decrypt).not.toHaveBeenCalled()
  })

  it.each(credentialKeys)('does not use stored secrets when %s is missing', async (key) => {
    m.env[key] = ''
    queueTableRows(slackApp, [stored])
    await expect(loadSlackAppConfiguration('ASHARED')).rejects.toThrow('Configure SLACK_SEARCH')
    await expect(resolveSlackAppCredentials(stored)).rejects.toThrow('Configure SLACK_SEARCH')
    expect(m.decrypt).not.toHaveBeenCalled()
  })

  it.each(credentialKeys)('invalidates queued work when %s rotates', (key) => {
    const previous = getSharedSlackSearchAppConfiguration()?.revision
    expect(getSharedSlackSearchAppConfiguration()?.revision).toBe(previous)
    m.env[key] = 'rotated'
    const current = getSharedSlackSearchAppConfiguration()?.revision
    expect(current).not.toBe(previous)
    expect(slackBotCredentialVersion('token', current)).not.toBe(
      slackBotCredentialVersion('token', previous)
    )
  })

  it('preserves custom ingress when shared credentials are incomplete', async () => {
    m.env.SLACK_SEARCH_CLIENT_SECRET = ''
    queueTableRows(slackApp, [{ ...stored, id: 'ACUSTOM', kind: 'custom', organizationId: 'org' }])
    await expect(loadSlackAppConfiguration('ACUSTOM')).resolves.toMatchObject({
      signingSecret: 'old-signing-secret',
    })
  })

  it('rejects company identity colliding with a custom app owner', async () => {
    await expect(
      resolveSlackAppCredentials({ ...stored, kind: 'custom', organizationId: 'org' })
    ).rejects.toThrow('belongs to a custom installation')
  })

  it('never assigns the shared signing key to an unknown app', async () => {
    await expect(loadSlackAppConfiguration('AUNKNOWN')).resolves.toBeNull()
  })
})
