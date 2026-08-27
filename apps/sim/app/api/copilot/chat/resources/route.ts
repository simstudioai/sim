import { db } from '@sim/db'
import { copilotChats } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { and, eq, isNull, sql } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import {
  addCopilotChatResourceContract,
  removeCopilotChatResourceContract,
  reorderCopilotChatResourcesContract,
} from '@/lib/api/contracts/copilot'
import { parseRequest } from '@/lib/api/server'
import {
  authenticateCopilotRequestSessionOnly,
  createBadRequestResponse,
  createInternalServerErrorResponse,
  createNotFoundResponse,
  createUnauthorizedResponse,
} from '@/lib/copilot/request/http'
import type { ChatResource } from '@/lib/copilot/resources/persistence'
import {
  canonicalizeDesktopSessionResource,
  mergeChatResource,
  sanitizeChatResources,
} from '@/lib/copilot/resources/types'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'

const logger = createLogger('CopilotChatResourcesAPI')

export const POST = withRouteHandler(async (req: NextRequest) => {
  try {
    const { userId, isAuthenticated } = await authenticateCopilotRequestSessionOnly()
    if (!isAuthenticated || !userId) {
      return createUnauthorizedResponse()
    }

    const parsed = await parseRequest(
      addCopilotChatResourceContract,
      req,
      {},
      {
        validationErrorResponse: (error) =>
          createBadRequestResponse(error.issues.map((e) => e.message).join(', ')),
      }
    )
    if (!parsed.success) return parsed.response
    const { chatId, resource: requestedResource } = parsed.data.body
    const resource = canonicalizeDesktopSessionResource(requestedResource)

    // Ephemeral UI tab (client does not POST this; guard for old clients / bugs).
    if (resource.id === 'streaming-file') {
      return NextResponse.json({ success: true })
    }

    const [chat] = await db
      .select({ resources: copilotChats.resources })
      .from(copilotChats)
      .where(
        and(
          eq(copilotChats.id, chatId),
          eq(copilotChats.userId, userId),
          isNull(copilotChats.deletedAt)
        )
      )
      .limit(1)

    if (!chat) {
      return createNotFoundResponse('Chat not found or unauthorized')
    }

    const existing = sanitizeChatResources(
      Array.isArray(chat.resources) ? (chat.resources as ChatResource[]) : []
    )
    const key = `${resource.type}:${resource.id}`
    const prev = existing.find((r) => `${r.type}:${r.id}` === key)

    const merged: ChatResource[] = prev
      ? existing.map((r) => (`${r.type}:${r.id}` === key ? mergeChatResource(r, resource) : r))
      : [...existing, resource]

    await db
      .update(copilotChats)
      .set({ resources: sql`${JSON.stringify(merged)}::jsonb`, updatedAt: new Date() })
      .where(
        and(
          eq(copilotChats.id, chatId),
          eq(copilotChats.userId, userId),
          isNull(copilotChats.deletedAt)
        )
      )

    logger.info('Added resource to chat', { chatId, resource })

    return NextResponse.json({ success: true, resources: merged })
  } catch (error) {
    logger.error('Error adding chat resource:', error)
    return createInternalServerErrorResponse('Failed to add resource')
  }
})

export const PATCH = withRouteHandler(async (req: NextRequest) => {
  try {
    const { userId, isAuthenticated } = await authenticateCopilotRequestSessionOnly()
    if (!isAuthenticated || !userId) {
      return createUnauthorizedResponse()
    }

    const parsed = await parseRequest(
      reorderCopilotChatResourcesContract,
      req,
      {},
      {
        validationErrorResponse: (error) =>
          createBadRequestResponse(error.issues.map((e) => e.message).join(', ')),
      }
    )
    if (!parsed.success) return parsed.response
    const { chatId, resources: newOrder } = parsed.data.body

    const [chat] = await db
      .select({ resources: copilotChats.resources })
      .from(copilotChats)
      .where(
        and(
          eq(copilotChats.id, chatId),
          eq(copilotChats.userId, userId),
          isNull(copilotChats.deletedAt)
        )
      )
      .limit(1)

    if (!chat) {
      return createNotFoundResponse('Chat not found or unauthorized')
    }

    const existing = sanitizeChatResources(
      Array.isArray(chat.resources) ? (chat.resources as ChatResource[]) : []
    )
    // The client echoes the tabs it holds; anything it does not carry (a view
    // pin, a path) is taken from the stored entry rather than dropped.
    const existingByKey = new Map(existing.map((r) => [`${r.type}:${r.id}`, r]))
    const canonicalOrder = sanitizeChatResources(newOrder).map((r) =>
      mergeChatResource(existingByKey.get(`${r.type}:${r.id}`), r)
    )
    const existingKeys = new Set(existingByKey.keys())
    const newKeys = new Set(canonicalOrder.map((r) => `${r.type}:${r.id}`))

    if (existingKeys.size !== newKeys.size || ![...existingKeys].every((k) => newKeys.has(k))) {
      return createBadRequestResponse('Reordered resources must match existing resources')
    }

    await db
      .update(copilotChats)
      .set({ resources: sql`${JSON.stringify(canonicalOrder)}::jsonb`, updatedAt: new Date() })
      .where(
        and(
          eq(copilotChats.id, chatId),
          eq(copilotChats.userId, userId),
          isNull(copilotChats.deletedAt)
        )
      )

    logger.info('Reordered resources for chat', { chatId, count: canonicalOrder.length })

    return NextResponse.json({ success: true, resources: canonicalOrder })
  } catch (error) {
    logger.error('Error reordering chat resources:', error)
    return createInternalServerErrorResponse('Failed to reorder resources')
  }
})

export const DELETE = withRouteHandler(async (req: NextRequest) => {
  try {
    const { userId, isAuthenticated } = await authenticateCopilotRequestSessionOnly()
    if (!isAuthenticated || !userId) {
      return createUnauthorizedResponse()
    }

    const parsed = await parseRequest(
      removeCopilotChatResourceContract,
      req,
      {},
      {
        validationErrorResponse: (error) =>
          createBadRequestResponse(error.issues.map((e) => e.message).join(', ')),
      }
    )
    if (!parsed.success) return parsed.response
    const { chatId, resourceType, resourceId } = parsed.data.body

    // Old builds could persist an inner browser/terminal tab id. Closing the
    // singleton panel removes every legacy row of that type so it cannot be
    // canonicalized back into view on the next hydration.
    const removePredicate =
      resourceType === 'browser' || resourceType === 'terminal'
        ? sql`elem->>'type' = ${resourceType}`
        : sql`elem->>'type' = ${resourceType} AND elem->>'id' = ${resourceId}`

    const [updated] = await db
      .update(copilotChats)
      .set({
        resources: sql`COALESCE((
          SELECT jsonb_agg(elem)
          FROM jsonb_array_elements(${copilotChats.resources}) elem
          WHERE NOT (${removePredicate})
        ), '[]'::jsonb)`,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(copilotChats.id, chatId),
          eq(copilotChats.userId, userId),
          isNull(copilotChats.deletedAt)
        )
      )
      .returning({ resources: copilotChats.resources })

    if (!updated) {
      return createNotFoundResponse('Chat not found or unauthorized')
    }

    const merged = Array.isArray(updated.resources) ? (updated.resources as ChatResource[]) : []

    logger.info('Removed resource from chat', { chatId, resourceType, resourceId })

    return NextResponse.json({ success: true, resources: merged })
  } catch (error) {
    logger.error('Error removing chat resource:', error)
    return createInternalServerErrorResponse('Failed to remove resource')
  }
})
