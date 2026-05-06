import { db } from '@sim/db'
import { copilotChats } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { and, eq, sql } from 'drizzle-orm'
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
import type { ChatResource, ResourceType } from '@/lib/copilot/resources/persistence'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'

const logger = createLogger('CopilotChatResourcesAPI')

const VALID_RESOURCE_TYPES = new Set<ResourceType>([
  'table',
  'file',
  'workflow',
  'knowledgebase',
  'folder',
  'log',
])
const GENERIC_TITLES = new Set(['Table', 'File', 'Workflow', 'Knowledge Base', 'Folder', 'Log'])

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
    const { chatId, resource } = parsed.data.body

    // Ephemeral UI tab (client does not POST this; guard for old clients / bugs).
    if (resource.id === 'streaming-file') {
      return NextResponse.json({ success: true })
    }

    if (!VALID_RESOURCE_TYPES.has(resource.type)) {
      return createBadRequestResponse(`Invalid resource type: ${resource.type}`)
    }

    const [chat] = await db
      .select({ resources: copilotChats.resources })
      .from(copilotChats)
      .where(and(eq(copilotChats.id, chatId), eq(copilotChats.userId, userId)))
      .limit(1)

    if (!chat) {
      return createNotFoundResponse('Chat not found or unauthorized')
    }

    const existing = Array.isArray(chat.resources) ? (chat.resources as ChatResource[]) : []
    const key = `${resource.type}:${resource.id}`
    const prev = existing.find((r) => `${r.type}:${r.id}` === key)

    let merged: ChatResource[]
    if (prev) {
      if (GENERIC_TITLES.has(prev.title) && !GENERIC_TITLES.has(resource.title)) {
        merged = existing.map((r) =>
          `${r.type}:${r.id}` === key ? { ...r, title: resource.title } : r
        )
      } else {
        merged = existing
      }
    } else {
      merged = [...existing, resource]
    }

    await db
      .update(copilotChats)
      .set({ resources: sql`${JSON.stringify(merged)}::jsonb`, updatedAt: new Date() })
      .where(and(eq(copilotChats.id, chatId), eq(copilotChats.userId, userId)))

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
      .where(and(eq(copilotChats.id, chatId), eq(copilotChats.userId, userId)))
      .limit(1)

    if (!chat) {
      return createNotFoundResponse('Chat not found or unauthorized')
    }

    const existing = Array.isArray(chat.resources) ? (chat.resources as ChatResource[]) : []
    const existingKeys = new Set(existing.map((r) => `${r.type}:${r.id}`))
    const newKeys = new Set(newOrder.map((r) => `${r.type}:${r.id}`))

    if (existingKeys.size !== newKeys.size || ![...existingKeys].every((k) => newKeys.has(k))) {
      return createBadRequestResponse('Reordered resources must match existing resources')
    }

    await db
      .update(copilotChats)
      .set({ resources: sql`${JSON.stringify(newOrder)}::jsonb`, updatedAt: new Date() })
      .where(and(eq(copilotChats.id, chatId), eq(copilotChats.userId, userId)))

    logger.info('Reordered resources for chat', { chatId, count: newOrder.length })

    return NextResponse.json({ success: true, resources: newOrder })
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

    const [updated] = await db
      .update(copilotChats)
      .set({
        resources: sql`COALESCE((
          SELECT jsonb_agg(elem)
          FROM jsonb_array_elements(${copilotChats.resources}) elem
          WHERE NOT (elem->>'type' = ${resourceType} AND elem->>'id' = ${resourceId})
        ), '[]'::jsonb)`,
        updatedAt: new Date(),
      })
      .where(and(eq(copilotChats.id, chatId), eq(copilotChats.userId, userId)))
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
