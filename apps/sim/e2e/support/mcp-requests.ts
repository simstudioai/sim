import { writeFileSync } from 'node:fs'
import path from 'node:path'
import type { McpFakeRequestRecord } from '../fakes/mcp/server'

export const MCP_REQUEST_LOG_NAME = 'mcp-requests.json'

export function writeMcpRequestLog(
  logsDirectory: string,
  records: readonly McpFakeRequestRecord[]
): void {
  writeFileSync(path.join(logsDirectory, MCP_REQUEST_LOG_NAME), JSON.stringify(records, null, 2))
}

export function assertValidMcpFakeTraffic(
  records: readonly McpFakeRequestRecord[],
  workflowComplete: boolean
): void {
  const unexpected = records.filter((record) => record.unexpected)
  if (unexpected.length > 0) {
    throw new Error(
      `MCP fake received unsupported requests: ${unexpected
        .map(
          ({ method, path, rpcMethod }) => `${method} ${path}${rpcMethod ? ` (${rpcMethod})` : ''}`
        )
        .join(', ')}`
    )
  }
  if (!workflowComplete) return

  const sessions = new Set(records.map((record) => record.session).filter(Boolean))
  for (const session of sessions) {
    const sessionRecords = records.filter((record) => record.session === session)
    const initializeIndex = sessionRecords.findIndex(
      (record) => record.rpcMethod === 'initialize' && record.status === 200
    )
    const initializedIndex = sessionRecords.findIndex(
      (record, index) =>
        index > initializeIndex &&
        record.rpcMethod === 'notifications/initialized' &&
        record.status === 202
    )
    const toolsListIndex = sessionRecords.findIndex(
      (record, index) =>
        index > initializedIndex && record.rpcMethod === 'tools/list' && record.status === 200
    )
    if (
      initializeIndex >= 0 &&
      initializedIndex > initializeIndex &&
      toolsListIndex > initializedIndex
    ) {
      return
    }
  }

  throw new Error(
    'Completed MCP workflow did not produce initialize → initialized → tools/list in one session'
  )
}
