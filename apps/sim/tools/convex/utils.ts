import { truncate } from '@sim/utils/string'
import { validateExternalUrl } from '@/lib/core/security/input-validation'
import type {
  ConvexFunctionCallApiResponse,
  ConvexFunctionCallResponse,
} from '@/tools/convex/types'

/**
 * Builds a Convex deployment API URL from the user-provided deployment URL.
 * Accepts URLs with or without a trailing slash.
 *
 * The deployment URL is validated with the shared SSRF guard so invalid hosts
 * fail fast with a clear message; the tool executor additionally re-validates
 * with DNS resolution and pins the resolved IP for the actual request.
 */
export function convexApiUrl(deploymentUrl: string, path: string): string {
  const trimmed = deploymentUrl.trim().replace(/\/+$/, '')
  const validation = validateExternalUrl(trimmed, 'Deployment URL')
  if (!validation.isValid) {
    throw new Error(`${validation.error} (e.g., https://your-deployment.convex.cloud)`)
  }
  const parsed = new URL(trimmed)
  if (parsed.search || parsed.hash) {
    throw new Error(
      'Deployment URL must not include a query string or fragment (e.g., https://your-deployment.convex.cloud)'
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
  if (typeof args !== 'object' || Array.isArray(args)) {
    throw new Error('Invalid function arguments: expected a JSON object, not an array or scalar')
  }
  return args
}

/**
 * Parses a Convex API response body, surfacing non-OK HTTP statuses (e.g. 401
 * from an invalid deploy key) as descriptive errors instead of empty results.
 */
export async function parseConvexResponse(response: Response): Promise<unknown> {
  if (!response.ok) {
    const text = await response.text().catch(() => '')
    throw new Error(
      `Convex request failed (HTTP ${response.status})${text ? `: ${truncate(text.trim(), 300)}` : ''}`
    )
  }
  return response.json()
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
  const data = (await parseConvexResponse(response)) as ConvexFunctionCallApiResponse

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
