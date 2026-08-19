import type { PlaidOperationBody, PlaidOperationResponse } from '@/lib/api/contracts/tools/plaid'
import { readResponseJsonWithLimit } from '@/lib/core/utils/stream-limits'
import type { PlaidServiceAccountSecretBlob } from '@/lib/credentials/plaid-service-account'

const PLAID_BASE_URLS = {
  production: 'https://production.plaid.com',
  sandbox: 'https://sandbox.plaid.com',
} as const
const PLAID_API_VERSION = '2020-09-14'
export const PLAID_OPERATION_RESPONSE_MAX_BYTES = 10 * 1024 * 1024

const PLAID_OPERATION_PATHS = {
  plaid_get_item: '/item/get',
  plaid_sync_transactions: '/transactions/sync',
  plaid_search_institutions: '/institutions/search',
  plaid_get_institution: '/institutions/get_by_id',
  plaid_get_accounts: '/accounts/get',
  plaid_get_balances: '/accounts/balance/get',
  plaid_get_auth: '/auth/get',
  plaid_get_identity: '/identity/get',
} as const satisfies Record<PlaidOperationBody['operation'], string>

export class PlaidProviderError extends Error {
  constructor(
    readonly status: number,
    readonly body: Record<string, unknown>
  ) {
    super('Plaid request failed')
    this.name = 'PlaidProviderError'
  }
}

export class PlaidGatewayError extends Error {
  constructor(message = 'Plaid request failed') {
    super(message)
    this.name = 'PlaidGatewayError'
  }
}

function recordOf(value: unknown): PlaidOperationResponse | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as PlaidOperationResponse)
    : null
}

export function buildPlaidProviderRequest(body: PlaidOperationBody): {
  path: string
  payload: Record<string, unknown>
} {
  const path = PLAID_OPERATION_PATHS[body.operation]
  switch (body.operation) {
    case 'plaid_get_item':
      return { path, payload: { access_token: body.accessToken } }
    case 'plaid_sync_transactions': {
      const { account_id, include_original_description, days_requested, cursor, count } = body.input
      const options = {
        ...(account_id !== undefined ? { account_id } : {}),
        ...(include_original_description !== undefined ? { include_original_description } : {}),
        ...(days_requested !== undefined ? { days_requested } : {}),
      }
      return {
        path,
        payload: {
          access_token: body.accessToken,
          ...(cursor !== undefined ? { cursor } : {}),
          ...(count !== undefined ? { count } : {}),
          ...(Object.keys(options).length > 0 ? { options } : {}),
        },
      }
    }
    case 'plaid_search_institutions':
      return {
        path,
        payload: {
          query: body.input.query,
          country_codes: body.input.country_codes,
          ...(body.input.products ? { products: body.input.products } : {}),
          options: { include_optional_metadata: true },
        },
      }
    case 'plaid_get_institution':
      return {
        path,
        payload: {
          institution_id: body.input.institution_id,
          country_codes: body.input.country_codes,
          options: { include_optional_metadata: true },
        },
      }
    case 'plaid_get_accounts':
    case 'plaid_get_auth':
    case 'plaid_get_identity':
      return {
        path,
        payload: {
          access_token: body.accessToken,
          ...(body.input.account_ids ? { options: { account_ids: body.input.account_ids } } : {}),
        },
      }
    case 'plaid_get_balances': {
      const options = {
        ...(body.input.account_ids ? { account_ids: body.input.account_ids } : {}),
        ...(body.input.min_last_updated_datetime
          ? { min_last_updated_datetime: body.input.min_last_updated_datetime }
          : {}),
      }
      return {
        path,
        payload: {
          access_token: body.accessToken,
          ...(Object.keys(options).length > 0 ? { options } : {}),
        },
      }
    }
  }
}

export async function executePlaidProviderRequest(args: {
  body: PlaidOperationBody
  credential: PlaidServiceAccountSecretBlob
  signal: AbortSignal
}): Promise<PlaidOperationResponse> {
  const request = buildPlaidProviderRequest(args.body)
  let response: Response
  try {
    response = await fetch(`${PLAID_BASE_URLS[args.credential.environment]}${request.path}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'PLAID-CLIENT-ID': args.credential.clientId,
        'PLAID-SECRET': args.credential.clientSecret,
        'Plaid-Version': PLAID_API_VERSION,
      },
      body: JSON.stringify(request.payload),
      redirect: 'error',
      signal: args.signal,
    })
  } catch (error) {
    if (args.signal.aborted) throw error
    throw new PlaidGatewayError()
  }

  let parsed: unknown
  try {
    parsed = await readResponseJsonWithLimit(response, {
      maxBytes: PLAID_OPERATION_RESPONSE_MAX_BYTES,
      label: 'Plaid response',
      signal: args.signal,
    })
  } catch (error) {
    if (args.signal.aborted) throw error
    throw new PlaidGatewayError('Plaid returned an invalid or oversized response')
  }
  const body = recordOf(parsed)
  if (!body) throw new PlaidGatewayError('Plaid returned an invalid response')
  if (!response.ok) {
    if (response.status < 400 || response.status >= 600) throw new PlaidGatewayError()
    throw new PlaidProviderError(response.status, body)
  }
  return body
}
