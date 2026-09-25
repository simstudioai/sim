import { NextRequest } from 'next/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { mockGetCredentialOwner, mockRefreshAccessTokenIfNeeded } = vi.hoisted(() => ({
  mockGetCredentialOwner: vi.fn(),
  mockRefreshAccessTokenIfNeeded: vi.fn(),
}))

vi.mock('@/lib/oauth/credential-service', () => ({
  refreshAccessTokenIfNeeded: mockRefreshAccessTokenIfNeeded,
}))

vi.mock('@/lib/webhooks/provider-subscription-utils', () => ({
  getProviderConfig: (webhook: { providerConfig?: Record<string, unknown> }) =>
    webhook.providerConfig || {},
  getNotificationUrl: () => 'https://app.example.com/api/webhooks/trigger/bitbucket-path',
  getCredentialOwner: mockGetCredentialOwner,
}))

import { IdempotencyService } from '@/lib/core/idempotency/service'
import { bitbucketHandler } from '@/lib/webhooks/providers/bitbucket'
import {
  BITBUCKET_TRIGGER_EVENT_MAP,
  type BitbucketTriggerId,
  buildBitbucketOutputs,
} from '@/triggers/bitbucket/utils'

const fetchMock = vi.fn()
const CALLBACK_URL = 'https://app.example.com/api/webhooks/trigger/bitbucket-path'
const CANDIDATE_DESCRIPTION = 'Sim workflow trigger (bitbucket_push) [sim:webhook-1]'

const BASE_OUTPUT_KEYS = [
  'actor',
  'attemptNumber',
  'eventType',
  'hookUuid',
  'payload',
  'repository',
  'requestUuid',
]

const PULL_REQUEST_OUTPUT_KEYS = [
  ...BASE_OUTPUT_KEYS,
  'destinationBranch',
  'pullRequest',
  'pullRequestId',
  'pullRequestState',
  'pullRequestTitle',
  'sourceBranch',
].sort()

function requestWithHeaders(headers: Record<string, string>): NextRequest {
  return new NextRequest('http://localhost/test', { headers })
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

function emptyResponse(status: number): Response {
  return new Response(null, { status })
}

function subscriptionContext(
  providerConfig: Record<string, unknown>,
  webhookOverrides: Record<string, unknown> = {}
) {
  return {
    webhook: {
      id: 'webhook-1',
      path: 'bitbucket-path',
      registrationStatus: 'candidate',
      providerConfig,
      ...webhookOverrides,
    },
    workflow: {},
    userId: 'user-1',
    requestId: 'request-1',
    request: requestWithHeaders({}),
  } as never
}

function deliveryContext(
  triggerId: string,
  body: Record<string, unknown>,
  headers: Record<string, string> = {}
) {
  return {
    webhook: { providerConfig: { triggerId } },
    workflow: { id: 'workflow-1', userId: 'user-1' },
    body,
    headers: {
      'x-event-key': BITBUCKET_TRIGGER_EVENT_MAP[triggerId],
      'x-hook-uuid': '{hook-1}',
      'x-request-uuid': '{request-uuid-1}',
      'x-attempt-number': '2',
      ...headers,
    },
    query: {},
    method: 'POST',
    requestId: 'request-1',
  } as never
}

describe('Bitbucket webhook provider', () => {
  beforeEach(() => {
    fetchMock.mockReset()
    vi.stubGlobal('fetch', fetchMock)
    mockGetCredentialOwner.mockResolvedValue({ accountId: 'account-1', userId: 'user-1' })
    mockRefreshAccessTokenIfNeeded.mockResolvedValue('oauth-token')
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  describe('verifyAuth', () => {
    function authContext(
      headers: Record<string, string>,
      rawBody: string,
      providerConfig: Record<string, unknown>
    ) {
      return {
        request: requestWithHeaders(headers),
        rawBody,
        requestId: 'request-1',
        providerConfig,
        webhook: {},
        workflow: {},
      } as never
    }

    it('accepts Atlassian’s published HMAC-SHA256 test vector', async () => {
      const response = await bitbucketHandler.verifyAuth!(
        authContext(
          {
            'X-Hub-Signature':
              'sha256=a4771c39fbe90f317c7824e83ddef3caae9cb3d976c214ace1f2937e133263c9',
          },
          'Hello World!',
          { webhookSecret: "It's a Secret to Everybody" }
        )
      )

      expect(response).toBeNull()
    })

    it.each([
      ['an unsupported algorithm', `sha1=${'a'.repeat(40)}`],
      ['a malformed digest', 'sha256=not-hex'],
      ['an incorrect digest', `sha256=${'0'.repeat(64)}`],
    ])('rejects %s', async (_label, signature) => {
      const response = await bitbucketHandler.verifyAuth!(
        authContext({ 'X-Hub-Signature': signature }, '{}', { webhookSecret: 'secret' })
      )
      expect(response?.status).toBe(401)
    })
  })

  describe('matchEvent', () => {
    it('rejects a mismatched event key', async () => {
      const result = await bitbucketHandler.matchEvent!({
        webhook: {},
        workflow: {},
        body: {},
        request: requestWithHeaders({ 'X-Event-Key': 'pullrequest:created' }),
        requestId: 'request-1',
        providerConfig: { triggerId: 'bitbucket_push' },
      })
      expect(result).toBe(false)
    })

    it.each([
      [{ triggerId: 'bitbucket_push' }, {}],
      [{}, { 'X-Event-Key': 'repo:push' }],
      [{ triggerId: 'unknown_bitbucket_trigger' }, { 'X-Event-Key': 'repo:push' }],
    ])('fails closed for missing or unknown routing data', async (providerConfig, headers) => {
      const result = await bitbucketHandler.matchEvent!({
        webhook: {},
        workflow: {},
        body: {},
        request: requestWithHeaders(headers),
        requestId: 'request-1',
        providerConfig,
      })
      expect(result).toBe(false)
    })
  })

  describe('idempotency', () => {
    function enrich(requestUuid: string | undefined, attemptNumber: string) {
      const headers: Record<string, string> = { 'x-attempt-number': attemptNumber }
      if (requestUuid !== undefined) headers['x-request-uuid'] = requestUuid
      bitbucketHandler.enrichHeaders!({} as never, headers)
      return headers
    }

    it.each([
      ['the same request UUID across attempts', '{request-1}', '1', '{request-1}', '2', true],
      ['different request UUIDs', '{request-1}', '1', '{request-2}', '1', false],
    ])(
      '%s produce the expected key relationship',
      (_label, firstUuid, firstAttempt, secondUuid, secondAttempt, shouldMatch) => {
        const payload = { repository: { uuid: '{repo-1}' }, changes: { name: {} } }
        const first = IdempotencyService.createWebhookIdempotencyKey(
          'webhook-1',
          enrich(firstUuid, firstAttempt),
          payload,
          'bitbucket'
        )
        const second = IdempotencyService.createWebhookIdempotencyKey(
          'webhook-1',
          enrich(secondUuid, secondAttempt),
          payload,
          'bitbucket'
        )

        expect(first === second).toBe(shouldMatch)
      }
    )

    it.each([undefined, '', '   '])(
      'does not inject a key for a missing or blank request UUID: %j',
      (requestUuid) => {
        expect(enrich(requestUuid, '1')).not.toHaveProperty('x-sim-idempotency-key')
      }
    )
  })

  describe('formatInput', () => {
    const actor = { display_name: 'Ada' }
    const repository = { uuid: '{repo-1}', name: 'sim' }

    it.each(Object.keys(BITBUCKET_TRIGGER_EVENT_MAP))(
      'aligns the runtime keys for %s with its trigger output contract',
      async (triggerId) => {
        const body = {
          actor,
          repository,
          push: { changes: [] },
          fork: { uuid: '{fork-1}' },
          changes: { name: { old: 'old', new: 'new' } },
          commit: { hash: 'abc123' },
          commit_status: {
            key: 'ci/build',
            state: 'SUCCESSFUL',
            name: 'CI',
            url: 'https://ci.example.com/build/1',
            links: {
              commit: {
                href: 'https://api.bitbucket.org/2.0/repositories/acme/sim/commit/abc123',
              },
            },
          },
          pullrequest: {
            id: 42,
            title: 'Add Bitbucket triggers',
            state: 'OPEN',
            source: { branch: { name: 'feature' } },
            destination: { branch: { name: 'staging' } },
          },
          approval: { date: '2026-08-21T00:00:00Z' },
          changes_request: { date: '2026-08-21T00:00:00Z' },
          comment: { id: 99, content: { raw: 'Please update this' } },
        }
        const { input } = await bitbucketHandler.formatInput!(deliveryContext(triggerId, body))
        expect(Object.keys(input as Record<string, unknown>).sort()).toEqual(
          Object.keys(buildBitbucketOutputs(triggerId as BitbucketTriggerId)).sort()
        )
      }
    )

    const pullRequest = {
      id: 42,
      title: 'Add Bitbucket triggers',
      state: 'OPEN',
      source: { branch: { name: 'feature' } },
      destination: { branch: { name: 'staging' } },
    }
  })

  describe('createSubscription', () => {
    const validConfig = {
      triggerId: 'bitbucket_push',
      credentialId: 'credential-1',
      workspaceSlug: 'team / blue',
      repoSlug: 'repo?admin=true',
    }
    const hooksUrl =
      'https://api.bitbucket.org/2.0/repositories/team%20%2F%20blue/repo%3Fadmin%3Dtrue/hooks'
    const activeHook = {
      uuid: '{active-hook}',
      description: 'Sim workflow trigger (bitbucket_push) [sim:active-webhook]',
      url: CALLBACK_URL,
    }
    const candidateHook = {
      uuid: '{candidate-hook}',
      description: CANDIDATE_DESCRIPTION,
      url: CALLBACK_URL,
      active: true,
      events: ['repo:push'],
      secret_set: true,
    }

    function hooksResponse(values: Array<Record<string, unknown>>): Response {
      return jsonResponse(200, { values })
    }

    it.each([
      [401, /reconnect/i],
      [403, /repository administrator.*webhook scope/i],
      [404, /repository not found/i],
      [429, /rate limited/i],
    ])('maps Bitbucket HTTP %s to an actionable error', async (status, message) => {
      fetchMock
        .mockResolvedValueOnce(hooksResponse([]))
        .mockResolvedValueOnce(jsonResponse(status, { error: { message: 'provider detail' } }))
      await expect(
        bitbucketHandler.createSubscription!(subscriptionContext(validConfig))
      ).rejects.toThrow(message)
    })

    it.each([
      [{ ...validConfig, credentialId: undefined }, /account connection required/i],
      [{ ...validConfig, workspaceSlug: '' }, /workspace is required/i],
      [{ ...validConfig, repoSlug: '' }, /repository is required/i],
      [{ ...validConfig, triggerId: 'bitbucket_unknown' }, /unknown bitbucket trigger/i],
    ])('validates required subscription configuration', async (config, message) => {
      await expect(
        bitbucketHandler.createSubscription!(subscriptionContext(config))
      ).rejects.toThrow(message)
      expect(fetchMock).not.toHaveBeenCalled()
    })

    it.each([undefined, null, '', '   '])(
      'requires a nonblank webhook ID before managing a subscription',
      async (webhookId) => {
        await expect(
          bitbucketHandler.createSubscription!(subscriptionContext(validConfig, { id: webhookId }))
        ).rejects.toThrow(/webhook ID is required/i)

        expect(fetchMock).not.toHaveBeenCalled()
        expect(mockRefreshAccessTokenIfNeeded).not.toHaveBeenCalled()
      }
    )

    it.each([{}, { uuid: '   ' }])(
      'rolls back only the proven redeploy candidate when a successful response has no usable UUID',
      async (createResponse) => {
        fetchMock
          .mockResolvedValueOnce(hooksResponse([activeHook]))
          .mockResolvedValueOnce(jsonResponse(201, createResponse))
          .mockResolvedValueOnce(hooksResponse([activeHook, candidateHook]))
          .mockResolvedValueOnce(emptyResponse(204))

        await expect(
          bitbucketHandler.createSubscription!(subscriptionContext(validConfig))
        ).rejects.toThrow(/no hook UUID/i)

        expect(fetchMock).toHaveBeenCalledTimes(4)
        expect(fetchMock.mock.calls[2][1]).toMatchObject({
          headers: { Authorization: 'Bearer oauth-token' },
        })
        expect(fetchMock.mock.calls[3][0]).toBe(`${hooksUrl}/%7Bcandidate-hook%7D`)
        expect(fetchMock.mock.calls[3][0]).not.toContain('active-hook')
        expect(fetchMock.mock.calls[3][1]).toMatchObject({ method: 'DELETE' })
      }
    )

    it('rolls back only the proven candidate after a lost create response', async () => {
      const timeoutError = new DOMException('The operation timed out', 'TimeoutError')
      const controllers = Array.from({ length: 4 }, () => new AbortController())
      const timeoutSpy = vi.spyOn(AbortSignal, 'timeout')
      for (const controller of controllers) timeoutSpy.mockReturnValueOnce(controller.signal)
      fetchMock
        .mockResolvedValueOnce(hooksResponse([activeHook]))
        .mockImplementationOnce((_url, init: RequestInit) => {
          const signal = init.signal as AbortSignal
          return new Promise<Response>((_resolve, reject) => {
            signal.addEventListener('abort', () => reject(signal.reason), { once: true })
            controllers[1].abort(timeoutError)
          })
        })
        .mockResolvedValueOnce(hooksResponse([activeHook, candidateHook]))
        .mockResolvedValueOnce(emptyResponse(204))

      await expect(
        bitbucketHandler.createSubscription!(subscriptionContext(validConfig))
      ).rejects.toMatchObject({ name: 'TimeoutError' })

      expect(fetchMock).toHaveBeenCalledTimes(4)
      expect(fetchMock.mock.calls[3][0]).toBe(`${hooksUrl}/%7Bcandidate-hook%7D`)
      expect(fetchMock.mock.calls[3][0]).not.toContain('active-hook')
      expect(timeoutSpy).toHaveBeenCalledTimes(4)
      expect(timeoutSpy).toHaveBeenCalledWith(15_000)
    })

    it.each([408, 503])(
      'reconciles an ambiguous HTTP %s create outcome without touching the active hook',
      async (status) => {
        fetchMock
          .mockResolvedValueOnce(hooksResponse([activeHook]))
          .mockResolvedValueOnce(
            jsonResponse(status, { error: { message: 'temporarily unavailable' } })
          )
          .mockResolvedValueOnce(hooksResponse([activeHook, candidateHook]))
          .mockResolvedValueOnce(emptyResponse(204))

        await expect(
          bitbucketHandler.createSubscription!(subscriptionContext(validConfig))
        ).rejects.toThrow(new RegExp(`failed to create Bitbucket webhook: ${status}`, 'i'))

        expect(fetchMock.mock.calls[3][0]).toBe(`${hooksUrl}/%7Bcandidate-hook%7D`)
        expect(fetchMock.mock.calls[3][0]).not.toContain('active-hook')
      }
    )

    it('leaves hooks untouched when an ambiguous response has multiple candidate matches', async () => {
      fetchMock
        .mockResolvedValueOnce(hooksResponse([activeHook]))
        .mockResolvedValueOnce(jsonResponse(201, {}))
        .mockResolvedValueOnce(
          hooksResponse([
            activeHook,
            candidateHook,
            { ...candidateHook, uuid: '{second-candidate-hook}' },
          ])
        )

      await expect(
        bitbucketHandler.createSubscription!(subscriptionContext(validConfig))
      ).rejects.toThrow(/no hook UUID/i)

      expect(fetchMock).toHaveBeenCalledTimes(3)
      expect(
        fetchMock.mock.calls.some(
          ([, init]) => (init as RequestInit | undefined)?.method === 'DELETE'
        )
      ).toBe(false)
    })

    it.each([
      ['no candidate matches', [activeHook]],
      [
        'the only candidate match has no usable UUID',
        [activeHook, { ...candidateHook, uuid: ' ' }],
      ],
    ])('leaves hooks untouched when %s', async (_case, reconciliationHooks) => {
      fetchMock
        .mockResolvedValueOnce(hooksResponse([activeHook]))
        .mockResolvedValueOnce(jsonResponse(201, {}))
        .mockResolvedValueOnce(hooksResponse(reconciliationHooks))

      await expect(
        bitbucketHandler.createSubscription!(subscriptionContext(validConfig))
      ).rejects.toThrow(/no hook UUID/i)

      expect(fetchMock).toHaveBeenCalledTimes(3)
      expect(
        fetchMock.mock.calls.some(
          ([, init]) => (init as RequestInit | undefined)?.method === 'DELETE'
        )
      ).toBe(false)
    })

    it('leaves hooks untouched when candidate lookup fails after an ambiguous response', async () => {
      fetchMock
        .mockResolvedValueOnce(hooksResponse([activeHook]))
        .mockResolvedValueOnce(jsonResponse(201, {}))
        .mockResolvedValueOnce(jsonResponse(500, { error: { message: 'list failed' } }))

      await expect(
        bitbucketHandler.createSubscription!(subscriptionContext(validConfig))
      ).rejects.toThrow(/no hook UUID/i)

      expect(fetchMock).toHaveBeenCalledTimes(3)
      expect(
        fetchMock.mock.calls.some(
          ([, init]) => (init as RequestInit | undefined)?.method === 'DELETE'
        )
      ).toBe(false)
    })

    it('does not retry or touch the active hook when proven-candidate deletion times out', async () => {
      fetchMock
        .mockResolvedValueOnce(hooksResponse([activeHook]))
        .mockResolvedValueOnce(jsonResponse(201, {}))
        .mockResolvedValueOnce(hooksResponse([activeHook, candidateHook]))
        .mockRejectedValueOnce(new DOMException('The operation timed out', 'TimeoutError'))

      await expect(
        bitbucketHandler.createSubscription!(subscriptionContext(validConfig))
      ).rejects.toThrow(/no hook UUID/i)

      expect(fetchMock).toHaveBeenCalledTimes(4)
      expect(fetchMock.mock.calls[3][0]).toBe(`${hooksUrl}/%7Bcandidate-hook%7D`)
      expect(fetchMock.mock.calls[3][0]).not.toContain('active-hook')
    })

    it('removes one stale uncheckpointed candidate before retrying creation', async () => {
      fetchMock
        .mockResolvedValueOnce(hooksResponse([activeHook, candidateHook]))
        .mockResolvedValueOnce(emptyResponse(204))
        .mockResolvedValueOnce(jsonResponse(201, { uuid: '{new-candidate-hook}' }))

      const result = await bitbucketHandler.createSubscription!(subscriptionContext(validConfig))

      expect(fetchMock).toHaveBeenCalledTimes(3)
      expect(fetchMock.mock.calls[1][0]).toBe(`${hooksUrl}/%7Bcandidate-hook%7D`)
      expect(fetchMock.mock.calls[1][1]).toMatchObject({ method: 'DELETE' })
      expect(fetchMock.mock.calls[2][1]).toMatchObject({ method: 'POST' })
      expect(result?.providerConfigUpdates).toMatchObject({ externalId: '{new-candidate-hook}' })
    })

    it('reuses a matching checkpointed candidate without creating or deleting another hook', async () => {
      fetchMock.mockResolvedValueOnce(hooksResponse([activeHook, candidateHook]))

      const result = await bitbucketHandler.createSubscription!(
        subscriptionContext({
          ...validConfig,
          externalId: '{candidate-hook}',
          webhookSecret: 'checkpointed-secret',
        })
      )

      expect(fetchMock).toHaveBeenCalledTimes(1)
      expect(result?.providerConfigUpdates).toEqual({
        externalId: '{candidate-hook}',
        webhookSecret: 'checkpointed-secret',
        eventTypes: ['repo:push'],
      })
    })

    it.each([
      ['a mismatched UUID', { externalId: '{different-hook}', webhookSecret: 'old-secret' }],
      ['a missing secret', { externalId: '{candidate-hook}' }],
    ])('does not reuse a checkpoint with %s', async (_case, checkpoint) => {
      fetchMock
        .mockResolvedValueOnce(hooksResponse([activeHook, candidateHook]))
        .mockResolvedValueOnce(emptyResponse(204))
        .mockResolvedValueOnce(jsonResponse(201, { uuid: '{new-candidate-hook}' }))

      const result = await bitbucketHandler.createSubscription!(
        subscriptionContext({ ...validConfig, ...checkpoint })
      )

      expect(fetchMock).toHaveBeenCalledTimes(3)
      expect(fetchMock.mock.calls[1][1]).toMatchObject({ method: 'DELETE' })
      expect(fetchMock.mock.calls[2][1]).toMatchObject({ method: 'POST' })
      expect(result?.providerConfigUpdates).toMatchObject({ externalId: '{new-candidate-hook}' })
    })

    it.each([
      ['disabled', { active: false }],
      ['missing its secret', { secret_set: false }],
      ['subscribed to the wrong event', { events: ['pullrequest:created'] }],
      ['subscribed to additional events', { events: ['repo:push', 'pullrequest:created'] }],
    ])('replaces a checkpointed candidate that is %s', async (_case, hookOverride) => {
      fetchMock
        .mockResolvedValueOnce(hooksResponse([activeHook, { ...candidateHook, ...hookOverride }]))
        .mockResolvedValueOnce(emptyResponse(204))
        .mockResolvedValueOnce(jsonResponse(201, { uuid: '{new-candidate-hook}' }))

      const result = await bitbucketHandler.createSubscription!(
        subscriptionContext({
          ...validConfig,
          externalId: '{candidate-hook}',
          webhookSecret: 'checkpointed-secret',
        })
      )

      expect(fetchMock).toHaveBeenCalledTimes(3)
      expect(fetchMock.mock.calls[1][1]).toMatchObject({ method: 'DELETE' })
      expect(fetchMock.mock.calls[2][1]).toMatchObject({ method: 'POST' })
      expect(result?.providerConfigUpdates).toMatchObject({ externalId: '{new-candidate-hook}' })
    })

    it('aborts before creation when candidate preflight cannot establish a unique state', async () => {
      fetchMock.mockResolvedValueOnce(
        hooksResponse([candidateHook, { ...candidateHook, uuid: '{second-candidate-hook}' }])
      )

      await expect(
        bitbucketHandler.createSubscription!(subscriptionContext(validConfig))
      ).rejects.toThrow(/found 2 matching hooks/i)

      expect(fetchMock).toHaveBeenCalledTimes(1)
    })

    it('does not delete by ID-based description for legacy non-candidate creation', async () => {
      fetchMock.mockResolvedValueOnce(jsonResponse(201, {}))

      await expect(
        bitbucketHandler.createSubscription!(
          subscriptionContext(validConfig, { registrationStatus: undefined })
        )
      ).rejects.toThrow(/no hook UUID/i)

      expect(fetchMock).toHaveBeenCalledTimes(1)
      expect(fetchMock.mock.calls[0][1]).toMatchObject({ method: 'POST' })
    })
  })

  describe('deleteSubscription', () => {
    const validConfig = {
      credentialId: 'credential-1',
      workspaceSlug: 'acme',
      repoSlug: 'sim',
      externalId: '{hook-uuid}',
    }

    it.each([204, 404])('treats HTTP %s as successful cleanup', async (status) => {
      fetchMock.mockResolvedValueOnce(emptyResponse(status))

      await expect(
        bitbucketHandler.deleteSubscription!(subscriptionContext(validConfig))
      ).resolves.toBeUndefined()
      expect(fetchMock).toHaveBeenCalledWith(
        'https://api.bitbucket.org/2.0/repositories/acme/sim/hooks/%7Bhook-uuid%7D',
        expect.objectContaining({ method: 'DELETE' })
      )
    })

    it('throws a deletion failure during strict outbox cleanup', async () => {
      fetchMock.mockResolvedValueOnce(
        jsonResponse(500, { error: { message: 'temporary provider failure' } })
      )
      await expect(
        bitbucketHandler.deleteSubscription!({
          ...subscriptionContext(validConfig),
          strict: true,
        })
      ).rejects.toThrow(/failed to delete Bitbucket webhook: 500/i)
    })
  })
})
