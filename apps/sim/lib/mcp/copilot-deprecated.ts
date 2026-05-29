import { NextResponse } from 'next/server'

const DEPRECATION_MESSAGE = 'Copilot MCP has been deprecated and is no longer available.'

/**
 * Standard 410 response for the deprecated Copilot MCP surface. Used by the
 * copilot MCP resource route and its copilot-specific OAuth discovery routes.
 */
export function copilotMcpDeprecatedResponse(): NextResponse {
  return NextResponse.json(
    { error: 'gone', message: DEPRECATION_MESSAGE },
    {
      status: 410,
      headers: { 'Cache-Control': 'no-store' },
    }
  )
}

/**
 * JSON-RPC flavored 410 response for the deprecated Copilot MCP `POST` endpoint,
 * so MCP clients surface a clean error envelope instead of an opaque body.
 */
export function copilotMcpDeprecatedJsonRpcResponse(): NextResponse {
  return NextResponse.json(
    {
      jsonrpc: '2.0',
      id: null,
      error: { code: -32000, message: DEPRECATION_MESSAGE },
    },
    {
      status: 410,
      headers: { 'Cache-Control': 'no-store' },
    }
  )
}
