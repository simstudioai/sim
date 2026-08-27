/**
 * @vitest-environment node
 *
 * The HubSpot poller builds two provider URLs from trigger config, so the
 * reflective `request.url` probe in `tools/hubspot/path_safety.test.ts` cannot
 * see either one:
 *
 * - `/crm/v3/objects/{objectType}/search`, where `objectType` resolves from the
 *   free-text `customObjectTypeId` field declared in `triggers/hubspot/poller.ts`
 * - `/crm/v3/lists/{listId}/memberships/join-order`
 *
 * Both run in a background poller holding the workspace HubSpot token.
 * `encodeURIComponent` does not neutralize a dot segment — `.` and `..` are
 * unreserved and the WHATWG parser removes them after decoding — so a value of
 * `..` pops `objects`/`lists` and re-aims the authenticated request at a
 * sibling endpoint.
 *
 * Assertions resolve the outgoing URL through `new URL(...)`, the same
 * normalization `fetch` applies, and compare whole-pathname segment shape.
 */
import type { Logger } from '@sim/logger'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockResolveOAuthCredential,
  mockMarkWebhookFailed,
  mockMarkWebhookSuccess,
  mockUpdateWebhookProviderConfig,
  mockProcessPolledWebhookEvent,
  mockIdempotencyExecute,
} = vi.hoisted(() => ({
  mockResolveOAuthCredential: vi.fn(),
  mockMarkWebhookFailed: vi.fn(),
  mockMarkWebhookSuccess: vi.fn(),
  mockUpdateWebhookProviderConfig: vi.fn(),
  mockProcessPolledWebhookEvent: vi.fn(),
  mockIdempotencyExecute: vi.fn(),
}))

vi.mock('@/lib/webhooks/polling/utils', () => ({
  resolveOAuthCredential: mockResolveOAuthCredential,
  markWebhookFailed: mockMarkWebhookFailed,
  markWebhookSuccess: mockMarkWebhookSuccess,
  updateWebhookProviderConfig: mockUpdateWebhookProviderConfig,
}))

vi.mock('@/lib/webhooks/processor', () => ({
  processPolledWebhookEvent: mockProcessPolledWebhookEvent,
}))

vi.mock('@/lib/core/idempotency/service', () => ({
  pollingIdempotency: { execute: mockIdempotencyExecute },
}))

import { hubspotPollingHandler } from '@/lib/webhooks/polling/hubspot'

const ORIGIN = 'https://api.hubapi.com'

/**
 * Values that must never reach the provider URL. The percent-encoded dot forms
 * are included deliberately: the tools suite treats them as merely *inert*
 * (encoding them again is enough), but neither is a legal HubSpot object type
 * or list id, so the poller rejects rather than forwards them.
 */
const REJECTED = ['..', '.', '%2e%2e', '..%2f..', 'a/b', '  ..  ', '../..'] as const

/**
 * The three legal `objectType` spellings from HubSpot's Schemas API, plus a
 * bare custom object name. None contains a separator or is a dot segment.
 */
const LEGITIMATE = ['p7878787_my_object', '2-123456', '0-1', 'my_object'] as const

/**
 * Keys inherited from `Object.prototype`. Both `BUILT_IN_PATH` and
 * `DEFAULT_PROPERTIES` are plain object literals, and `in` walks the prototype
 * chain exactly as bracket access does — so these names resolved to a function
 * or an object instead of missing, and the built-in branch ran for an object
 * type that is not built in. Each is a legal HubSpot custom-object name, so the
 * correct outcome is the ordinary custom-object path.
 */
const PROTOTYPE_KEYS = [
  'constructor',
  '__proto__',
  'toString',
  'hasOwnProperty',
  'valueOf',
] as const

function requestBody(): { properties: string[] } {
  return JSON.parse((fetchMock.mock.calls[0][1] as { body: string }).body)
}

const logger = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
} as unknown as Logger

let fetchMock: ReturnType<typeof vi.fn>

beforeEach(() => {
  vi.clearAllMocks()
  mockResolveOAuthCredential.mockResolvedValue('inert-token')
  mockUpdateWebhookProviderConfig.mockResolvedValue(undefined)
  mockMarkWebhookSuccess.mockResolvedValue(undefined)
  mockMarkWebhookFailed.mockResolvedValue(undefined)
  fetchMock = vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => ({ results: [], paging: {} }),
    text: async () => '',
  })
  vi.stubGlobal('fetch', fetchMock)
})

function poll(providerConfig: Record<string, unknown>) {
  return hubspotPollingHandler.pollWebhook({
    webhookData: { id: 'wh-1', providerConfig } as any,
    workflowData: { id: 'wf-1' } as any,
    requestId: 'req-1',
    logger,
  })
}

function outgoingUrl(): URL {
  expect(fetchMock).toHaveBeenCalledTimes(1)
  return new URL(fetchMock.mock.calls[0][0] as string)
}

function searchConfig(customObjectTypeId: string) {
  return {
    objectType: 'custom',
    customObjectTypeId,
    eventType: 'created',
    lastSeenTimestampMs: '1000',
  }
}

describe('HubSpot poller search-path safety', () => {
  it('maps a built-in slug to its documented plural constant', async () => {
    const result = await poll({
      objectType: 'contact',
      eventType: 'created',
      lastSeenTimestampMs: '1000',
    })

    expect(result).toBe('success')
    const url = outgoingUrl()
    expect(url.origin).toBe(ORIGIN)
    expect(url.pathname.split('/')).toEqual(['', 'crm', 'v3', 'objects', 'contacts', 'search'])
  })

  it.each(LEGITIMATE)('passes objectType=%j through byte-identically', async (objectType) => {
    const result = await poll(searchConfig(objectType))

    expect(result).toBe('success')
    expect(fetchMock.mock.calls[0][0]).toBe(`${ORIGIN}/crm/v3/objects/${objectType}/search`)
    expect(outgoingUrl().pathname.split('/')).toEqual([
      '',
      'crm',
      'v3',
      'objects',
      objectType,
      'search',
    ])
  })

  it.each(REJECTED)('never calls HubSpot for objectType=%j', async (objectType) => {
    const result = await poll(searchConfig(objectType))

    expect(fetchMock).not.toHaveBeenCalled()
    expect(result).toBe('failure')
    expect(mockMarkWebhookFailed).toHaveBeenCalledWith('wh-1', logger)
  })

  /**
   * `resolveObjectType` falls back to `''` when `customObjectTypeId` is blank.
   * `pollSearchBased` already names that as a config error before any URL is
   * built; this pins the behavior so a future refactor cannot let an empty path
   * segment through.
   */
  it.each(['', '   ', undefined])(
    'fails with a named config error for customObjectTypeId=%j',
    async (customObjectTypeId) => {
      const result = await poll({
        objectType: 'custom',
        customObjectTypeId,
        eventType: 'created',
        lastSeenTimestampMs: '1000',
      })

      expect(fetchMock).not.toHaveBeenCalled()
      expect(result).toBe('failure')
      expect(logger.error).toHaveBeenCalledWith(
        expect.stringContaining('req-1'),
        expect.objectContaining({ message: expect.stringContaining('missing objectType') })
      )
    }
  )
})

describe('HubSpot poller inherited-key lookups', () => {
  it.each(PROTOTYPE_KEYS)(
    'treats objectType=%j as an ordinary custom object type, not a built-in',
    async (objectType) => {
      const result = await poll(searchConfig(objectType))

      expect(logger.error).not.toHaveBeenCalled()
      expect(result).toBe('success')
      expect(fetchMock.mock.calls[0][0]).toBe(`${ORIGIN}/crm/v3/objects/${objectType}/search`)
      expect(outgoingUrl().pathname.split('/')).toEqual([
        '',
        'crm',
        'v3',
        'objects',
        objectType,
        'search',
      ])
    }
  )

  it.each(PROTOTYPE_KEYS)(
    'requests only the baseline properties for objectType=%j, never a built-in default set',
    async (objectType) => {
      await poll(searchConfig(objectType))

      expect(requestBody().properties).toEqual(['createdate'])
    }
  )

  it('still applies the built-in default property set for a real built-in slug', async () => {
    const result = await poll({
      objectType: 'deal',
      eventType: 'created',
      lastSeenTimestampMs: '1000',
    })

    expect(result).toBe('success')
    const { properties } = requestBody()
    expect(properties).toContain('dealname')
    expect(properties).toContain('createdate')
    expect(properties.length).toBeGreaterThan(1)
  })
})

describe('HubSpot poller list-membership path safety', () => {
  it.each(['12345', '1e2f3a4b-5c6d-7e8f-9a0b-1c2d3e4f5a6b'])(
    'passes listId=%j through byte-identically',
    async (listId) => {
      const result = await poll({ objectType: 'list_membership', listId })

      expect(result).toBe('success')
      expect(fetchMock.mock.calls[0][0]).toBe(
        `${ORIGIN}/crm/v3/lists/${listId}/memberships/join-order?limit=100`
      )
      expect(outgoingUrl().pathname.split('/')).toEqual([
        '',
        'crm',
        'v3',
        'lists',
        listId,
        'memberships',
        'join-order',
      ])
    }
  )

  it.each(REJECTED)('never calls HubSpot for listId=%j', async (listId) => {
    const result = await poll({ objectType: 'list_membership', listId })

    expect(fetchMock).not.toHaveBeenCalled()
    expect(result).toBe('failure')
    expect(mockMarkWebhookFailed).toHaveBeenCalledWith('wh-1', logger)
  })

  /** Blank `listId` is already a named config error; pinned for the same reason. */
  it.each(['', '   ', undefined])(
    'fails with a named config error for listId=%j',
    async (listId) => {
      const result = await poll({ objectType: 'list_membership', listId })

      expect(fetchMock).not.toHaveBeenCalled()
      expect(result).toBe('failure')
      expect(logger.error).toHaveBeenCalledWith(
        expect.stringContaining('req-1'),
        expect.objectContaining({ message: expect.stringContaining('missing listId') })
      )
    }
  )
})
