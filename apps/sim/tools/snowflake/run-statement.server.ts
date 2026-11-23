import {
  secureFetchWithPinnedIP,
  validateUrlWithDNS,
} from '@/lib/core/security/input-validation.server'
import type { SnowflakeResultParams, SnowflakeStatementOutput } from '@/tools/snowflake/types'
import {
  buildSnowflakeStatementBody,
  getSnowflakeBaseUrl,
  getSnowflakeHeaders,
  readSnowflakeResult,
  SNOWFLAKE_MAX_RESPONSE_BYTES,
} from '@/tools/snowflake/utils'

/**
 * Runs one synchronous statement with a token and host a Snowflake tool call
 * already resolved from its saved credential, over the same guarded egress the
 * tool transport uses. For a tool that issues a second statement itself (Cortex
 * Analyst running its generated SQL): a nested tool call would discard the
 * credential-derived host and token type, which only the credential may set.
 * Redirects are refused so the token never leaves the account host.
 */
export async function runSnowflakeStatement(
  params: SnowflakeResultParams,
  statement: string,
  context: { database?: string; schema?: string },
  signal?: AbortSignal
): Promise<SnowflakeStatementOutput> {
  const url = `${getSnowflakeBaseUrl(params)}/api/v2/statements`
  const body = buildSnowflakeStatementBody(
    params,
    { statement },
    { context, warehouse: params.warehouse, maxRows: params.maxRows }
  )
  const validation = await validateUrlWithDNS(url, 'snowflakeUrl', 'requestTarget', { signal })
  if (!validation.isValid) {
    throw new Error(`Invalid Snowflake URL: ${validation.error ?? 'DNS resolution failed'}`)
  }
  const response = await secureFetchWithPinnedIP(url, validation.resolvedIP, {
    profile: 'requestTarget',
    method: 'POST',
    headers: getSnowflakeHeaders(params),
    body: JSON.stringify(body),
    maxRedirects: 0,
    maxResponseBytes: SNOWFLAKE_MAX_RESPONSE_BYTES,
    signal,
  })
  return readSnowflakeResult(
    new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers.toRecord(),
    }),
    { signal }
  )
}
