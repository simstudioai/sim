import { truncate } from '@sim/utils/string'
import {
  type PlaidOperationBody,
  type PlaidOperationResponse,
  plaidOperationResponseSchema,
} from '@/lib/api/contracts/tools/plaid'
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

function redactPlaidSecret(value: string, secrets: readonly string[]): string {
  let redacted = value
  for (const secret of secrets) {
    if (secret) redacted = redacted.split(secret).join('[REDACTED]')
  }
  return truncate(redacted, 4096, '…')
}

function optionalErrorString(
  body: Record<string, unknown>,
  key: string,
  secrets: readonly string[]
): string | null | undefined {
  const value = body[key]
  if (value === null) return null
  return typeof value === 'string' ? redactPlaidSecret(value, secrets) : undefined
}

function boundedStringArray(
  body: Record<string, unknown>,
  key: string,
  secrets: readonly string[]
): string[] | undefined {
  const value = body[key]
  if (!Array.isArray(value)) return undefined
  const strings = value
    .slice(0, 100)
    .filter((entry): entry is string => typeof entry === 'string')
    .map((entry) => truncate(redactPlaidSecret(entry, secrets), 256, '…'))
  return strings.length > 0 ? strings : undefined
}

/** Projects only Plaid's documented error fields and redacts exact stored secrets. */
export function sanitizePlaidProviderError(
  body: Record<string, unknown>,
  credential: PlaidServiceAccountSecretBlob
): Record<string, unknown> {
  const secrets = [credential.accessToken, credential.clientSecret, credential.clientId]
  const result: Record<string, unknown> = {}
  for (const key of [
    'error_type',
    'error_code',
    'error_message',
    'display_message',
    'error_code_reason',
    'request_id',
    'documentation_url',
    'suggested_action',
  ]) {
    const value = optionalErrorString(body, key, secrets)
    if (value !== undefined) result[key] = value
  }
  const status = body.status
  if (status === null || (typeof status === 'number' && Number.isInteger(status))) {
    result.status = status
  }
  for (const key of ['required_account_subtypes', 'provided_account_subtypes']) {
    const value = boundedStringArray(body, key, secrets)
    if (value) result[key] = value
  }
  if (!result.error_message && !result.error_code) {
    result.error_message = 'Plaid request failed'
  }
  return result
}

export function buildPlaidProviderRequest(
  body: PlaidOperationBody,
  accessToken: string
): {
  path: string
  payload: Record<string, unknown>
} {
  const path = PLAID_OPERATION_PATHS[body.operation]
  switch (body.operation) {
    case 'plaid_get_item':
      return { path, payload: { access_token: accessToken } }
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
          access_token: accessToken,
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
          ...(body.input.products?.length ? { products: body.input.products } : {}),
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
          access_token: accessToken,
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
          access_token: accessToken,
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
  const request = buildPlaidProviderRequest(args.body, args.credential.accessToken)
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
    throw new PlaidProviderError(response.status, sanitizePlaidProviderError(body, args.credential))
  }
  const success = plaidOperationResponseSchema.safeParse(body)
  if (!success.success) throw new PlaidGatewayError('Plaid returned an invalid response')
  return success.data
}
