import { MIMEType } from 'node:util'
import type { CallToolResult, ReadResourceResult } from '@modelcontextprotocol/sdk/types.js'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { isJsonWithinByteLimit } from '@/lib/core/utils/bounded-json'
import { MCP_PRESENTATION_MAX_BYTES } from '@/lib/mcp/presentation'
import { projectResolvedSecretModelContent } from '@/executor/utils/resolved-secret-content-projection'
import type { ResolvedSecretTraceRegistry } from '@/executor/utils/resolved-secret-trace-registry'

type McpContentResult = Pick<CallToolResult, 'content'> | Pick<ReadResourceResult, 'contents'>

/** Checks decoded provider bytes before an encoded resource crosses into a saved or live App. */
export function projectMcpEncodedContents<T extends McpContentResult>(
  value: T,
  registry: ResolvedSecretTraceRegistry | undefined
): T {
  if (!isJsonWithinByteLimit(value, MCP_PRESENTATION_MAX_BYTES))
    throw new OrchestrationError('payload_too_large', 'MCP result exceeds 12 MiB')
  const project = (encoded: string, mimeType?: string) => {
    const bytes = Buffer.from(encoded, 'base64')
    let mime: MIMEType | undefined
    try {
      mime = mimeType ? new MIMEType(mimeType) : undefined
    } catch {
      throw new OrchestrationError('validation', 'MCP file has an invalid MIME type')
    }
    const textual =
      mime?.type === 'text' ||
      ['application/json', 'application/xml', 'application/javascript'].includes(
        mime?.essence ?? ''
      ) ||
      mime?.subtype.endsWith('+json') ||
      mime?.subtype.endsWith('+xml')
    let text = bytes.toString('utf8')
    if (textual) {
      const bomEncoding =
        bytes[0] === 0xff && bytes[1] === 0xfe
          ? 'utf-16le'
          : bytes[0] === 0xfe && bytes[1] === 0xff
            ? 'utf-16be'
            : 'utf-8'
      try {
        text = new TextDecoder(mime?.params.get('charset') ?? bomEncoding, { fatal: true }).decode(
          bytes
        )
      } catch {
        throw new OrchestrationError(
          'validation',
          'MCP text file has an unsupported or invalid encoding'
        )
      }
    }
    const projection = projectResolvedSecretModelContent(text, registry, MCP_PRESENTATION_MAX_BYTES)
    if (!projection.safe || typeof projection.value !== 'string')
      throw new OrchestrationError('forbidden', 'MCP file could not be displayed safely')
    if (!textual) {
      if (projection.value !== text)
        throw new OrchestrationError('forbidden', 'MCP binary file contains protected content')
      return { encoded, mimeType }
    }
    mime?.params.delete('charset')
    return { encoded: Buffer.from(projection.value).toString('base64'), mimeType: mime?.toString() }
  }
  if ('contents' in value)
    return {
      ...value,
      contents: value.contents.map((resource) => {
        if (!('blob' in resource)) return resource
        const projected = project(resource.blob, resource.mimeType)
        return { ...resource, blob: projected.encoded, mimeType: projected.mimeType }
      }),
    }
  return {
    ...value,
    content: value.content.map((item) => {
      if (item.type === 'image' || item.type === 'audio') {
        const projected = project(item.data, item.mimeType)
        return { ...item, data: projected.encoded, mimeType: projected.mimeType ?? item.mimeType }
      }
      if (item.type === 'resource' && 'blob' in item.resource) {
        const projected = project(item.resource.blob, item.resource.mimeType)
        return {
          ...item,
          resource: { ...item.resource, blob: projected.encoded, mimeType: projected.mimeType },
        }
      }
      return item
    }),
  }
}
