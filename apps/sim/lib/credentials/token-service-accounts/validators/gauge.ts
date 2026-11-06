import { z } from 'zod'
import { readResponseJsonWithLimit } from '@/lib/core/utils/stream-limits'
import { tenantPrincipal } from '@/lib/credentials/principal'
import {
  fetchProvider,
  isTransientProviderStatus,
  TokenServiceAccountValidationError,
} from '@/lib/credentials/token-service-accounts/errors'
import type {
  TokenServiceAccountFields,
  TokenServiceAccountValidationResult,
} from '@/lib/credentials/token-service-accounts/server'

const GAUGE_ME_URL = 'https://app.withgauge.com/api/v1/me'
const MAX_IDENTITY_RESPONSE_BYTES = 64 * 1024

const credentialSchema = z.object({
  user: z.unknown(),
  apiKey: z
    .object({
      id: z.string().min(1),
      name: z.string().min(1),
      organization: z.object({
        id: z.string().min(1),
        name: z.string().min(1),
        slug: z.string().min(1),
      }),
    })
    .nullable(),
  token: z.object({
    kind: z.enum(['session', 'api_key']),
    scopes: z.array(z.string()),
    expiresAt: z.iso.datetime({ offset: true }).nullable(),
  }),
})

/** Verifies a saved Gauge organization API key without accepting temporary CLI login tokens. */
export async function validateGaugeServiceAccount(
  fields: TokenServiceAccountFields
): Promise<TokenServiceAccountValidationResult> {
  const response = await fetchProvider(
    GAUGE_ME_URL,
    {
      headers: { Authorization: `Bearer ${fields.apiToken}`, Accept: 'application/json' },
      redirect: 'error',
    },
    'me'
  )
  if (!response.ok) {
    await response.body?.cancel().catch(() => undefined)
    const callerError =
      response.status >= 400 && response.status < 500 && !isTransientProviderStatus(response.status)
    throw new TokenServiceAccountValidationError(
      callerError ? 'invalid_credentials' : 'provider_unavailable',
      response.status,
      { step: 'me', status: response.status }
    )
  }

  let payload: unknown
  try {
    payload = await readResponseJsonWithLimit(response, {
      maxBytes: MAX_IDENTITY_RESPONSE_BYTES,
      label: 'Gauge credential identity',
    })
  } catch {
    throw new TokenServiceAccountValidationError('provider_unavailable', 502, { step: 'me' })
  }
  const result = credentialSchema.safeParse(payload)
  if (!result.success) {
    throw new TokenServiceAccountValidationError('provider_unavailable', 502, { step: 'me' })
  }
  const { apiKey, token, user } = result.data
  if (
    token.kind !== 'api_key' ||
    !apiKey ||
    user !== null ||
    (token.expiresAt !== null && Date.parse(token.expiresAt) <= Date.now())
  ) {
    throw new TokenServiceAccountValidationError('invalid_credentials', 400, { step: 'me' })
  }

  return {
    displayName: `${apiKey.name} (${apiKey.organization.name})`,
    principal: tenantPrincipal(apiKey.organization.id, apiKey.organization.name),
    auditMetadata: { gaugeKeyId: apiKey.id },
    storedMetadata: {
      keyId: apiKey.id,
      organizationId: apiKey.organization.id,
      organizationSlug: apiKey.organization.slug,
      scopes: JSON.stringify(token.scopes),
      ...(token.expiresAt ? { expiresAt: token.expiresAt } : {}),
    },
  }
}
