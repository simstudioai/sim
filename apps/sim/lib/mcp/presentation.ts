import { isPlainRecord } from '@sim/utils/object'
import { z } from 'zod'

export const MCP_PRESENTATION_PREFIX = 'chat-mcp/'
export const MCP_PRESENTATION_MAX_BYTES = 12 * 1024 * 1024
export const MCP_PRESENTATION_MAX_ITEMS = 16
export const mcpPresentationIdSchema = z.string().regex(/^[a-f0-9]{64}$/)
export const mcpPresentationReceiptSchema = z.object({
  id: mcpPresentationIdSchema,
  title: z.string().min(1).max(200),
  hasApp: z.boolean(),
  items: z
    .array(
      z.object({
        index: z
          .number()
          .int()
          .min(0)
          .max(MCP_PRESENTATION_MAX_ITEMS - 1),
        identity: z.string().max(2048),
        title: z.string().max(200),
        mimeType: z.string().max(128),
        kind: z.enum(['image', 'audio', 'file', 'resource']),
      })
    )
    .max(MCP_PRESENTATION_MAX_ITEMS),
})
export type McpPresentationReceipt = z.output<typeof mcpPresentationReceiptSchema>

/** Persist display addresses only; their private manifest is the authority for every action. */
export function compactMcpPresentation(
  output: unknown
): { mcpPresentation: McpPresentationReceipt } | undefined {
  if (!isPlainRecord(output)) return undefined
  const parsed = mcpPresentationReceiptSchema.safeParse(output.mcpPresentation)
  return parsed.success ? { mcpPresentation: parsed.data } : undefined
}

export function mcpPresentationAssetUrl(chatId: string, id: string, index: number): string {
  return `/api/mothership/chats/${encodeURIComponent(chatId)}/mcp-results/${encodeURIComponent(id)}/assets/${index}`
}
