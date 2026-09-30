import { createHmac } from 'node:crypto'
import { setEnv } from '@sim/testing/mocks/env.mock'
import { createMockRequest } from '@sim/testing/mocks/request.mock'
import { urlsMockFns } from '@sim/testing/mocks/urls.mock'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { decryptSecret, encryptSecret } from '@/lib/core/security/encryption'
import { planetscaleHandler } from '@/lib/webhooks/providers/planetscale'
import type {
  AuthContext,
  EventMatchContext,
  FormatInputContext,
  SubscriptionContext,
} from '@/lib/webhooks/providers/types'

const credentials = {
  triggerServiceTokenId: 'fixture-id',
  triggerServiceToken: 'fixture-token',
  triggerOrganization: 'fixture-org',
  database: 'fixture-db',
  triggerId: 'planetscale_branch_ready',
}
const body = {
  event: 'branch.ready',
  timestamp: 1698252879,
  organization: 'fixture-org',
  database: 'fixture-db',
  resource: {
    id: 'branch-id',
    name: 'dev',
    ready: false,
    production: false,
    safe_migrations: false,
    parent_branch: 'main',
    created_at: '2023-10-25T16:54:12.879Z',
  },
}
const rawBody = JSON.stringify(body, null, 2)
const secret = 'fixture-signing-secret'
function authContext(
  webhookSecret: unknown,
  raw = rawBody,
  signature = createHmac('sha256', secret).update(rawBody).digest('hex')
): AuthContext {
  return {
    webhook: {},
    workflow: {},
    requestId: 'test',
    providerConfig: { webhookSecret },
    rawBody: raw,
    request: createMockRequest({
      method: 'POST',
      rawBody: raw,
      headers: { 'X-PlanetScale-Signature': signature },
    }),
  }
}
function subscription(config: Record<string, unknown> = {}): SubscriptionContext {
  return {
    webhook: {
      id: 'fixture-hook',
      path: 'fixture-path',
      providerConfig: { ...credentials, ...config },
    },
    workflow: {},
    userId: 'fixture-user',
    requestId: 'test',
  }
}
function eventContext(config: Record<string, unknown>, payload: unknown = body): EventMatchContext {
  return {
    webhook: {},
    workflow: {},
    body: payload,
    request: createMockRequest('POST', payload),
    requestId: 'test',
    providerConfig: config,
  }
}
function formatContext(payload: unknown, triggerId: string): FormatInputContext {
  return {
    webhook: { providerConfig: { triggerId } },
    workflow: { id: 'fixture-workflow', userId: 'fixture-user' },
    body: payload,
    headers: {},
    query: {},
    method: 'POST',
    requestId: 'test',
  }
}

describe('PlanetScale signed delivery contracts', () => {
  beforeEach(() => setEnv({ ENCRYPTION_KEY: '11'.repeat(32) }))

  it('authenticates encrypted secrets over the exact bytes and rejects parsed-body substitutions', async () => {
    const { encrypted } = await encryptSecret(secret)
    expect(await planetscaleHandler.verifyAuth!(authContext(encrypted))).toBeNull()
    expect(
      (await planetscaleHandler.verifyAuth!(authContext(encrypted, JSON.stringify(body))))?.status
    ).toBe(401)
  })

  it.each([undefined, '', secret, '00:corrupt:00'])(
    'fails closed for missing, plaintext or corrupt secret: %s',
    async (value) => {
      expect((await planetscaleHandler.verifyAuth!(authContext(value)))?.status).toBe(401)
    }
  )

  it.each(['', 'sha256=1234', 'g'.repeat(64), '0'.repeat(64)])(
    'rejects invalid signature bytes: %s',
    async (signature) => {
      const { encrypted } = await encryptSecret(secret)
      expect(
        (await planetscaleHandler.verifyAuth!(authContext(encrypted, rawBody, signature)))?.status
      ).toBe(401)
    }
  )

  it('filters dedicated and selected generic production events without accepting probes or unknowns', async () => {
    expect(await planetscaleHandler.matchEvent!(eventContext(credentials))).toBe(true)
    expect(
      await planetscaleHandler.matchEvent!(
        eventContext(credentials, { ...body, event: 'backup.succeeded' })
      )
    ).toBe(false)
    const config = { triggerId: 'planetscale_webhook', events: ['cluster.storage'] }
    expect(
      await planetscaleHandler.matchEvent!(
        eventContext(config, { ...body, event: 'cluster.storage' })
      )
    ).toBe(true)
    for (const event of ['branch.ready', 'webhook.test', 'unknown.event']) {
      expect(await planetscaleHandler.matchEvent!(eventContext(config, { ...body, event }))).toBe(
        false
      )
    }
    expect(
      planetscaleHandler.handleReachabilityTest!({ ...body, event: 'webhook.test' }, 'test')?.status
    ).toBe(200)
  })

  it('projects documented branch, backup and deploy fields while preserving false, zero, null and original payload', async () => {
    const branch = await planetscaleHandler.formatInput!(formatContext(body, credentials.triggerId))
    expect(branch.input).toMatchObject({
      ...body,
      resource: {
        id: 'branch-id',
        name: 'dev',
        ready: false,
        production: false,
        safeMigrations: false,
        parentBranch: 'main',
        updatedAt: null,
      },
      payload: body,
    })
    const backup = {
      ...body,
      event: 'backup.succeeded',
      resource: {
        id: 'backup-id',
        state: 'success',
        size: 0,
        protected: false,
        database_branch: { id: 'branch-id', name: 'main' },
      },
    }
    expect(
      (await planetscaleHandler.formatInput!(formatContext(backup, 'planetscale_backup_succeeded')))
        .input
    ).toMatchObject({
      resource: {
        size: 0,
        protected: false,
        completedAt: null,
        branch: { id: 'branch-id', name: 'main' },
      },
      payload: backup,
    })
    const deploy = {
      ...body,
      event: 'deploy_request.opened',
      resource: {
        number: 5,
        branch: 'dev',
        into_branch: 'main',
        approved: false,
        num_comments: 0,
        notes: '',
      },
    }
    expect(
      (
        await planetscaleHandler.formatInput!(
          formatContext(deploy, 'planetscale_deploy_request_opened')
        )
      ).input
    ).toMatchObject({
      resource: {
        number: 5,
        intoBranch: 'main',
        approved: false,
        numComments: 0,
        notes: '',
        closedAt: null,
      },
      payload: deploy,
    })
    expect(
      (await planetscaleHandler.formatInput!(formatContext(deploy, 'planetscale_webhook'))).input
    ).toEqual({ ...deploy, payload: deploy })
  })

  it('rejects malformed envelopes before formatting executable input', async () => {
    for (const invalid of [
      null,
      { ...body, timestamp: 'now' },
      { ...body, resource: [] },
      { ...body, organization: null },
    ]) {
      await expect(
        planetscaleHandler.formatInput!(formatContext(invalid, credentials.triggerId))
      ).rejects.toThrow()
    }
  })

  it('deduplicates identical authenticated payloads, preserves repeat events and overrides unsigned IDs', () => {
    const key = planetscaleHandler.extractIdempotencyId!(body)
    expect(key).toBe(
      planetscaleHandler.extractIdempotencyId!({
        resource: body.resource,
        database: body.database,
        organization: body.organization,
        timestamp: body.timestamp,
        event: body.event,
      })
    )
    expect(key).not.toBe(
      planetscaleHandler.extractIdempotencyId!({ ...body, timestamp: body.timestamp + 1 })
    )
    const headers = { 'x-sim-idempotency-key': 'attacker', 'x-request-id': 'attacker' }
    planetscaleHandler.enrichHeaders!(
      { webhook: {}, body, requestId: 'test', providerConfig: credentials },
      headers
    )
    expect(headers['x-sim-idempotency-key']).toBe(key)
  })
})

describe('PlanetScale subscription resource integrity', () => {
  const fetchMock = vi.fn<typeof fetch>()
  beforeEach(() => {
    setEnv({ ENCRYPTION_KEY: '11'.repeat(32) })
    urlsMockFns.mockGetBaseUrl.mockReturnValue('http://localhost:3000')
    fetchMock.mockReset()
    vi.stubGlobal('fetch', fetchMock)
  })

  it('creates one subscription and stores only an encrypted signing secret', async () => {
    fetchMock.mockResolvedValueOnce(Response.json({ id: 'remote-id', secret }))
    const result = await planetscaleHandler.createSubscription!(subscription())
    expect(result?.providerConfigUpdates?.externalId).toBe('remote-id')
    const stored = result?.providerConfigUpdates?.webhookSecret
    expect(stored).not.toBe(secret)
    expect(await decryptSecret(String(stored))).toEqual({ decrypted: secret })
    expect(JSON.stringify(result)).not.toContain(credentials.triggerServiceToken)
  })

  it('recovers an exact checkpoint instead of creating a second subscription, even with corrupt old ciphertext', async () => {
    const callback = 'http://localhost:3000/api/webhooks/trigger/fixture-path'
    fetchMock.mockResolvedValueOnce(
      Response.json({
        id: 'remote-id',
        url: callback,
        events: ['branch.ready'],
        enabled: true,
        secret,
      })
    )
    const result = await planetscaleHandler.createSubscription!(
      subscription({ externalId: 'remote-id', webhookSecret: 'corrupt' })
    )
    expect(result?.providerConfigUpdates?.externalId).toBe('remote-id')
    expect(await decryptSecret(String(result?.providerConfigUpdates?.webhookSecret))).toEqual({
      decrypted: secret,
    })
    expect(
      fetchMock.mock.calls.map(([url, init]) => [new URL(String(url)).pathname, init?.method])
    ).toEqual([['/v1/organizations/fixture-org/databases/fixture-db/webhooks/remote-id', 'GET']])
  })

  it.each([401, 403, 500])(
    'does not replace a recorded subscription after HTTP %s',
    async (status) => {
      fetchMock.mockResolvedValueOnce(
        Response.json({ error: credentials.triggerServiceToken }, { status })
      )
      await expect(
        planetscaleHandler.createSubscription!(subscription({ externalId: 'remote-id' }))
      ).rejects.toThrow()
      expect(fetchMock.mock.calls).toHaveLength(1)
    }
  )

  it('creates a replacement only after an exact-ID 404', async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 404 }))
    fetchMock.mockResolvedValueOnce(Response.json({ id: 'replacement', secret }))
    expect(
      (await planetscaleHandler.createSubscription!(subscription({ externalId: 'removed-id' })))
        ?.providerConfigUpdates?.externalId
    ).toBe('replacement')
    expect(fetchMock.mock.calls.map(([, init]) => init?.method)).toEqual(['GET', 'POST'])
  })

  it('cleans up only the returned ID when creation cannot produce usable signing state', async () => {
    fetchMock.mockResolvedValueOnce(Response.json({ id: 'created-id', secret: '' }))
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }))
    await expect(planetscaleHandler.createSubscription!(subscription())).rejects.toThrow()
    expect(
      fetchMock.mock.calls.map(([url, init]) => [new URL(String(url)).pathname, init?.method])
    ).toEqual([
      ['/v1/organizations/fixture-org/databases/fixture-db/webhooks', 'POST'],
      ['/v1/organizations/fixture-org/databases/fixture-db/webhooks/created-id', 'DELETE'],
    ])
  })

  it.each([204, 404])('treats deletion HTTP %s as completed', async (status) => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status }))
    await expect(
      planetscaleHandler.deleteSubscription!({
        ...subscription({ externalId: 'remote-id' }),
        strict: true,
      })
    ).resolves.toBeUndefined()
  })

  it.each(['.', '..', ''])(
    'rejects malformed returned IDs without deleting a collection or parent: %s',
    async (id) => {
      fetchMock.mockResolvedValueOnce(Response.json({ id, secret }))
      await expect(planetscaleHandler.createSubscription!(subscription())).rejects.toThrow()
      expect(fetchMock.mock.calls).toHaveLength(1)
    }
  )

  it('retains strict cleanup failures for retry without leaking transport or provider secrets', async () => {
    fetchMock.mockRejectedValueOnce(new Error(`Authorization ${credentials.triggerServiceToken}`))
    await expect(
      planetscaleHandler.deleteSubscription!({
        ...subscription({ externalId: 'remote-id' }),
        strict: true,
      })
    ).rejects.toThrow('PlanetScale')
    fetchMock.mockResolvedValueOnce(
      Response.json({ token: credentials.triggerServiceToken }, { status: 403 })
    )
    try {
      await planetscaleHandler.deleteSubscription!({
        ...subscription({ externalId: 'remote-id' }),
        strict: true,
      })
      expect.fail('Strict cleanup must fail')
    } catch (error) {
      expect(String(error)).not.toContain(credentials.triggerServiceToken)
    }
    await expect(
      planetscaleHandler.deleteSubscription!({ ...subscription(), strict: true })
    ).rejects.toThrow()
    await expect(planetscaleHandler.deleteSubscription!(subscription())).resolves.toBeUndefined()
  })

  it('rejects empty or unknown generic selections without creating a subscription', async () => {
    for (const events of [[], ['unknown.event'], ['webhook.test']]) {
      await expect(
        planetscaleHandler.createSubscription!(
          subscription({ triggerId: 'planetscale_webhook', events })
        )
      ).rejects.toThrow()
    }
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
