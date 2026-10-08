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
    const text = bytes.toString('utf8')
    const projection = projectResolvedSecretModelContent(text, registry, MCP_PRESENTATION_MAX_BYTES)
    if (!projection.safe || typeof projection.value !== 'string')
      throw new OrchestrationError('forbidden', 'MCP file could not be displayed safely')
    if (projection.value === text) return encoded
    const mime = mimeType?.split(';', 1)[0].trim().toLowerCase() ?? ''
    const textual =
      mime.startsWith('text/') ||
      ['application/json', 'application/xml', 'application/javascript'].includes(mime) ||
      mime.endsWith('+json') ||
      mime.endsWith('+xml')
    if (!textual || !Buffer.from(text).equals(bytes))
      throw new OrchestrationError('forbidden', 'MCP binary file contains protected content')
    return Buffer.from(projection.value).toString('base64')
  }
  if ('contents' in value)
    return {
      ...value,
      contents: value.contents.map((resource) =>
        'blob' in resource
          ? { ...resource, blob: project(resource.blob, resource.mimeType) }
          : resource
      ),
    }
  return {
    ...value,
    content: value.content.map((item) => {
      if (item.type === 'image' || item.type === 'audio')
        return { ...item, data: project(item.data, item.mimeType) }
      if (item.type === 'resource' && 'blob' in item.resource)
        return {
          ...item,
          resource: { ...item.resource, blob: project(item.resource.blob, item.resource.mimeType) },
        }
      return item
    }),
  }
}
