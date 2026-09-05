/** @vitest-environment node */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ createClient: vi.fn(), prepare: vi.fn(), execute: vi.fn() }))
vi.mock('@/lib/internal/oci/client.server', () => ({ createOciClient: mocks.createClient }))
vi.mock('@/lib/internal/oci-queue/endpoints', () => ({ prepareOciQueueClient: mocks.prepare }))
vi.mock('@/lib/internal/oci-queue/operations', () => ({ executeOciQueueOperation: mocks.execute }))

import { OciClientError } from '@/lib/internal/oci/errors'
import {
  SelectorConnectionUnavailableError,
  SelectorContextUnavailableError,
  SelectorOptionsUnavailableError,
} from '@/lib/selectors/server/errors'
import { createSelectorProtectedValues } from '@/lib/selectors/server/protected-values'
import { ociQueueSelectorAttachments } from '@/lib/selectors/server/providers/oci-queue'
import type { ExecuteServerSelectorArgs } from '@/lib/selectors/server/types'

const args: ExecuteServerSelectorArgs = {
  selectorKey: 'oci_queue.queues',
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
const queues = ociQueueSelectorAttachments['oci_queue.queues']
const channels = ociQueueSelectorAttachments['oci_queue.channels']

describe('OCI Queue selectors', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.createClient.mockResolvedValue('client')
    mocks.prepare.mockResolvedValue('prepared')
    mocks.execute.mockResolvedValue({
      status: 200,
      queues: [
        {
          id: 'queue',
          displayName: 'Jobs',
          lifecycleState: 'ACTIVE',
          compartmentId: 'compartment',
          messagesEndpoint: 'server-endpoint',
          freeformTags: { secret: 'not-projected' },
        },
      ],
      nextPage: 'next',
    })
  })

  it('prepares from authorized credential context and projects one queue page', async () => {
    const signal = new AbortController().signal
    const result = await queues.execute({ ...args, signal })
    expect(mocks.createClient).toHaveBeenCalledWith({
      credentialId: 'resolved',
      workspaceId: 'workspace',
      serviceId: 'oci-queue',
      region: 'us-ashburn-1',
    })
    expect(mocks.execute).toHaveBeenCalledWith(
      {
        operation: 'oci_queue_list_queues',
        oauthCredential: 'resolved',
        compartmentId: 'compartment',
        region: 'us-ashburn-1',
        limit: 100,
        page: 'page+/=',
      },
      'prepared',
      signal
    )
    expect(result).toEqual({
      kind: 'list',
      items: [{ id: 'queue', label: 'Jobs', meta: { detail: 'ACTIVE' } }],
      nextCursor: 'next',
    })
    expect(mocks.execute).toHaveBeenCalledTimes(1)
  })

  it('forwards active queue and consumer-group dependencies to channel discovery', async () => {
    mocks.execute.mockResolvedValueOnce({
      status: 200,
      channels: ['jobs', 'billing'],
      nextPage: 'next',
    })
    const result = await channels.execute({
      ...args,
      selectorKey: 'oci_queue.channels',
      context: { queueId: 'queue', consumerGroupId: 'group', region: 'us-ashburn-1' },
    })
    expect(mocks.execute.mock.calls[0][0]).toEqual({
      operation: 'oci_queue_list_channels',
      oauthCredential: 'resolved',
      queueId: 'queue',
      consumerGroupId: 'group',
      region: 'us-ashburn-1',
      limit: 100,
      page: 'page+/=',
    })
    expect(result).toEqual({
      kind: 'list',
      items: [
        { id: 'jobs', label: 'jobs' },
        { id: 'billing', label: 'billing' },
      ],
      nextCursor: 'next',
    })
  })

  it('resolves a manually entered queue only within the selected compartment', async () => {
    mocks.execute.mockResolvedValueOnce({
      status: 200,
      queue: {
        id: 'queue',
        displayName: 'Jobs',
        compartmentId: 'compartment',
        lifecycleState: 'ACTIVE',
      },
    })
    expect(await queues.execute({ ...args, request: { kind: 'detail', id: 'queue' } })).toEqual({
      kind: 'detail',
      item: { id: 'queue', label: 'Jobs', meta: { detail: 'ACTIVE' } },
    })
    mocks.execute.mockResolvedValueOnce({
      status: 200,
      queue: { id: 'queue', compartmentId: 'other' },
    })
    expect(await queues.execute({ ...args, request: { kind: 'detail', id: 'queue' } })).toEqual({
      kind: 'detail',
      item: null,
    })
  })

  it('returns no detail for a queue no longer present', async () => {
    mocks.execute.mockRejectedValueOnce(new OciClientError('request_failed', { status: 404 }))
    expect(await queues.execute({ ...args, request: { kind: 'detail', id: 'queue' } })).toEqual({
      kind: 'detail',
      item: null,
    })
  })

  it('requires credential-bound service accounts and matching workspace', async () => {
    for (const credential of [
      undefined,
      { ...args.credential!, providerId: 'other-provider' },
      { ...args.credential!, access: { ...args.credential!.access!, workspaceId: 'other' } },
    ]) {
      await expect(queues.execute({ ...args, credential })).rejects.toBeInstanceOf(
        SelectorConnectionUnavailableError
      )
    }
    expect(mocks.createClient).not.toHaveBeenCalled()
  })

  it('requires active dependencies and does not fabricate channel details', async () => {
    await expect(queues.execute({ ...args, context: {} })).rejects.toBeInstanceOf(
      SelectorContextUnavailableError
    )
    await expect(
      channels.execute({
        ...args,
        selectorKey: 'oci_queue.channels',
        context: { queueId: 'queue' },
        request: { kind: 'detail', id: 'channel' },
      })
    ).rejects.toBeInstanceOf(SelectorOptionsUnavailableError)
    expect(mocks.execute).not.toHaveBeenCalled()
  })

  it('preserves cancellation and maps provider authorization errors', async () => {
    mocks.execute.mockRejectedValueOnce(new OciClientError('request_failed', { status: 401 }))
    await expect(queues.execute(args)).rejects.toBeInstanceOf(SelectorConnectionUnavailableError)
    const controller = new AbortController()
    mocks.execute.mockImplementationOnce(async () => {
      controller.abort()
      throw controller.signal.reason
    })
    await expect(queues.execute({ ...args, signal: controller.signal })).rejects.toMatchObject({
      name: 'AbortError',
    })
  })
})
