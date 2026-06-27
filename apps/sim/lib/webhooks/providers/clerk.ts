import { createLogger } from '@sim/logger'
import { safeCompare } from '@sim/security/compare'
import { hmacSha256Base64 } from '@sim/security/hmac'
import { NextResponse } from 'next/server'
import type {
  AuthContext,
  EventMatchContext,
  FormatInputContext,
  FormatInputResult,
  WebhookProviderHandler,
} from '@/lib/webhooks/providers/types'

const logger = createLogger('WebhookProvider:Clerk')

/**
 * Verify a Clerk webhook signature using the Svix signing scheme.
 * Clerk uses Svix under the hood: HMAC-SHA256 of `${svix-id}.${svix-timestamp}.${body}`
 * signed with the base64-decoded `whsec_...` secret, compared against the
 * space-delimited, versioned (`v1,<sig>`) `svix-signature` header.
 */
function verifySvixSignature(
  secret: string,
  msgId: string,
  timestamp: string,
  signatures: string,
  rawBody: string
): boolean {
  try {
    const ts = Number.parseInt(timestamp, 10)
    const now = Math.floor(Date.now() / 1000)
    if (Number.isNaN(ts) || Math.abs(now - ts) > 5 * 60) {
      return false
    }

    const secretBytes = Buffer.from(secret.replace(/^whsec_/, ''), 'base64')
    const toSign = `${msgId}.${timestamp}.${rawBody}`
    const expectedSignature = hmacSha256Base64(toSign, secretBytes)

    const providedSignatures = signatures.split(' ')
    for (const versionedSig of providedSignatures) {
      const parts = versionedSig.split(',')
      if (parts.length !== 2) continue
      const sig = parts[1]
      if (safeCompare(sig, expectedSignature)) {
        return true
      }
    }
    return false
  } catch (error) {
    logger.error('Error verifying Clerk Svix signature:', error)
    return false
  }
}

export const clerkHandler: WebhookProviderHandler = {
  async verifyAuth({
    request,
    rawBody,
    requestId,
    providerConfig,
  }: AuthContext): Promise<NextResponse | null> {
    const signingSecret = providerConfig.signingSecret as string | undefined
    if (!signingSecret?.trim()) {
      logger.warn(`[${requestId}] Clerk webhook missing signing secret in provider configuration`)
      return new NextResponse('Unauthorized - Clerk signing secret is required', { status: 401 })
    }

    const svixId = request.headers.get('svix-id')
    const svixTimestamp = request.headers.get('svix-timestamp')
    const svixSignature = request.headers.get('svix-signature')

    if (!svixId || !svixTimestamp || !svixSignature) {
      logger.warn(`[${requestId}] Clerk webhook missing Svix signature headers`)
      return new NextResponse('Unauthorized - Missing Clerk signature headers', { status: 401 })
    }

    if (!verifySvixSignature(signingSecret, svixId, svixTimestamp, svixSignature, rawBody)) {
      logger.warn(`[${requestId}] Clerk Svix signature verification failed`)
      return new NextResponse('Unauthorized - Invalid Clerk signature', { status: 401 })
    }

    return null
  },

  async matchEvent({ body, providerConfig, requestId }: EventMatchContext): Promise<boolean> {
    const triggerId = providerConfig.triggerId as string | undefined
    if (!triggerId || triggerId === 'clerk_webhook') {
      return true
    }

    const { isClerkEventMatch } = await import('@/triggers/clerk/utils')
    if (!isClerkEventMatch(triggerId, body as Record<string, unknown>)) {
      const actualType = (body as Record<string, unknown>)?.type
      logger.debug(
        `[${requestId}] Clerk event type mismatch for trigger ${triggerId}, got ${String(actualType)}. Skipping.`
      )
      return false
    }

    return true
  },

  async formatInput({ body }: FormatInputContext): Promise<FormatInputResult> {
    const payload = body as Record<string, unknown>
    const type = (payload.type as string | undefined) ?? ''
    const data = (payload.data as Record<string, unknown> | undefined) ?? undefined

    const isUser = type.startsWith('user.')
    const isSession = type.startsWith('session.')
    const isMembership = type.startsWith('organizationMembership.')
    const isOrganization = type.startsWith('organization.') && !isMembership

    const organization = data?.organization as Record<string, unknown> | undefined
    const publicUserData = data?.public_user_data as Record<string, unknown> | undefined

    const userId = isUser
      ? (data?.id ?? null)
      : isSession
        ? (data?.user_id ?? null)
        : isMembership
          ? (publicUserData?.user_id ?? null)
          : null

    const organizationId = isMembership
      ? (organization?.id ?? null)
      : isOrganization
        ? (data?.id ?? null)
        : null

    return {
      input: {
        type: payload.type ?? null,
        object: payload.object ?? null,
        timestamp: payload.timestamp ?? null,
        instance_id: payload.instance_id ?? null,
        data: data ?? null,
        userId,
        sessionId: isSession ? (data?.id ?? null) : null,
        organizationId,
        membershipId: isMembership ? (data?.id ?? null) : null,
        firstName: data?.first_name ?? null,
        lastName: data?.last_name ?? null,
        username: data?.username ?? null,
        imageUrl: data?.image_url ?? null,
        primaryEmailAddressId: data?.primary_email_address_id ?? null,
        emailAddresses: data?.email_addresses ?? null,
        phoneNumbers: data?.phone_numbers ?? null,
        externalId: data?.external_id ?? null,
        deleted: data?.deleted ?? null,
        status: data?.status ?? null,
        clientId: data?.client_id ?? null,
        role: data?.role ?? null,
        name: data?.name ?? null,
        slug: data?.slug ?? null,
        createdBy: data?.created_by ?? null,
        membersCount: data?.members_count ?? null,
        maxAllowedMemberships: data?.max_allowed_memberships ?? null,
        createdAt: data?.created_at ?? null,
        updatedAt: data?.updated_at ?? null,
      },
    }
  },

  extractIdempotencyId(body: unknown): string | null {
    const payload = body as Record<string, unknown>
    const type = payload?.type as string | undefined
    const data = payload?.data as Record<string, unknown> | undefined
    const dataId = data?.id as string | undefined
    if (type && dataId) {
      return `${type}:${dataId}`
    }
    return null
  },
}
