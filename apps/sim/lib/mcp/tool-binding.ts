import { isPlainRecord } from '@sim/utils/object'
import { parseMcpToolTarget } from '@/lib/mcp/utils'

/** Normalizes saved individual attachments to one target shape before discovery or execution. */
export function resolveMcpToolBinding(value: unknown): { serverId: string; toolName: string } {
  if (!isPlainRecord(value) || value.type !== 'mcp')
    throw new Error('Expected an MCP tool attachment')
  if (
    isPlainRecord(value.params) &&
    typeof value.params.serverId === 'string' &&
    typeof value.params.toolName === 'string' &&
    value.params.serverId &&
    value.params.toolName
  ) {
    return { serverId: value.params.serverId, toolName: value.params.toolName }
  }
  const schema = value.schema
  if (
    value.operationPolicy === undefined &&
    isPlainRecord(schema) &&
    isPlainRecord(schema.function) &&
    typeof schema.function.name === 'string'
  ) {
    const target = parseMcpToolTarget(schema.function.name)
    return {
      serverId: target.kind === 'shared_server' ? target.serverId : target.credentialId,
      toolName: target.toolName,
    }
  }
  throw new Error('MCP attachment requires server and operation')
}
