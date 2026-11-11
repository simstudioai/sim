import { toRecord } from '@sim/utils/object'
import { readResponseJsonWithLimit } from '@/lib/core/utils/stream-limits'
import type {
  ClientCredentialAccountFields,
  ClientCredentialAccountMintOptions,
  ClientCredentialAccountMintResult,
} from '@/lib/credentials/client-credential-accounts/server'
import { tenantPrincipal } from '@/lib/credentials/principal'
import {
  fetchProvider,
  requireClientSecret,
  TokenServiceAccountValidationError,
  throwForProviderResponse,
} from '@/lib/credentials/token-service-accounts/errors'
import {
  getCloudBaseUrl,
  getTokenLifetimeSeconds,
  isCrowdStrikeCloud,
} from '@/lib/internal/crowdstrike/client'

const STEP = 'crowdstrike_token_mint'
const MAX_TOKEN_RESPONSE_BYTES = 64 * 1024
const MAX_MEMBER_CID_LENGTH = 128
const FORBIDDEN_FIELD_TEXT = /[\u0000-\u001f\u007f\s]/

function invalidCredentials(reason: string): TokenServiceAccountValidationError {
  return new TokenServiceAccountValidationError('invalid_credentials', 400, { step: STEP, reason })
}

/**
 * Mints a Falcon API access token with the API client's id and secret:
 * `POST {cloud API origin}/oauth2/token` (form fields `client_id`,
 * `client_secret`, and, for an MSSP parent acting on one child, `member_cid`).
 * The cloud comes only from the Falcon cloud allowlist, and the request never
 * follows a redirect, so the secret reaches no other host. Tokens last 30
 * minutes; the credential cache re-mints before they lapse.
 *
 * Falcon exposes no identity for the API client in the token response, so the
 * connect-time check is the mint itself.
 *
 * @see https://developer.crowdstrike.com/api-reference/collections/oauth2.md
 */
export async function mintCrowdStrikeServiceAccountToken(
  fields: ClientCredentialAccountFields,
  options?: ClientCredentialAccountMintOptions
): Promise<ClientCredentialAccountMintResult> {
  options?.signal?.throwIfAborted()
  const clientSecret = requireClientSecret(fields.clientSecret, STEP, 'CrowdStrike')
  const cloud = fields.dataCenter?.trim()
  if (!isCrowdStrikeCloud(cloud)) throw invalidCredentials('unknown Falcon cloud')
  const memberCid = fields.orgId.trim()
  if (
    memberCid &&
    (memberCid.length > MAX_MEMBER_CID_LENGTH || FORBIDDEN_FIELD_TEXT.test(memberCid))
  ) {
    throw invalidCredentials('member CID is invalid')
  }

  const baseUrl = getCloudBaseUrl(cloud)
  const body = new URLSearchParams({
    grant_type: 'client_credentials',
    client_id: fields.clientId,
    client_secret: clientSecret,
  })
  if (memberCid) body.set('member_cid', memberCid)

  const response = await fetchProvider(
    `${baseUrl}/oauth2/token`,
    {
      method: 'POST',
      redirect: 'error',
      signal: options?.signal,
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: body.toString(),
    },
    STEP
  )
  await throwForProviderResponse(response, STEP, { cloud })

  let token: Record<string, unknown>
  try {
    token = toRecord(
      await readResponseJsonWithLimit(response, {
        maxBytes: MAX_TOKEN_RESPONSE_BYTES,
        label: 'CrowdStrike token response',
        signal: options?.signal,
      })
    )
  } catch {
    options?.signal?.throwIfAborted()
    throw new TokenServiceAccountValidationError('provider_unavailable', 502, {
      step: STEP,
      reason: 'provider returned an invalid or oversized response',
    })
  }
  if (typeof token.access_token !== 'string' || !token.access_token.trim()) {
    throw new TokenServiceAccountValidationError('provider_unavailable', 502, {
      step: STEP,
      reason: 'token response missing access_token',
    })
  }

  return {
    accessToken: token.access_token,
    expiresInSeconds: getTokenLifetimeSeconds(token.expires_in),
    domain: cloud,
    identity: {
      displayName: memberCid ? `CrowdStrike ${memberCid}` : `CrowdStrike ${cloud.toUpperCase()}`,
      principal: memberCid ? tenantPrincipal(memberCid) : null,
      auditMetadata: {
        crowdstrikeClientId: fields.clientId,
        crowdstrikeCloud: cloud,
        ...(memberCid ? { crowdstrikeMemberCid: memberCid } : {}),
      },
      storedMetadata: { cloud },
    },
  }
}
