import { CallToolResultSchema, ReadResourceResultSchema } from '@modelcontextprotocol/sdk/types.js'
import { z } from 'zod'
import {
  MCP_PRESENTATION_MAX_ITEMS,
  mcpPresentationIdSchema,
  mcpPresentationReceiptSchema,
} from '@/lib/mcp/presentation'
import { inlineImageRequestIdSchema } from '@/lib/mothership/chat/inline-image-reference'

export const mcpPresentationParamsSchema = z.object({
  chatId: inlineImageRequestIdSchema,
  id: mcpPresentationIdSchema,
})
export const mcpPresentationResponseSchema = z.object({
  workspaceId: z.string().min(1),
  receipt: mcpPresentationReceiptSchema,
  arguments: z.record(z.string(), z.unknown()),
  result: CallToolResultSchema,
})
export type McpPresentationResponse = z.output<typeof mcpPresentationResponseSchema>
export const mcpPresentationMetadataResponseSchema = mcpPresentationResponseSchema.pick({
  workspaceId: true,
  receipt: true,
})
export type McpPresentationMetadataResponse = z.output<typeof mcpPresentationMetadataResponseSchema>
export const mcpPresentationAssetParamsSchema = mcpPresentationParamsSchema.extend({
  index: z.coerce
    .number()
    .int()
    .min(0)
    .max(MCP_PRESENTATION_MAX_ITEMS - 1),
})
export const mcpAppToolBodySchema = z
  .object({
    name: z.string().min(1).max(256),
    arguments: z.record(z.string(), z.unknown()).optional(),
  })
  .strict()
export type McpAppToolBody = z.output<typeof mcpAppToolBodySchema>
export const mcpAppToolResponseSchema = CallToolResultSchema
export type McpAppToolResponse = z.output<typeof mcpAppToolResponseSchema>
export const mcpAppResourceBodySchema = z.object({ uri: z.string().min(1).max(2048) }).strict()
export type McpAppResourceBody = z.output<typeof mcpAppResourceBodySchema>
export const mcpAppResourceResponseSchema = ReadResourceResultSchema
export type McpAppResourceResponse = z.output<typeof mcpAppResourceResponseSchema>
