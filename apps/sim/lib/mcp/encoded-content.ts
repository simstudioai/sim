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
  registry: ResolvedSecretTraceRegistry | undefined,
  rejectedFiles: 'error' | 'omit' = 'error'
): T {
  if (!isJsonWithinByteLimit(value, MCP_PRESENTATION_MAX_BYTES))
    throw new OrchestrationError('payload_too_large', 'MCP result exceeds 12 MiB')
  const projectFile = (encoded: string, mimeType?: string) => {
    const bytes = decodeMcpBase64(encoded)
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
  const project = (encoded: string, mimeType?: string) => {
    try {
      return projectFile(encoded, mimeType)
    } catch (error) {
      if (
        rejectedFiles === 'omit' &&
        error instanceof OrchestrationError &&
        (error.code === 'validation' || error.code === 'forbidden')
      )
        return undefined
      throw error
    }
  }
  if ('contents' in value)
    return {
      ...value,
      contents: value.contents.flatMap<ReadResourceResult['contents'][number]>((resource) => {
        if (!('blob' in resource)) return [resource]
        const projected = project(resource.blob, resource.mimeType)
        return projected
          ? [{ ...resource, blob: projected.encoded, mimeType: projected.mimeType }]
          : []
      }),
    }
  return {
    ...value,
    content: value.content.map((item) => {
      if (item.type === 'image' || item.type === 'audio') {
        const projected = project(item.data, item.mimeType)
        if (!projected)
          return { type: 'text' as const, text: 'MCP file output could not be displayed.' }
        return { ...item, data: projected.encoded, mimeType: projected.mimeType ?? item.mimeType }
      }
      if (item.type === 'resource' && 'blob' in item.resource) {
        const projected = project(item.resource.blob, item.resource.mimeType)
        if (!projected)
          return { type: 'text' as const, text: 'MCP file output could not be displayed.' }
        return {
          ...item,
          resource: { ...item.resource, blob: projected.encoded, mimeType: projected.mimeType },
        }
      }
      return item
    }),
  }
}

/** Decodes canonical bounded MCP file bytes for publication and historical asset reads. */
export function decodeMcpBase64(value: string): Buffer {
  if (value.length > MCP_PRESENTATION_MAX_BYTES || value.length % 4 !== 0)
    throw new OrchestrationError('validation', 'Invalid MCP file encoding')
  const buffer = Buffer.from(value, 'base64')
  if (buffer.toString('base64') !== value)
    throw new OrchestrationError('validation', 'Invalid MCP file encoding')
  return buffer
}
