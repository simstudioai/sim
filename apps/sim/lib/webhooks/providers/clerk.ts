import { createLogger } from '@sim/logger'
import { NextResponse } from 'next/server'
import type {
  AuthContext,
  EventMatchContext,
  FormatInputContext,
  FormatInputResult,
  WebhookProviderHandler,
} from '@/lib/webhooks/providers/types'
import { verifyStandardWebhookRequest } from '@/lib/webhooks/providers/utils'

const logger = createLogger('WebhookProvider:Clerk')

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

    const failure = verifyStandardWebhookRequest({
      request,
      rawBody,
      requestId,
      secret: signingSecret,
      providerLabel: 'Clerk',
      headerPrefix: 'svix',
    })
    if (failure) return failure

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
