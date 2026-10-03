import { z } from 'zod'
import { defineRouteContract } from '@/lib/api/contracts/types'
import {
  inlineImageRequestIdSchema,
  inlineImageSourceSchema,
} from '@/lib/mothership/chat/inline-image-reference'

export const inlineChatImageParamsSchema = z.object({
  chatId: inlineImageRequestIdSchema,
  requestId: inlineImageRequestIdSchema,
})
export type InlineChatImageParams = z.output<typeof inlineChatImageParamsSchema>
export const inlineChatImageQuerySchema = z.object({ path: inlineImageSourceSchema })
export type InlineChatImageQuery = z.output<typeof inlineChatImageQuerySchema>
export const getInlineChatImageContract = defineRouteContract({
  method: 'GET',
  path: '/api/mothership/chats/[chatId]/images/[requestId]',
  params: inlineChatImageParamsSchema,
  query: inlineChatImageQuerySchema,
  response: { mode: 'binary' },
})
