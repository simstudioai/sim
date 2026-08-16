import type { Logger } from '@sim/logger'
import type { OktaApiError, OktaGroupProfile, OktaGroupRule } from '@/tools/okta/types'

/**
 * Standard headers for every Okta Management API request.
 *
 * Okta authenticates API tokens with the `SSWS` scheme rather than `Bearer`.
 */
export function oktaHeaders(apiKey: string): Record<string, string> {
  return {
    Authorization: `SSWS ${apiKey}`,
    Accept: 'application/json',
    'Content-Type': 'application/json',
  }
}

/**
 * Reads an Okta error body and throws a `ToolResponse`-friendly `Error`.
 *
 * Okta returns `errorSummary` on failure, but lifecycle endpoints answer with an
 * empty body, so the JSON parse is best-effort and falls back to the caller's
 * message.
 */
export async function throwOktaError(
  response: Response,
  logger: Logger,
  fallbackMessage: string
): Promise<never> {
  let error: OktaApiError = {}
  try {
    error = await response.json()
  } catch {
    // Lifecycle endpoints answer with an empty or non-JSON body
  }
  logger.error('Okta API request failed', { data: error, status: response.status })
  throw new Error(error.errorSummary || fallbackMessage)
}

const NEXT_LINK_PATTERN = /<([^>]+)>\s*;\s*rel="next"/i

/**
 * Extracts Okta's cursor pagination state from the `Link` response header.
 *
 * Okta paginates with an opaque `after` cursor advertised in a `Link` header
 * entry marked `rel="next"` — never in the response body, which is a bare JSON
 * array. The absence of that entry is what marks the final page.
 */
export function parseOktaPagination(response: Response): {
  nextCursor: string | null
  hasMore: boolean
} {
  const linkHeader = response.headers.get('Link')
  if (!linkHeader) return { nextCursor: null, hasMore: false }

  const nextMatch = linkHeader.match(NEXT_LINK_PATTERN)
  if (!nextMatch) return { nextCursor: null, hasMore: false }

  let nextCursor: string | null = null
  try {
    nextCursor = new URL(nextMatch[1]).searchParams.get('after')
  } catch {
    // Malformed next link — report more results without a usable cursor
  }

  return { nextCursor, hasMore: true }
}

/**
 * Overlays the fields a caller supplied onto a group's stored profile.
 *
 * `PUT /api/v1/groups/{groupId}` replaces the profile wholesale, and the
 * profile is extensible, so anything left out is erased — the stored
 * description on a rename, and every org-defined custom attribute on any
 * update. Merging over the current profile is what makes an omitted field mean
 * "leave it alone" instead of "delete it".
 */
export function mergeOktaGroupProfile(
  existing: OktaGroupProfile | undefined,
  updates: { name: string; description?: string }
): Record<string, unknown> {
  return {
    ...existing,
    name: updates.name,
    ...(updates.description === undefined ? {} : { description: updates.description }),
  }
}

/**
 * Flattens a group rule into the shape the list, get, and create tools all emit.
 *
 * The API nests the driving expression and the target groups several levels
 * deep, which is awkward to reference from a workflow, so the fields callers act
 * on are lifted to the top level. Okta documents `exclude` lists only — there is
 * no `include` counterpart on either people condition.
 */
export function mapOktaGroupRule(rule: OktaGroupRule) {
  return {
    id: rule.id,
    name: rule.name,
    type: rule.type,
    status: rule.status,
    created: rule.created ?? null,
    lastUpdated: rule.lastUpdated ?? null,
    expression: rule.conditions?.expression?.value ?? null,
    expressionType: rule.conditions?.expression?.type ?? null,
    assignUserToGroupIds: rule.actions?.assignUserToGroups?.groupIds ?? [],
    excludedUserIds: rule.conditions?.people?.users?.exclude ?? [],
    excludedGroupIds: rule.conditions?.people?.groups?.exclude ?? [],
  }
}
