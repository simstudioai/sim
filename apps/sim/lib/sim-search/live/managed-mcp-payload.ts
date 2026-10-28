import { isRecordLike } from '@sim/utils/object'
import { isJsonWithinByteLimit } from '@/lib/core/utils/bounded-json'
import type { McpToolResult } from '@/lib/mcp/types'
import { NativeSearchError } from '@/lib/sim-search/live/http'

const MAX_SEARCH_MCP_PAYLOAD_BYTES = 4 * 1024 * 1024

/** MCP text is untrusted provider data; malformed structured search output is never an empty success. */
export function managedMcpPayload(result: McpToolResult, label: string): unknown {
  if (!isJsonWithinByteLimit(result, MAX_SEARCH_MCP_PAYLOAD_BYTES))
    throw new NativeSearchError(
      'unavailable',
      `${label} response exceeded the search size limit. Narrow the query.`
    )
  if (result.isError) {
    if (
      label === 'Granola' &&
      result.content?.some(
        (block) =>
          block.type === 'text' &&
          /Unauthorized: user has not created a Granola account yet\./i.test(block.text ?? '')
      )
    )
      throw new NativeSearchError(
        'reconnect',
        'Reconnect using an existing Granola account. Check the account email in the Granola app.'
      )
    const quota = result.content?.some(
      (block) =>
        block.type === 'text' &&
        /(?:rate.?limit|quota|weekly limit of \d+ MCP requests)/i.test(block.text ?? '')
    )
    throw new NativeSearchError(
      quota ? 'rate_limited' : 'unavailable',
      quota
        ? `${label} MCP request limit reached. Try again when it resets.`
        : `${label} could not complete this read. Check the query and your access.`
    )
  }
  const unwrap = (value: unknown) =>
    isRecordLike(value) && typeof value.toolName === 'string' && 'result' in value
      ? value.result
      : value
  const lucidWidgetMetadata =
    label === 'Lucid' &&
    isRecordLike(result.structuredContent) &&
    Object.keys(result.structuredContent).every((key) => key === 'widgetInstance')
  if (result.structuredContent !== undefined && !lucidWidgetMetadata)
    return unwrap(result.structuredContent)
  const text = (result.content ?? [])
    .filter((block) => block.type === 'text')
    .map((block) => block.text ?? '')
    .join('\n')
  if (!text) throw new NativeSearchError('unavailable', `${label} returned no readable content.`)
  try {
    return unwrap(JSON.parse(text))
  } catch {
    return { text }
  }
}
