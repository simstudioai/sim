import { z } from 'zod'
import { booleanQueryFlagSchema, workspaceIdSchema } from '@/lib/api/contracts/primitives'
import { defineRouteContract } from '@/lib/api/contracts/types'
import { v2CursorListResponse, v2DataResponse, v2SearchSchema } from '@/lib/api/contracts/v2/shared'

/** A bounded, display-safe chat summary for the public CLI history picker. */
export const v2ChatSummarySchema = z.object({
  id: z.string().min(1),
  title: z.string().nullable(),
  updatedAt: z.string().datetime(),
  pinned: z.boolean(),
  /** True while another client owns the chat's single active response stream. */
  active: z.boolean(),
})

export type V2ChatSummary = z.output<typeof v2ChatSummarySchema>

/** The intentionally small transcript shape needed to repaint a terminal chat. */
export const v2ChatMessageSchema = z.object({
  id: z.string().min(1),
  role: z.enum(['user', 'assistant']),
  content: z.string(),
  timestamp: z.string().datetime(),
})

export type V2ChatMessage = z.output<typeof v2ChatMessageSchema>

export const v2ChatDetailSchema = z.object({
  id: z.string().min(1),
  title: z.string().nullable(),
  messages: z.array(v2ChatMessageSchema),
  continuationToken: z.string().min(1),
  active: z.boolean(),
})

export type V2ChatDetail = z.output<typeof v2ChatDetailSchema>

export const v2RenameChatBodySchema = z
  .object({
    workspaceId: workspaceIdSchema,
    title: z
      .string()
      .trim()
      .min(1, 'Chat title is required')
      .max(200, 'Chat title must be at most 200 characters'),
  })
  .strict()

export type V2RenameChatBody = z.input<typeof v2RenameChatBodySchema>

export const v2RenamedChatSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1).max(200),
})

export type V2RenamedChat = z.output<typeof v2RenamedChatSchema>

/**
 * Recent chats use their Home ordering (pinned first, then most recently
 * updated) with a fixed keyset cursor. The modest default keeps `/chats`
 * cheap even for workspaces with years of chat history.
 */
export const v2ListChatsQuerySchema = z
  .object({
    workspaceId: workspaceIdSchema,
    search: v2SearchSchema,
    limit: z.coerce
      .number()
      .optional()
      .default(30)
      .transform((value) => Math.min(Math.max(1, Math.trunc(value)), 100)),
    cursor: z.string().min(1).optional(),
  })
  .strict()

export type V2ListChatsQuery = z.output<typeof v2ListChatsQuerySchema>

export const v2ChatParamsSchema = z.object({ chatId: z.string().min(1) }).strict()

export const v2GetChatQuerySchema = z
  .object({
    workspaceId: workspaceIdSchema,
    readOnly: booleanQueryFlagSchema.optional().default(false),
  })
  .strict()

export const v2ListChatsContract = defineRouteContract({
  method: 'GET',
  path: '/api/v2/chats',
  query: v2ListChatsQuerySchema,
  response: { mode: 'json', schema: v2CursorListResponse(v2ChatSummarySchema) },
})

export const v2GetChatContract = defineRouteContract({
  method: 'GET',
  path: '/api/v2/chats/[chatId]',
  params: v2ChatParamsSchema,
  query: v2GetChatQuerySchema,
  response: { mode: 'json', schema: v2DataResponse(v2ChatDetailSchema) },
})

export const v2RenameChatContract = defineRouteContract({
  method: 'PATCH',
  path: '/api/v2/chats/[chatId]',
  params: v2ChatParamsSchema,
  body: v2RenameChatBodySchema,
  response: { mode: 'json', schema: v2DataResponse(v2RenamedChatSchema) },
})
