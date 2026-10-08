import { createHash } from 'node:crypto'
import {
  CallToolResultSchema,
  type ReadResourceResult,
  ReadResourceResultSchema,
} from '@modelcontextprotocol/sdk/types.js'
import { truncateAtCodePoint } from '@sim/utils/string'
import { z } from 'zod'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { isJsonWithinByteLimit } from '@/lib/core/utils/bounded-json'
import type { DurableSecretProvenance } from '@/lib/execution/durable-secret-provenance'
import {
  MCP_PRESENTATION_MAX_BYTES,
  MCP_PRESENTATION_MAX_ITEMS,
  MCP_PRESENTATION_PREFIX,
  mcpPresentationIdSchema,
  mcpPresentationReceiptSchema,
} from '@/lib/mcp/presentation'
import { getMcpAppResourceUri } from '@/lib/mcp/presentation-metadata'
import type { McpTool, McpToolResult } from '@/lib/mcp/types'
import { inlineImageRequestIdSchema } from '@/lib/mothership/chat/inline-image-reference'
import { isObjectNotFoundError } from '@/lib/uploads/core/errors'
import { downloadFile, uploadFile } from '@/lib/uploads/core/storage-service'

const manifestSchema = z.object({
  version: z.literal(1),
  workspaceId: z.string().min(1).max(128),
  connectionId: z.string().min(1).max(256),
  toolName: z.string().min(1).max(256),
  appUri: z.string().max(2048).optional(),
  arguments: z.record(z.string(), z.unknown()),
  result: CallToolResultSchema,
  resources: ReadResourceResultSchema.shape.contents.default([]),
  receipt: mcpPresentationReceiptSchema,
  secretProvenance: z.unknown(),
})
export type McpPresentationManifest = z.output<typeof manifestSchema>

export function mcpPresentationKey(chatId: string, id: string): string {
  inlineImageRequestIdSchema.parse(chatId)
  mcpPresentationIdSchema.parse(id)
  return `${MCP_PRESENTATION_PREFIX}${chatId}/${id}.json`
}

/** One bounded immutable object keeps media, App data, and their source binding atomic. */
export async function storeMcpPresentation(input: {
  chatId: string
  workspaceId: string
  connectionId: string
  toolCallId: string
  tool: McpTool
  arguments: Record<string, unknown>
  result: McpToolResult
  resources?: ReadResourceResult['contents']
  secretProvenance: DurableSecretProvenance
  signal?: AbortSignal
}) {
  if (!input.toolCallId || input.toolCallId.length > 256)
    throw new OrchestrationError('validation', 'Invalid MCP invocation identity')
  if (input.result.content.length > MCP_PRESENTATION_MAX_ITEMS)
    throw new OrchestrationError('payload_too_large', 'MCP presentation has too many items')
  if (
    input.result.content.some(
      (item) =>
        item.type === 'resource_link' &&
        !input.resources?.some((resource) => resource.uri === item.uri)
    )
  )
    throw new OrchestrationError('validation', 'MCP linked resource snapshot is unavailable')
  const digest = (value: string) => createHash('sha256').update(value).digest('hex')
  const id = digest(input.toolCallId)
  const appUri = getMcpAppResourceUri(input.tool)
  const title = truncateAtCodePoint(input.tool.title || input.tool.name, 197)
  const items = input.result.content.flatMap((item, index) => {
    if (item.type === 'text') return []
    const resource =
      item.type === 'resource' ? item.resource : item.type === 'resource_link' ? item : undefined
    const snapshot =
      item.type === 'resource_link'
        ? input.resources?.find((resource) => resource.uri === item.uri)
        : undefined
    const mimeType =
      item.type === 'image' || item.type === 'audio'
        ? item.mimeType
        : snapshot?.mimeType || resource?.mimeType || 'application/octet-stream'
    const identity = resource
      ? digest(`${input.workspaceId}:${input.connectionId}:${resource.uri}`)
      : `${id}:${index}`
    return [
      {
        index,
        identity,
        title: truncateAtCodePoint(
          item.type === 'resource_link' ? item.title || item.name : `${title} ${index + 1}`,
          197
        ),
        mimeType,
        kind: ['image/png', 'image/jpeg', 'image/webp', 'image/gif'].includes(mimeType)
          ? ('image' as const)
          : mimeType.startsWith('audio/')
            ? ('audio' as const)
            : ('file' as const),
      },
    ]
  })
  if (!items.length && !appUri) return undefined
  const candidate = {
    version: 1,
    workspaceId: input.workspaceId,
    connectionId: input.connectionId,
    toolName: input.tool.name,
    appUri,
    arguments: input.arguments,
    result: input.result,
    resources: input.resources ?? [],
    secretProvenance: input.secretProvenance,
    receipt: { id, title, hasApp: !!appUri, items },
  }
  if (!isJsonWithinByteLimit(candidate, MCP_PRESENTATION_MAX_BYTES))
    throw new OrchestrationError('payload_too_large', 'MCP presentation exceeds 12 MiB')
  const manifest = manifestSchema.parse(candidate)
  const buffer = Buffer.from(JSON.stringify(manifest))
  if (buffer.length > MCP_PRESENTATION_MAX_BYTES)
    throw new OrchestrationError('payload_too_large', 'MCP presentation exceeds 12 MiB')
  try {
    await uploadFile({
      file: buffer,
      fileName: 'mcp-result.json',
      contentType: 'application/json',
      context: 'mothership',
      customKey: mcpPresentationKey(input.chatId, id),
      preserveKey: true,
      persistMetadata: false,
      createOnly: true,
      signal: input.signal,
    })
  } catch (error) {
    input.signal?.throwIfAborted()
    try {
      return (await loadMcpPresentation(input.chatId, id, input.signal)).receipt
    } catch {
      throw error
    }
  }
  return manifest.receipt
}

export async function loadMcpPresentation(
  chatId: string,
  id: string,
  signal?: AbortSignal
): Promise<McpPresentationManifest> {
  try {
    const buffer = await downloadFile({
      key: mcpPresentationKey(chatId, id),
      context: 'mothership',
      maxBytes: MCP_PRESENTATION_MAX_BYTES,
      signal,
    })
    const manifest = manifestSchema.parse(JSON.parse(buffer.toString('utf8')))
    if (manifest.receipt.id !== id) throw new Error('MCP presentation identity mismatch')
    return manifest
  } catch (error) {
    if (
      isObjectNotFoundError(error) ||
      (error instanceof Error && 'code' in error && error.code === 'ENOENT')
    )
      throw new OrchestrationError('not_found', 'MCP result not found')
    throw error
  }
}
