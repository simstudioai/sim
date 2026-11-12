import type {
  ClientCredentialAccountFields,
  ClientCredentialAccountMintOptions,
  ClientCredentialAccountMintResult,
} from '@/lib/credentials/client-credential-accounts/server'
import { tenantPrincipal } from '@/lib/credentials/principal'
import {
  providerFailureCode,
  providerFailureReason,
  requireClientSecret,
  TokenServiceAccountValidationError,
} from '@/lib/credentials/token-service-accounts/errors'
import {
  CrowdStrikeAuthError,
  CrowdStrikeTokenRedirectError,
  isCrowdStrikeCloud,
  requestCrowdStrikeToken,
} from '@/lib/internal/crowdstrike/client'

const STEP = 'crowdstrike_token_mint'
const TOKEN_EXCHANGE_TIMEOUT_MS = 10_000
const MAX_MEMBER_CID_LENGTH = 128
const FORBIDDEN_FIELD_TEXT = /[\u0000-\u001f\u007f\s]/

function invalidCredentials(reason: string): TokenServiceAccountValidationError {
  return new TokenServiceAccountValidationError('invalid_credentials', 400, { step: STEP, reason })
}

/**
 * Mints a Falcon API access token with the API client's id and secret through
 * the token exchange the legacy block shares. The cloud comes only from the
 * Falcon cloud allowlist, and the exchange never follows a redirect, so the
 * secret reaches no other host. Falcon redirects a token request sent to the
 * wrong cloud, so a redirect is the user's cloud choice being wrong, not an
 * outage. Tokens last 30 minutes; the credential cache re-mints before they
 * lapse.
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

  const timeout = AbortSignal.timeout(TOKEN_EXCHANGE_TIMEOUT_MS)
  let minted: { token: string; expiresInSeconds: number }
  try {
    minted = await requestCrowdStrikeToken(
      { clientId: fields.clientId, clientSecret, cloud, memberCid: memberCid || undefined },
      {
        followRedirects: false,
        signal: options?.signal ? AbortSignal.any([options.signal, timeout]) : timeout,
      }
    )
  } catch (error) {
    options?.signal?.throwIfAborted()
    if (error instanceof CrowdStrikeTokenRedirectError) {
      throw new TokenServiceAccountValidationError('invalid_credentials', 400, {
        step: STEP,
        reason: error.region
          ? 'the API client belongs to another Falcon cloud'
          : 'token endpoint answered with a redirect',
        cloud,
        ...(error.region ? { apiClientCloud: error.region } : {}),
      })
    }
    if (error instanceof CrowdStrikeAuthError) {
      throw new TokenServiceAccountValidationError(
        providerFailureCode(error.status),
        error.status,
        { step: STEP, cloud }
      )
    }
    throw new TokenServiceAccountValidationError('provider_unavailable', 502, {
      step: STEP,
      reason: providerFailureReason(error),
    })
  }

  return {
    accessToken: minted.token,
    expiresInSeconds: minted.expiresInSeconds,
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
