/**
 * @vitest-environment node
 */
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

import { bitbucketHandler } from '@/lib/webhooks/providers/bitbucket'
import {
  BITBUCKET_TRIGGER_EVENT_MAP,
  type BitbucketTriggerId,
  buildBitbucketOutputs,
} from '@/triggers/bitbucket/utils'

const fetchMock = vi.fn()

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

function subscriptionContext(providerConfig: Record<string, unknown>) {
  return {
    webhook: { id: 'webhook-1', path: 'bitbucket-path', providerConfig },
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
    vi.clearAllMocks()
    fetchMock.mockReset()
    vi.stubGlobal('fetch', fetchMock)
    mockGetCredentialOwner.mockResolvedValue({ accountId: 'account-1', userId: 'user-1' })
    mockRefreshAccessTokenIfNeeded.mockResolvedValue('oauth-token')
  })

  afterEach(() => {
    vi.unstubAllGlobals()
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

    it('fails closed without a configured secret', async () => {
      const response = await bitbucketHandler.verifyAuth!(authContext({}, '{}', {}))
      expect(response?.status).toBe(401)
    })

    it('rejects a missing signature', async () => {
      const response = await bitbucketHandler.verifyAuth!(
        authContext({}, '{}', { webhookSecret: 'secret' })
      )
      expect(response?.status).toBe(401)
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
    it.each(Object.entries(BITBUCKET_TRIGGER_EVENT_MAP))(
      'matches %s to %s',
      async (triggerId, eventKey) => {
        const result = await bitbucketHandler.matchEvent!({
          webhook: {},
          workflow: {},
          body: {},
          request: requestWithHeaders({ 'X-Event-Key': eventKey }),
          requestId: 'request-1',
          providerConfig: { triggerId },
        })
        expect(result).toBe(true)
      }
    )

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

  it('copies Bitbucket request UUID into the provider-local idempotency header', () => {
    const headers = { 'x-request-uuid': ' request-uuid ' }
    bitbucketHandler.enrichHeaders!({} as never, headers)
    expect(headers).toEqual({
      'x-request-uuid': ' request-uuid ',
      'x-sim-idempotency-key': 'request-uuid',
    })
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

    it('formats push events with common delivery metadata and the documented push object', async () => {
      const body = { actor, repository, push: { changes: [] } }
      const { input } = await bitbucketHandler.formatInput!(deliveryContext('bitbucket_push', body))
      const formatted = input as Record<string, unknown>

      expect(Object.keys(formatted).sort()).toEqual([...BASE_OUTPUT_KEYS, 'push'].sort())
      expect(formatted).toMatchObject({
        eventType: 'repo:push',
        hookUuid: '{hook-1}',
        requestUuid: '{request-uuid-1}',
        attemptNumber: 2,
        actor,
        repository,
        push: body.push,
      })
      expect(formatted.payload).toBe(body)
    })

    it.each([
      ['bitbucket_repository_forked', 'fork'],
      ['bitbucket_repository_updated', 'changes'],
    ])('formats %s with only its documented event object', async (triggerId, field) => {
      const eventObject = { value: 'documented' }
      const { input } = await bitbucketHandler.formatInput!(
        deliveryContext(triggerId, { actor, repository, [field]: eventObject })
      )
      const formatted = input as Record<string, unknown>
      expect(Object.keys(formatted).sort()).toEqual([...BASE_OUTPUT_KEYS, field].sort())
      expect(formatted[field]).toBe(eventObject)
    })

    it('formats commit comments and documented comment scalars', async () => {
      const comment = { id: 17, content: { raw: 'Looks good' } }
      const commit = { hash: 'abc123' }
      const { input } = await bitbucketHandler.formatInput!(
        deliveryContext('bitbucket_commit_comment_created', {
          actor,
          repository,
          comment,
          commit,
        })
      )
      expect(Object.keys(input as Record<string, unknown>).sort()).toEqual(
        [...BASE_OUTPUT_KEYS, 'comment', 'commentId', 'commentContent', 'commit'].sort()
      )
      expect(input).toMatchObject({ comment, commentId: 17, commentContent: 'Looks good', commit })
    })

    it.each(['bitbucket_build_status_created', 'bitbucket_build_status_updated'])(
      'formats %s without assuming an undocumented commit object',
      async (triggerId) => {
        const commitStatus = {
          key: 'ci/build',
          state: 'SUCCESSFUL',
          name: 'CI',
          url: 'https://ci.example.com/build/1',
          links: {
            commit: {
              href: 'https://api.bitbucket.org/2.0/repositories/acme/sim/commit/abc123',
            },
          },
        }
        const { input } = await bitbucketHandler.formatInput!(
          deliveryContext(triggerId, { actor, repository, commit_status: commitStatus })
        )
        expect(Object.keys(input as Record<string, unknown>).sort()).toEqual(
          [
            ...BASE_OUTPUT_KEYS,
            'commitStatus',
            'commitHash',
            'statusKey',
            'statusState',
            'statusName',
            'statusUrl',
          ].sort()
        )
        expect(input).toMatchObject({
          commitStatus,
          commitHash: 'abc123',
          statusKey: 'ci/build',
          statusState: 'SUCCESSFUL',
          statusName: 'CI',
          statusUrl: 'https://ci.example.com/build/1',
        })
      }
    )

    const pullRequest = {
      id: 42,
      title: 'Add Bitbucket triggers',
      state: 'OPEN',
      source: { branch: { name: 'feature' } },
      destination: { branch: { name: 'staging' } },
    }

    it.each([
      'bitbucket_pull_request_created',
      'bitbucket_pull_request_updated',
      'bitbucket_pull_request_merged',
      'bitbucket_pull_request_declined',
    ])('formats the documented pull-request contract for %s', async (triggerId) => {
      const { input } = await bitbucketHandler.formatInput!(
        deliveryContext(triggerId, { actor, repository, pullrequest: pullRequest })
      )
      expect(Object.keys(input as Record<string, unknown>).sort()).toEqual(PULL_REQUEST_OUTPUT_KEYS)
      expect(input).toMatchObject({
        pullRequest,
        pullRequestId: 42,
        pullRequestTitle: 'Add Bitbucket triggers',
        pullRequestState: 'OPEN',
        sourceBranch: 'feature',
        destinationBranch: 'staging',
      })
    })

    it.each(['bitbucket_pull_request_approved', 'bitbucket_pull_request_approval_removed'])(
      'adds the documented approval object for %s',
      async (triggerId) => {
        const approval = { date: '2026-08-21T00:00:00Z' }
        const { input } = await bitbucketHandler.formatInput!(
          deliveryContext(triggerId, { actor, repository, pullrequest: pullRequest, approval })
        )
        expect(Object.keys(input as Record<string, unknown>).sort()).toEqual(
          [...PULL_REQUEST_OUTPUT_KEYS, 'approval'].sort()
        )
        expect((input as Record<string, unknown>).approval).toBe(approval)
      }
    )

    it.each([
      'bitbucket_pull_request_changes_requested',
      'bitbucket_pull_request_changes_request_removed',
    ])('adds the documented changes-request object for %s', async (triggerId) => {
      const changesRequest = { date: '2026-08-21T00:00:00Z' }
      const { input } = await bitbucketHandler.formatInput!(
        deliveryContext(triggerId, {
          actor,
          repository,
          pullrequest: pullRequest,
          changes_request: changesRequest,
        })
      )
      expect(Object.keys(input as Record<string, unknown>).sort()).toEqual(
        [...PULL_REQUEST_OUTPUT_KEYS, 'changesRequest'].sort()
      )
      expect((input as Record<string, unknown>).changesRequest).toBe(changesRequest)
    })

    it.each([
      'bitbucket_pull_request_comment_created',
      'bitbucket_pull_request_comment_updated',
      'bitbucket_pull_request_comment_deleted',
      'bitbucket_pull_request_comment_resolved',
      'bitbucket_pull_request_comment_reopened',
    ])('adds the documented comment object and scalars for %s', async (triggerId) => {
      const comment = { id: 99, content: { raw: 'Please update this' } }
      const { input } = await bitbucketHandler.formatInput!(
        deliveryContext(triggerId, {
          actor,
          repository,
          pullrequest: pullRequest,
          comment,
        })
      )
      expect(Object.keys(input as Record<string, unknown>).sort()).toEqual(
        [...PULL_REQUEST_OUTPUT_KEYS, 'comment', 'commentId', 'commentContent'].sort()
      )
      expect(input).toMatchObject({
        comment,
        commentId: 99,
        commentContent: 'Please update this',
      })
    })

    it('uses null for absent or malformed optional fields', async () => {
      const { input } = await bitbucketHandler.formatInput!(
        deliveryContext(
          'bitbucket_build_status_created',
          {},
          { 'x-attempt-number': 'not-a-number', 'x-hook-uuid': '', 'x-request-uuid': '' }
        )
      )
      expect(input).toEqual({
        eventType: 'repo:commit_status_created',
        hookUuid: null,
        requestUuid: null,
        attemptNumber: null,
        actor: null,
        repository: null,
        payload: {},
        commitStatus: null,
        commitHash: null,
        statusKey: null,
        statusState: null,
        statusName: null,
        statusUrl: null,
      })
    })
  })

  describe('createSubscription', () => {
    const validConfig = {
      triggerId: 'bitbucket_push',
      credentialId: 'credential-1',
      workspaceSlug: 'team / blue',
      repoSlug: 'repo?admin=true',
    }

    it('creates one signed repository hook for the selected event', async () => {
      fetchMock.mockResolvedValueOnce(jsonResponse(201, { uuid: '{hook-uuid}' }))

      const result = await bitbucketHandler.createSubscription!(subscriptionContext(validConfig))

      expect(mockGetCredentialOwner).toHaveBeenCalledWith('credential-1', 'request-1')
      expect(mockRefreshAccessTokenIfNeeded).toHaveBeenCalledWith(
        'account-1',
        'user-1',
        'request-1'
      )
      expect(fetchMock).toHaveBeenCalledTimes(1)
      const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
      expect(url).toBe(
        'https://api.bitbucket.org/2.0/repositories/team%20%2F%20blue/repo%3Fadmin%3Dtrue/hooks'
      )
      expect(init.method).toBe('POST')
      expect(init.headers).toMatchObject({
        Accept: 'application/json',
        Authorization: 'Bearer oauth-token',
        'Content-Type': 'application/json',
      })
      const sentBody = JSON.parse(String(init.body)) as Record<string, unknown>
      expect(sentBody).toEqual({
        description: 'Sim workflow trigger (bitbucket_push)',
        url: 'https://app.example.com/api/webhooks/trigger/bitbucket-path',
        active: true,
        secret: expect.any(String),
        events: ['repo:push'],
      })
      expect(result?.providerConfigUpdates).toEqual({
        externalId: '{hook-uuid}',
        webhookSecret: sentBody.secret,
        eventTypes: ['repo:push'],
      })
    })

    it.each([
      [401, /reconnect/i],
      [403, /repository administrator.*webhook scope/i],
      [404, /repository not found/i],
      [429, /rate limited/i],
    ])('maps Bitbucket HTTP %s to an actionable error', async (status, message) => {
      fetchMock.mockResolvedValueOnce(
        jsonResponse(status, { error: { message: 'provider detail' } })
      )
      await expect(
        bitbucketHandler.createSubscription!(subscriptionContext(validConfig))
      ).rejects.toThrow(message)
    })

    it('surfaces a Bitbucket webhook-limit rejection detail', async () => {
      fetchMock.mockResolvedValueOnce(
        jsonResponse(400, { error: { message: 'Repository webhook limit exceeded' } })
      )
      await expect(
        bitbucketHandler.createSubscription!(subscriptionContext(validConfig))
      ).rejects.toThrow(/webhook limit exceeded/i)
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

    it.each([{}, { uuid: '   ' }])(
      'rolls back a matching hook when a successful response has no usable UUID',
      async (createResponse) => {
        fetchMock
          .mockResolvedValueOnce(jsonResponse(201, createResponse))
          .mockResolvedValueOnce(
            jsonResponse(200, {
              values: [
                {
                  uuid: '{orphan-hook}',
                  description: 'Sim workflow trigger (bitbucket_push)',
                  url: 'https://app.example.com/api/webhooks/trigger/bitbucket-path',
                },
              ],
            })
          )
          .mockResolvedValueOnce(emptyResponse(204))

        await expect(
          bitbucketHandler.createSubscription!(subscriptionContext(validConfig))
        ).rejects.toThrow(/no hook UUID/i)

        expect(fetchMock).toHaveBeenCalledTimes(3)
        expect(fetchMock.mock.calls[1][1]).toMatchObject({
          headers: { Authorization: 'Bearer oauth-token' },
        })
        expect(fetchMock.mock.calls[2][0]).toContain('/hooks/%7Borphan-hook%7D')
        expect(fetchMock.mock.calls[2][1]).toMatchObject({ method: 'DELETE' })
      }
    )
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

    it('normalizes manually entered repository coordinates before cleanup', async () => {
      fetchMock.mockResolvedValueOnce(emptyResponse(204))

      await bitbucketHandler.deleteSubscription!(
        subscriptionContext({
          ...validConfig,
          workspaceSlug: ' acme ',
          repoSlug: ' sim ',
          externalId: ' {hook-uuid} ',
        })
      )

      expect(fetchMock).toHaveBeenCalledWith(
        'https://api.bitbucket.org/2.0/repositories/acme/sim/hooks/%7Bhook-uuid%7D',
        expect.objectContaining({ method: 'DELETE' })
      )
    })

    it('logs an ordinary deletion failure without rejecting', async () => {
      fetchMock.mockResolvedValueOnce(
        jsonResponse(500, { error: { message: 'temporary provider failure' } })
      )
      await expect(
        bitbucketHandler.deleteSubscription!(subscriptionContext(validConfig))
      ).resolves.toBeUndefined()
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

    it('handles missing cleanup configuration according to strictness', async () => {
      await expect(
        bitbucketHandler.deleteSubscription!(subscriptionContext({}))
      ).resolves.toBeUndefined()
      await expect(
        bitbucketHandler.deleteSubscription!({
          ...subscriptionContext({}),
          strict: true,
        })
      ).rejects.toThrow(/missing Bitbucket credential/i)
      expect(fetchMock).not.toHaveBeenCalled()
    })
  })
})
