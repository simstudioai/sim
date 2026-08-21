/**
 * @vitest-environment node
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { PlaidOperationBody } from '@/lib/api/contracts/tools/plaid'
import type { PlaidServiceAccountSecretBlob } from '@/lib/credentials/plaid-service-account'
import {
  buildPlaidProviderRequest,
  executePlaidProviderRequest,
  PLAID_OPERATION_RESPONSE_MAX_BYTES,
  PlaidGatewayError,
  PlaidProviderError,
} from '@/tools/plaid/utils.server'

const credential: PlaidServiceAccountSecretBlob = {
  type: 'plaid_service_account',
  providerId: 'plaid-service-account',
  clientId: 'client-id',
  clientSecret: 'client-secret',
  environment: 'sandbox',
  accessToken: 'item-token',
  itemId: 'item-1',
  metadata: {},
}

const base = { credentialId: 'credential-1' }

const mappingCases: Array<{
  body: PlaidOperationBody
  path: string
  payload: Record<string, unknown>
}> = [
  {
    body: { ...base, operation: 'plaid_get_item', input: {} },
    path: '/item/get',
    payload: { access_token: 'item-token' },
  },
  {
    body: {
      ...base,
      operation: 'plaid_sync_transactions',
      input: {
        cursor: 'cursor-1',
        count: 100,
        account_id: 'acc-1',
        include_original_description: false,
        days_requested: 90,
      },
    },
    path: '/transactions/sync',
    payload: {
      access_token: 'item-token',
      cursor: 'cursor-1',
      count: 100,
      options: {
        account_id: 'acc-1',
        include_original_description: false,
        days_requested: 90,
      },
    },
  },
  {
    body: {
      ...base,
      operation: 'plaid_search_institutions',
      input: { query: 'Bank', country_codes: ['US'], products: ['auth'] },
    },
    path: '/institutions/search',
    payload: {
      query: 'Bank',
      country_codes: ['US'],
      products: ['auth'],
      options: { include_optional_metadata: true },
    },
  },
  {
    body: {
      ...base,
      operation: 'plaid_get_institution',
      input: { institution_id: 'ins-1', country_codes: ['US'] },
    },
    path: '/institutions/get_by_id',
    payload: {
      institution_id: 'ins-1',
      country_codes: ['US'],
      options: { include_optional_metadata: true },
    },
  },
  {
    body: { ...base, operation: 'plaid_get_accounts', input: { account_ids: ['acc-1'] } },
    path: '/accounts/get',
    payload: { access_token: 'item-token', options: { account_ids: ['acc-1'] } },
  },
  {
    body: {
      ...base,
      operation: 'plaid_get_balances',
      input: {
        account_ids: ['acc-1'],
        min_last_updated_datetime: '2026-08-18T12:00:00Z',
      },
    },
    path: '/accounts/balance/get',
    payload: {
      access_token: 'item-token',
      options: {
        account_ids: ['acc-1'],
        min_last_updated_datetime: '2026-08-18T12:00:00Z',
      },
    },
  },
  {
    body: { ...base, operation: 'plaid_get_auth', input: {} },
    path: '/auth/get',
    payload: { access_token: 'item-token' },
  },
  {
    body: { ...base, operation: 'plaid_get_identity', input: {} },
    path: '/identity/get',
    payload: { access_token: 'item-token' },
  },
]

afterEach(() => vi.unstubAllGlobals())

describe('Plaid provider operation mapping', () => {
  it.each(mappingCases)('maps $body.operation to its fixed endpoint', ({ body, path, payload }) => {
    expect(buildPlaidProviderRequest(body, credential.accessToken)).toEqual({ path, payload })
  })

  it('keeps application credentials in the server request and rejects redirects', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ item: { item_id: 'item-1' }, request_id: 'request-1' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    )
    vi.stubGlobal('fetch', fetchMock)
    const signal = new AbortController().signal

    await expect(
      executePlaidProviderRequest({ body: mappingCases[0].body, credential, signal })
    ).resolves.toEqual({ item: { item_id: 'item-1' }, request_id: 'request-1' })

    expect(fetchMock).toHaveBeenCalledWith(
      'https://sandbox.plaid.com/item/get',
      expect.objectContaining({
        redirect: 'error',
        signal,
        headers: expect.objectContaining({
          'PLAID-CLIENT-ID': 'client-id',
          'PLAID-SECRET': 'client-secret',
        }),
      })
    )
  })

  it('omits an empty institution product filter defensively', () => {
    expect(
      buildPlaidProviderRequest(
        {
          ...base,
          operation: 'plaid_search_institutions',
          input: { query: 'Bank', country_codes: ['US'], products: [] },
        },
        credential.accessToken
      )
    ).toEqual({
      path: '/institutions/search',
      payload: {
        query: 'Bank',
        country_codes: ['US'],
        options: { include_optional_metadata: true },
      },
    })
  })

  it('projects bounded Plaid errors and redacts reflected stored secrets', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            error_code: 'ITEM_LOGIN_REQUIRED',
            error_type: 'ITEM_ERROR',
            error_message: `bad ${credential.accessToken} ${credential.clientSecret}`,
            request_id: 'request-1',
            causes: [{ long_lived_token: credential.accessToken }],
            unexpected: 'not projected',
          }),
          {
            status: 400,
          }
        )
      )
    )

    const error = await executePlaidProviderRequest({
      body: mappingCases[0].body,
      credential,
      signal: new AbortController().signal,
    }).catch((caught) => caught)
    expect(error).toBeInstanceOf(PlaidProviderError)
    expect(error).toMatchObject({
      status: 400,
      body: {
        error_code: 'ITEM_LOGIN_REQUIRED',
        error_type: 'ITEM_ERROR',
        error_message: 'bad [REDACTED] [REDACTED]',
        request_id: 'request-1',
      },
    })
    expect(JSON.stringify(error)).not.toContain(credential.accessToken)
    expect(JSON.stringify(error)).not.toContain(credential.clientSecret)
  })

  it.each([
    new Response('not json', { status: 200 }),
    new Response(JSON.stringify([]), { status: 200 }),
    new Response('{}', {
      status: 200,
      headers: { 'Content-Length': String(PLAID_OPERATION_RESPONSE_MAX_BYTES + 1) },
    }),
  ])('rejects malformed or oversized provider responses', async (response) => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response))
    await expect(
      executePlaidProviderRequest({
        body: mappingCases[0].body,
        credential,
        signal: new AbortController().signal,
      })
    ).rejects.toBeInstanceOf(PlaidGatewayError)
  })

  it('rejects a streamed provider response over 10 MiB without a Content-Length header', async () => {
    const chunk = new Uint8Array(64 * 1024)
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        for (
          let index = 0;
          index <= PLAID_OPERATION_RESPONSE_MAX_BYTES / chunk.byteLength;
          index += 1
        ) {
          controller.enqueue(chunk)
        }
        controller.close()
      },
    })
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(stream, { status: 200 })))

    await expect(
      executePlaidProviderRequest({
        body: mappingCases[0].body,
        credential,
        signal: new AbortController().signal,
      })
    ).rejects.toBeInstanceOf(PlaidGatewayError)
  })

  it('rejects a successful provider response without a request ID', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          new Response(JSON.stringify({ item: { item_id: 'item-1' } }), { status: 200 })
        )
    )

    await expect(
      executePlaidProviderRequest({
        body: mappingCases[0].body,
        credential,
        signal: new AbortController().signal,
      })
    ).rejects.toBeInstanceOf(PlaidGatewayError)
  })

  it('propagates cancellation instead of converting it to a provider failure', async () => {
    const controller = new AbortController()
    const cancelled = new Error('cancelled')
    controller.abort(cancelled)
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(cancelled))

    await expect(
      executePlaidProviderRequest({
        body: mappingCases[0].body,
        credential,
        signal: controller.signal,
      })
    ).rejects.toBe(cancelled)
  })

  it('classifies redirect refusal and transport failures as gateway failures', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockRejectedValue(new TypeError('redirect mode is set to error'))
    )
    await expect(
      executePlaidProviderRequest({
        body: mappingCases[0].body,
        credential,
        signal: new AbortController().signal,
      })
    ).rejects.toBeInstanceOf(PlaidGatewayError)
  })
})
