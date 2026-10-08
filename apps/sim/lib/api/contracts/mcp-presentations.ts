import { CallToolResultSchema, ReadResourceResultSchema } from '@modelcontextprotocol/sdk/types.js'
import { z } from 'zod'
import { defineRouteContract } from '@/lib/api/contracts/types'
import {
  MCP_PRESENTATION_MAX_ITEMS,
  mcpPresentationIdSchema,
  mcpPresentationReceiptSchema,
} from '@/lib/mcp/presentation'
import { inlineImageRequestIdSchema } from '@/lib/mothership/chat/inline-image-reference'

const mcpPresentationParamsSchema = z.object({
  chatId: inlineImageRequestIdSchema,
  id: mcpPresentationIdSchema,
})
const mcpPresentationResponseSchema = z.object({
  workspaceId: z.string().min(1),
  receipt: mcpPresentationReceiptSchema,
  arguments: z.record(z.string(), z.unknown()),
  result: CallToolResultSchema,
})
export type McpPresentationResponse = z.output<typeof mcpPresentationResponseSchema>
export const getMcpPresentationContract = defineRouteContract({
  method: 'GET',
  path: '/api/mothership/chats/[chatId]/mcp-results/[id]',
  params: mcpPresentationParamsSchema,
  response: { mode: 'json', schema: mcpPresentationResponseSchema },
})
export const getMcpAppFrameContract = defineRouteContract({
  method: 'GET',
  path: '/api/mothership/chats/[chatId]/mcp-results/[id]/frame',
  params: mcpPresentationParamsSchema,
  response: { mode: 'binary' },
})
const mcpPresentationAssetParamsSchema = mcpPresentationParamsSchema.extend({
  index: z.coerce
    .number()
    .int()
    .min(0)
    .max(MCP_PRESENTATION_MAX_ITEMS - 1),
})
export const getMcpPresentationAssetContract = defineRouteContract({
  method: 'GET',
  path: '/api/mothership/chats/[chatId]/mcp-results/[id]/assets/[index]',
  params: mcpPresentationAssetParamsSchema,
  response: { mode: 'binary' },
})
const mcpAppToolBodySchema = z
  .object({
    name: z.string().min(1).max(256),
    arguments: z.record(z.string(), z.unknown()).optional(),
  })
  .strict()
export type McpAppToolBody = z.output<typeof mcpAppToolBodySchema>
const mcpAppToolResponseSchema = CallToolResultSchema
export const callMcpAppToolContract = defineRouteContract({
  method: 'POST',
  path: '/api/mothership/chats/[chatId]/mcp-results/[id]/tools',
  params: mcpPresentationParamsSchema,
  body: mcpAppToolBodySchema,
  response: { mode: 'json', schema: mcpAppToolResponseSchema },
})
const mcpAppResourceBodySchema = z.object({ uri: z.string().min(1).max(2048) }).strict()
export type McpAppResourceBody = z.output<typeof mcpAppResourceBodySchema>
const mcpAppResourceResponseSchema = ReadResourceResultSchema
export const readMcpAppResourceContract = defineRouteContract({
  method: 'POST',
  path: '/api/mothership/chats/[chatId]/mcp-results/[id]/resources',
  params: mcpPresentationParamsSchema,
  body: mcpAppResourceBodySchema,
  response: { mode: 'json', schema: mcpAppResourceResponseSchema },
})
