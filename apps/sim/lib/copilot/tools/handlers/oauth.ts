import { db } from '@sim/db'
import { pendingCredentialDraft, user } from '@sim/db/schema'
import { toError } from '@sim/utils/errors'
import { and, eq, lt } from 'drizzle-orm'
import type { ExecutionContext, ToolCallResult } from '@/lib/copilot/request/types'
import { getBaseUrl } from '@/lib/core/utils/urls'
import { getAllOAuthServices } from '@/lib/oauth/utils'

export async function executeOAuthGetAuthLink(
  rawParams: Record<string, unknown>,
  context: ExecutionContext
): Promise<ToolCallResult> {
  const providerName = String(rawParams.providerName || rawParams.provider_name || '')
  const baseUrl = getBaseUrl()
  try {
    const result = await generateOAuthLink(
      context.userId,
      context.workspaceId,
      context.workflowId,
      context.chatId,
      providerName,
      baseUrl
    )
    return {
      success: true,
      output: {
        message: `Authorization URL generated for ${result.serviceName}.`,
        oauth_url: result.url,
        instructions: `Open this URL in your browser to connect ${result.serviceName}: ${result.url}`,
        provider: result.serviceName,
        providerId: result.providerId,
      },
    }
  } catch (err) {
    const workspaceUrl = context.workspaceId
      ? `${baseUrl}/workspace/${context.workspaceId}`
      : `${baseUrl}/workspace`
    return {
      success: false,
      error: toError(err).message,
      output: {
        message: `Could not generate a direct OAuth link for ${providerName}. Connect manually from the workspace.`,
        oauth_url: workspaceUrl,
        error: toError(err).message,
      },
    }
  }
}

export async function executeOAuthRequestAccess(
  rawParams: Record<string, unknown>,
  _context: ExecutionContext
): Promise<ToolCallResult> {
  const providerName = String(rawParams.providerName || rawParams.provider_name || 'the provider')
  return {
    success: true,
    output: {
      status: 'requested',
      providerName,
      message: `Requested ${providerName} OAuth connection.`,
    },
  }
}

/**
 * Resolves a human-friendly provider name to a providerId and generates the
 * actual OAuth authorization URL via Better Auth's server-side API.
 *
 * Steps: resolve provider → create credential draft → look up user session →
 * call auth.api.oAuth2LinkAccount → return the real authorization URL.
 */
export async function generateOAuthLink(
  userId: string,
  workspaceId: string | undefined,
  workflowId: string | undefined,
  chatId: string | undefined,
  providerName: string,
  baseUrl: string
): Promise<{ url: string; providerId: string; serviceName: string }> {
  if (!workspaceId) {
    throw new Error('workspaceId is required to generate an OAuth link')
  }

  const allServices = getAllOAuthServices()
  const normalizedInput = providerName.toLowerCase().trim()

  const matched =
    allServices.find((s) => s.providerId === normalizedInput) ||
    allServices.find((s) => s.name.toLowerCase() === normalizedInput) ||
    allServices.find(
      (s) =>
        s.name.toLowerCase().includes(normalizedInput) ||
        normalizedInput.includes(s.name.toLowerCase())
    ) ||
    allServices.find(
      (s) => s.providerId.includes(normalizedInput) || normalizedInput.includes(s.providerId)
    )

  if (!matched) {
    const available = allServices.map((s) => s.name).join(', ')
    throw new Error(`Provider "${providerName}" not found. Available providers: ${available}`)
  }

  const { providerId, name: serviceName } = matched
  const callbackURL =
    workflowId && workspaceId
      ? `${baseUrl}/workspace/${workspaceId}/w/${workflowId}`
      : chatId && workspaceId
        ? `${baseUrl}/workspace/${workspaceId}/task/${chatId}`
        : `${baseUrl}/workspace/${workspaceId}`

  if (providerId === 'trello') {
    return { url: `${baseUrl}/api/auth/trello/authorize`, providerId, serviceName }
  }
  if (providerId === 'shopify') {
    const returnUrl = encodeURIComponent(callbackURL)
    return {
      url: `${baseUrl}/api/auth/shopify/authorize?returnUrl=${returnUrl}`,
      providerId,
      serviceName,
    }
  }

  let displayName = serviceName
  try {
    const [row] = await db.select({ name: user.name }).from(user).where(eq(user.id, userId))
    if (row?.name) {
      displayName = `${row.name}'s ${serviceName}`
    }
  } catch {
    // Fall back to service name only
  }

  const now = new Date()
  await db
    .delete(pendingCredentialDraft)
    .where(
      and(eq(pendingCredentialDraft.userId, userId), lt(pendingCredentialDraft.expiresAt, now))
    )
  await db
    .insert(pendingCredentialDraft)
    .values({
      id: crypto.randomUUID(),
      userId,
      workspaceId,
      providerId,
      displayName,
      expiresAt: new Date(now.getTime() + 15 * 60 * 1000),
      createdAt: now,
    })
    .onConflictDoUpdate({
      target: [
        pendingCredentialDraft.userId,
        pendingCredentialDraft.providerId,
        pendingCredentialDraft.workspaceId,
      ],
      set: {
        displayName,
        expiresAt: new Date(now.getTime() + 15 * 60 * 1000),
        createdAt: now,
      },
    })

  const { auth } = await import('@/lib/auth/auth')
  const { headers: getHeaders } = await import('next/headers')
  const reqHeaders = await getHeaders()

  const data = (await auth.api.oAuth2LinkAccount({
    body: { providerId, callbackURL },
    headers: reqHeaders,
  })) as { url?: string; redirect?: boolean }

  if (!data?.url) {
    throw new Error('oAuth2LinkAccount did not return an authorization URL')
  }

  return { url: data.url, providerId, serviceName }
}
