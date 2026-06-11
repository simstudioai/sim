import type { ConvexFunctionCallResponse } from '@/tools/convex/types'

/**
 * Builds a Convex deployment API URL from the user-provided deployment URL.
 * Accepts URLs with or without a trailing slash.
 */
export function convexApiUrl(deploymentUrl: string, path: string): string {
  const trimmed = deploymentUrl.trim().replace(/\/+$/, '')
  if (!/^https?:\/\//.test(trimmed)) {
    throw new Error(
      'Deployment URL must start with https:// (e.g., https://your-deployment.convex.cloud) or http:// for self-hosted deployments'
    )
  }
  return `${trimmed}${path}`
}

/**
 * Builds the deployment admin authorization header for Convex HTTP API requests.
 * @see https://docs.convex.dev/http-api/#api-authentication
 */
export function convexAuthHeaders(deployKey: string): Record<string, string> {
  return { Authorization: `Convex ${deployKey.trim()}` }
}

/**
 * Parses function arguments that may arrive as a JSON string or an object.
 * Convex function endpoints require a named-argument object.
 */
export function parseFunctionArgs(
  args: Record<string, unknown> | string | undefined
): Record<string, unknown> {
  if (args === undefined || args === null) return {}
  if (typeof args === 'string') {
    const trimmed = args.trim()
    if (!trimmed) return {}
    let parsed: unknown
    try {
      parsed = JSON.parse(trimmed)
    } catch {
      throw new Error('Invalid function arguments: expected a JSON object like {"key": "value"}')
    }
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('Invalid function arguments: expected a JSON object, not an array or scalar')
    }
    return parsed as Record<string, unknown>
  }
  return args
}

/**
 * Transforms a Convex function-call response. Convex returns HTTP 200 with an
 * in-band `status: "error"` payload when the function itself fails, so errors
 * must be surfaced here rather than relying on the HTTP status code.
 * @see https://docs.convex.dev/http-api/#post-apiquery-apimutation-apiaction
 */
export async function transformFunctionCallResponse(
  response: Response,
  functionType: 'query' | 'mutation' | 'action' | 'function'
): Promise<ConvexFunctionCallResponse> {
  const data = await response.json()

  if (data.status === 'error') {
    const details =
      data.errorData !== undefined && data.errorData !== null
        ? ` (${JSON.stringify(data.errorData)})`
        : ''
    throw new Error(
      `Convex ${functionType} failed: ${data.errorMessage || 'Unknown error'}${details}`
    )
  }

  return {
    success: true,
    output: {
      value: data.value ?? null,
      logLines: data.logLines ?? [],
    },
  }
}
