/** @vitest-environment node */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ createClient: vi.fn(), prepare: vi.fn(), execute: vi.fn() }))
vi.mock('@/lib/internal/oci/client.server', () => ({ createOciClient: mocks.createClient }))
vi.mock('@/lib/internal/oci-notifications/endpoints', () => ({
  prepareOciNotificationsClient: mocks.prepare,
}))
vi.mock('@/lib/internal/oci-notifications/operations', () => ({
  executeOciNotificationsOperation: mocks.execute,
}))

import { OciClientError } from '@/lib/internal/oci/errors'
import {
  SelectorConnectionUnavailableError,
  SelectorContextUnavailableError,
} from '@/lib/selectors/server/errors'
import { createSelectorProtectedValues } from '@/lib/selectors/server/protected-values'
import { ociNotificationsSelectorAttachments } from '@/lib/selectors/server/providers/oci-notifications'
import type { ExecuteServerSelectorArgs } from '@/lib/selectors/server/types'

const args: ExecuteServerSelectorArgs = {
  selectorKey: 'oci_notifications.topics',
  context: { oauthCredential: 'supplied', compartmentId: 'compartment', region: 'us-ashburn-1' },
  request: { kind: 'list', cursor: 'page+/=' },
  scope: { kind: 'workspace', workspaceId: 'workspace' },
  workspaceId: 'workspace',
  principal: { kind: 'session', userId: 'actor', sessionId: 'session' },
  requesterUserId: 'actor',
  references: new Map(),
  protectedValues: createSelectorProtectedValues(),
  credential: {
    suppliedId: 'supplied',
    providerId: 'oci-api-key-service-account',
    access: {
      ok: true,
      credentialType: 'service_account',
      resolvedCredentialId: 'resolved',
      workspaceId: 'workspace',
    },
  },
}
const topics = ociNotificationsSelectorAttachments['oci_notifications.topics']
const subscriptions = ociNotificationsSelectorAttachments['oci_notifications.subscriptions']
const subscriptionArgs: ExecuteServerSelectorArgs = {
  ...args,
  selectorKey: 'oci_notifications.subscriptions',
  context: { topicId: 'topic', compartmentId: 'moved-compartment', region: 'us-ashburn-1' },
}
const topic = {
  topicId: 'topic',
  name: 'Operations',
  lifecycleState: 'ACTIVE',
  compartmentId: 'compartment',
  apiEndpoint: 'server-endpoint',
  freeformTags: { internal: 'not-projected' },
}
const subscription = {
  id: 'subscription',
  topicId: 'topic',
  compartmentId: 'moved-compartment',
  protocol: 'CUSTOM_HTTPS',
  lifecycleState: 'PENDING',
  endpoint: 'https://user:secret@example.com',
}

describe('OCI Notifications selectors', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.createClient.mockResolvedValue('client')
    mocks.prepare.mockResolvedValue('prepared')
    mocks.execute.mockResolvedValue({ status: 200, topics: [topic], nextPage: 'next' })
  })

  it('projects one credential-bound page without leaking endpoint or tags', async () => {
    const signal = new AbortController().signal
    expect(await topics.execute({ ...args, signal })).toEqual({
      kind: 'list',
      items: [{ id: 'topic', label: 'Operations', meta: { detail: 'ACTIVE' } }],
      nextCursor: 'next',
    })
    expect(mocks.createClient).toHaveBeenCalledWith({
      credentialId: 'resolved',
      workspaceId: 'workspace',
      serviceId: 'oci-notifications',
      region: 'us-ashburn-1',
    })
    expect(mocks.execute).toHaveBeenCalledWith(
      {
        operation: 'oci_notifications_list_topics',
        oauthCredential: 'resolved',
        compartmentId: 'compartment',
        region: 'us-ashburn-1',
        limit: 50,
        page: 'page+/=',
      },
      'prepared',
      signal
    )
    expect(mocks.execute).toHaveBeenCalledTimes(1)
  })

  it('keeps subscription scope independent of the topic compartment', async () => {
    mocks.execute.mockResolvedValueOnce({ subscriptions: [subscription], nextPage: 'next-sub' })
    expect(await subscriptions.execute(subscriptionArgs)).toEqual({
      kind: 'list',
      items: [
        { id: 'subscription', label: 'CUSTOM_HTTPS: subscription', meta: { detail: 'PENDING' } },
      ],
      nextCursor: 'next-sub',
    })
    expect(mocks.execute.mock.calls[0][0]).toMatchObject({
      operation: 'oci_notifications_list_subscriptions',
      topicId: 'topic',
      compartmentId: 'moved-compartment',
    })
  })

  it('resolves topic details only within the requested compartment', async () => {
    mocks.execute.mockResolvedValueOnce({ topic })
    expect(await topics.execute({ ...args, request: { kind: 'detail', id: 'topic' } })).toEqual({
      kind: 'detail',
      item: { id: 'topic', label: 'Operations', meta: { detail: 'ACTIVE' } },
    })
    mocks.execute.mockResolvedValueOnce({ topic: { ...topic, compartmentId: 'other' } })
    expect(await topics.execute({ ...args, request: { kind: 'detail', id: 'topic' } })).toEqual({
      kind: 'detail',
      item: null,
    })
  })

  it.each([{ id: 'other' }, { topicId: 'other' }, { compartmentId: 'other' }])(
    'does not resolve a subscription outside the selected scope: %j',
    async (mismatch) => {
      mocks.execute.mockResolvedValueOnce({ subscription: { ...subscription, ...mismatch } })
      expect(
        await subscriptions.execute({
          ...subscriptionArgs,
          request: { kind: 'detail', id: 'subscription' },
        })
      ).toEqual({ kind: 'detail', item: null })
    }
  )

  it('prepares again with the current credential and region rather than caching', async () => {
    await topics.execute(args)
    await topics.execute({
      ...args,
      context: { ...args.context, region: 'us-phoenix-1' },
      credential: {
        ...args.credential!,
        access: { ...args.credential!.access!, resolvedCredentialId: 'another' },
      },
    })
    expect(mocks.createClient).toHaveBeenLastCalledWith({
      credentialId: 'another',
      workspaceId: 'workspace',
      serviceId: 'oci-notifications',
      region: 'us-phoenix-1',
    })
  })

  it('rejects absent or mismatched credential bindings before creating a client', async () => {
    for (const credential of [
      undefined,
      { ...args.credential!, providerId: 'other' },
      { ...args.credential!, access: { ...args.credential!.access!, workspaceId: 'other' } },
    ]) {
      await expect(topics.execute({ ...args, credential })).rejects.toBeInstanceOf(
        SelectorConnectionUnavailableError
      )
    }
    expect(mocks.createClient).not.toHaveBeenCalled()
  })

  it('requires topic and subscription-compartment context', async () => {
    for (const context of [{ topicId: 'topic' }, { compartmentId: 'compartment' }]) {
      await expect(subscriptions.execute({ ...subscriptionArgs, context })).rejects.toBeInstanceOf(
        SelectorContextUnavailableError
      )
    }
    expect(mocks.execute).not.toHaveBeenCalled()
  })

  it('preserves missing details, authorization failures, and cancellation', async () => {
    mocks.execute.mockRejectedValueOnce(new OciClientError('request_failed', { status: 404 }))
    expect(await topics.execute({ ...args, request: { kind: 'detail', id: 'topic' } })).toEqual({
      kind: 'detail',
      item: null,
    })
    mocks.execute.mockRejectedValueOnce(new OciClientError('request_failed', { status: 403 }))
    await expect(topics.execute(args)).rejects.toBeInstanceOf(SelectorConnectionUnavailableError)
    const controller = new AbortController()
    mocks.execute.mockImplementationOnce(async () => {
      controller.abort()
      throw controller.signal.reason
    })
    await expect(topics.execute({ ...args, signal: controller.signal })).rejects.toMatchObject({
      name: 'AbortError',
    })
  })
})
