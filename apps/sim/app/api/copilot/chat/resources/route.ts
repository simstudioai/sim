import { db } from '@sim/db'
import { copilotChats } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { and, eq, sql } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import {
  authenticateCopilotRequestSessionOnly,
  createBadRequestResponse,
  createInternalServerErrorResponse,
  createNotFoundResponse,
  createUnauthorizedResponse,
} from '@/lib/copilot/request-helpers'
import type { ChatResource, ResourceType } from '@/lib/copilot/resources'

const logger = createLogger('CopilotChatResourcesAPI')

const VALID_RESOURCE_TYPES = new Set<ResourceType>([
  'table',
  'file',
  'workflow',
  'knowledgebase',
  'folder',
])
const GENERIC_TITLES = new Set(['Table', 'File', 'Workflow', 'Knowledge Base', 'Folder'])

const AddResourceSchema = z.object({
  chatId: z.string(),
  resource: z.object({
    type: z.enum(['table', 'file', 'workflow', 'knowledgebase', 'folder']),
    id: z.string(),
    title: z.string(),
  }),
})

const RemoveResourceSchema = z.object({
  chatId: z.string(),
  resourceType: z.enum(['table', 'file', 'workflow', 'knowledgebase', 'folder']),
  resourceId: z.string(),
})

const ReorderResourcesSchema = z.object({
  chatId: z.string(),
  resources: z.array(
    z.object({
      type: z.enum(['table', 'file', 'workflow', 'knowledgebase', 'folder']),
      id: z.string(),
      title: z.string(),
    })
  ),
})

export async function POST(req: NextRequest) {
  try {
    const { userId, isAuthenticated } = await authenticateCopilotRequestSessionOnly()
    if (!isAuthenticated || !userId) {
      return createUnauthorizedResponse()
    }

    const body = await req.json()
    const { chatId, resource } = AddResourceSchema.parse(body)

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
      .where(eq(copilotChats.id, chatId))

    logger.info('Added resource to chat', { chatId, resource })

    return NextResponse.json({ success: true, resources: merged })
  } catch (error) {
    if (error instanceof z.ZodError) {
      return createBadRequestResponse(error.errors.map((e) => e.message).join(', '))
    }
    logger.error('Error adding chat resource:', error)
    return createInternalServerErrorResponse('Failed to add resource')
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const { userId, isAuthenticated } = await authenticateCopilotRequestSessionOnly()
    if (!isAuthenticated || !userId) {
      return createUnauthorizedResponse()
    }

    const body = await req.json()
    const { chatId, resources: newOrder } = ReorderResourcesSchema.parse(body)

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
      .where(eq(copilotChats.id, chatId))

    logger.info('Reordered resources for chat', { chatId, count: newOrder.length })

    return NextResponse.json({ success: true, resources: newOrder })
  } catch (error) {
    if (error instanceof z.ZodError) {
      return createBadRequestResponse(error.errors.map((e) => e.message).join(', '))
    }
    logger.error('Error reordering chat resources:', error)
    return createInternalServerErrorResponse('Failed to reorder resources')
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const { userId, isAuthenticated } = await authenticateCopilotRequestSessionOnly()
    if (!isAuthenticated || !userId) {
      return createUnauthorizedResponse()
    }

    const body = await req.json()
    const { chatId, resourceType, resourceId } = RemoveResourceSchema.parse(body)

    const [chat] = await db
      .select({ resources: copilotChats.resources })
      .from(copilotChats)
      .where(and(eq(copilotChats.id, chatId), eq(copilotChats.userId, userId)))
      .limit(1)

    if (!chat) {
      return createNotFoundResponse('Chat not found or unauthorized')
    }

    const existing = Array.isArray(chat.resources) ? (chat.resources as ChatResource[]) : []
    const key = `${resourceType}:${resourceId}`
    const merged = existing.filter((r) => `${r.type}:${r.id}` !== key)

    await db
      .update(copilotChats)
      .set({ resources: sql`${JSON.stringify(merged)}::jsonb`, updatedAt: new Date() })
      .where(eq(copilotChats.id, chatId))

    logger.info('Removed resource from chat', { chatId, resourceType, resourceId })

    return NextResponse.json({ success: true, resources: merged })
  } catch (error) {
    if (error instanceof z.ZodError) {
      return createBadRequestResponse(error.errors.map((e) => e.message).join(', '))
    }
    logger.error('Error removing chat resource:', error)
    return createInternalServerErrorResponse('Failed to remove resource')
  }
}
